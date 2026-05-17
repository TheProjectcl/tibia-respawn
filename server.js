import express from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar_esto_en_produccion';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'dist')));

// ─── DISCORD ────────────────────────────────────────────────────────────────
async function discordNotify(msg) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg })
    });
  } catch (e) { console.error('Discord error:', e.message); }
}

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admins' });
  next();
}

// ─── INIT DB ─────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(10) DEFAULT 'member',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS respawns (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      maintenance BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS claims (
      id SERIAL PRIMARY KEY,
      respawn_id INTEGER REFERENCES respawns(id) ON DELETE CASCADE,
      holder_id INTEGER REFERENCES users(id),
      holder_end TIMESTAMP NOT NULL,
      next_user_id INTEGER REFERENCES users(id),
      next_hours INTEGER DEFAULT 3,
      claimed_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      respawn_id INTEGER REFERENCES respawns(id) ON DELETE SET NULL,
      action VARCHAR(50),
      hours INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Crear admin por defecto si no existe
  const exists = await pool.query('SELECT id FROM users WHERE role=$1', ['admin']);
  if (exists.rows.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
      ['Admin', hash, 'admin']
    );
    console.log('✅ Admin creado — usuario: Admin / contraseña: admin123');
  }
}

async function logAction(userId, respawnId, action, hours = 0) {
  await pool.query(
    'INSERT INTO activity_log (user_id, respawn_id, action, hours) VALUES ($1,$2,$3,$4)',
    [userId, respawnId, action, hours]
  );
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query('SELECT * FROM users WHERE username=$1 AND active=true', [username]);
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000, sameSite: 'lax' });
  res.json({ username: user.username, role: user.role });
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/auth/me', auth, (req, res) => res.json(req.user));

// ─── RESPAWNS ─────────────────────────────────────────────────────────────────
app.get('/respawns', auth, async (req, res) => {
  const resp = await pool.query('SELECT * FROM respawns ORDER BY id');
  const clms = await pool.query(`
    SELECT c.*, 
      h.username as holder_name, 
      n.username as next_name,
      EXTRACT(EPOCH FROM (c.holder_end - NOW())) as seconds_left
    FROM claims c
    JOIN users h ON h.id = c.holder_id
    LEFT JOIN users n ON n.id = c.next_user_id
  `);
  const claimMap = {};
  clms.rows.forEach(c => { claimMap[c.respawn_id] = c; });
  res.json(resp.rows.map(r => ({ ...r, claim: claimMap[r.id] || null })));
});

app.post('/respawns/:id/claim', auth, async (req, res) => {
  const { hours } = req.body;
  if (![1, 2, 3].includes(hours)) return res.status(400).json({ error: 'Horas inválidas' });
  const rid = parseInt(req.params.id);
  const uid = req.user.id;

  const existing = await pool.query(
    'SELECT id FROM claims WHERE holder_id=$1 OR next_user_id=$1', [uid]
  );
  if (existing.rows.length > 0) return res.status(400).json({ error: 'Ya tenés un respawn activo' });

  const busy = await pool.query('SELECT id FROM claims WHERE respawn_id=$1', [rid]);
  if (busy.rows.length > 0) return res.status(400).json({ error: 'Respawn ocupado' });

  const resp = await pool.query('SELECT * FROM respawns WHERE id=$1', [rid]);
  if (!resp.rows[0] || resp.rows[0].maintenance) return res.status(400).json({ error: 'No disponible' });

  await pool.query(
    'INSERT INTO claims (respawn_id, holder_id, holder_end) VALUES ($1,$2, NOW() + $3 * interval \'1 hour\')',
    [rid, uid, hours]
  );
  await logAction(uid, rid, 'claim', hours);
  discordNotify(`⚔ **${req.user.username}** claimedó **${resp.rows[0].name}** por ${hours}h`);
  res.json({ ok: true });
});

app.post('/respawns/:id/release', auth, async (req, res) => {
  const rid = parseInt(req.params.id);
  const claim = await pool.query('SELECT * FROM claims WHERE respawn_id=$1', [rid]);
  if (!claim.rows[0]) return res.status(404).json({ error: 'No hay claim' });
  if (claim.rows[0].holder_id !== req.user.id) return res.status(403).json({ error: 'No es tu respawn' });

  const resp = await pool.query('SELECT name FROM respawns WHERE id=$1', [rid]);
  const c = claim.rows[0];

  if (c.next_user_id) {
    await pool.query(
      'UPDATE claims SET holder_id=$1, holder_end=NOW() + $2 * interval \'1 hour\', next_user_id=NULL, claimed_at=NOW() WHERE respawn_id=$3',
      [c.next_user_id, c.next_hours, rid]
    );
    const nextUser = await pool.query('SELECT username FROM users WHERE id=$1', [c.next_user_id]);
    discordNotify(`🔄 **${req.user.username}** liberó **${resp.rows[0].name}** → ahora lo tiene **${nextUser.rows[0].username}**`);
  } else {
    await pool.query('DELETE FROM claims WHERE respawn_id=$1', [rid]);
    discordNotify(`✅ **${req.user.username}** liberó **${resp.rows[0].name}** — ahora está libre`);
  }
  await logAction(req.user.id, rid, 'release', 0);
  res.json({ ok: true });
});

app.post('/respawns/:id/extend', auth, async (req, res) => {
  const rid = parseInt(req.params.id);
  const claim = await pool.query('SELECT * FROM claims WHERE respawn_id=$1', [rid]);
  if (!claim.rows[0] || claim.rows[0].holder_id !== req.user.id)
    return res.status(403).json({ error: 'No es tu respawn' });
  if (claim.rows[0].next_user_id)
    return res.status(400).json({ error: 'No se puede extender con next en cola' });
  await pool.query('UPDATE claims SET holder_end=NOW() + interval \'3 hours\' WHERE respawn_id=$1', [rid]);
  await logAction(req.user.id, rid, 'extend', 3);
  res.json({ ok: true });
});

app.post('/respawns/:id/join-queue', auth, async (req, res) => {
  const { hours } = req.body;
  if (![1, 2, 3].includes(hours)) return res.status(400).json({ error: 'Horas inválidas' });
  const rid = parseInt(req.params.id);
  const uid = req.user.id;

  const existing = await pool.query('SELECT id FROM claims WHERE holder_id=$1 OR next_user_id=$1', [uid]);
  if (existing.rows.length > 0) return res.status(400).json({ error: 'Ya tenés un respawn activo' });

  const claim = await pool.query('SELECT * FROM claims WHERE respawn_id=$1', [rid]);
  if (!claim.rows[0]) return res.status(400).json({ error: 'Respawn libre, podés claimear directamente' });
  if (claim.rows[0].next_user_id) return res.status(400).json({ error: 'Ya hay un next' });

  await pool.query('UPDATE claims SET next_user_id=$1, next_hours=$2 WHERE respawn_id=$3', [uid, hours, rid]);
  const resp = await pool.query('SELECT name FROM respawns WHERE id=$1', [rid]);
  await logAction(uid, rid, 'join_queue', hours);
  discordNotify(`📋 **${req.user.username}** se anotó como next en **${resp.rows[0].name}** (${hours}h)`);
  res.json({ ok: true });
});

app.post('/respawns/:id/leave-queue', auth, async (req, res) => {
  const rid = parseInt(req.params.id);
  const claim = await pool.query('SELECT * FROM claims WHERE respawn_id=$1', [rid]);
  if (!claim.rows[0] || claim.rows[0].next_user_id !== req.user.id)
    return res.status(403).json({ error: 'No estás en la cola' });
  await pool.query('UPDATE claims SET next_user_id=NULL, next_hours=3 WHERE respawn_id=$1', [rid]);
  await logAction(req.user.id, rid, 'leave_queue', 0);
  res.json({ ok: true });
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────
app.get('/admin/respawns', auth, adminOnly, async (req, res) => {
  const r = await pool.query('SELECT * FROM respawns ORDER BY id');
  res.json(r.rows);
});

app.post('/admin/respawns', auth, adminOnly, async (req, res) => {
  const { name } = req.body;
  const r = await pool.query('INSERT INTO respawns (name) VALUES ($1) RETURNING *', [name]);
  res.json(r.rows[0]);
});

app.put('/admin/respawns/:id', auth, adminOnly, async (req, res) => {
  const { name, maintenance } = req.body;
  const r = await pool.query(
    'UPDATE respawns SET name=COALESCE($1,name), maintenance=COALESCE($2,maintenance) WHERE id=$3 RETURNING *',
    [name, maintenance, req.params.id]
  );
  res.json(r.rows[0]);
});

app.delete('/admin/respawns/:id', auth, adminOnly, async (req, res) => {
  const busy = await pool.query('SELECT id FROM claims WHERE respawn_id=$1', [req.params.id]);
  if (busy.rows.length > 0) return res.status(400).json({ error: 'Respawn ocupado' });
  await pool.query('DELETE FROM respawns WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/admin/users', auth, adminOnly, async (req, res) => {
  const r = await pool.query('SELECT id,username,role,active,created_at FROM users ORDER BY id');
  res.json(r.rows);
});

app.post('/admin/users', auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    'INSERT INTO users (username,password_hash,role) VALUES ($1,$2,$3) RETURNING id,username,role',
    [username, hash, role || 'member']
  );
  res.json(r.rows[0]);
});

app.delete('/admin/users/:id', auth, adminOnly, async (req, res) => {
  const { permanent } = req.query;
  if (permanent === 'true') {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  } else {
    await pool.query('UPDATE users SET active=false WHERE id=$1', [req.params.id]);
  }
  res.json({ ok: true });
});

app.put('/admin/users/:id/reactivate', auth, adminOnly, async (req, res) => {
  await pool.query('UPDATE users SET active=true WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/admin/logs', auth, adminOnly, async (req, res) => {
  const r = await pool.query(`
    SELECT al.*, u.username, rs.name as respawn_name
    FROM activity_log al
    LEFT JOIN users u ON u.id = al.user_id
    LEFT JOIN respawns rs ON rs.id = al.respawn_id
    ORDER BY al.created_at DESC LIMIT 100
  `);
  res.json(r.rows);
});
app.put('/admin/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const { password, role } = req.body;
    if (password && password.trim() !== '') {
      const hash = await bcrypt.hash(password.trim(), 10);
      await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
    }
    if (role) {
      await pool.query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CRON: expirar claims cada 10 segundos ───────────────────────────────────
cron.schedule('*/10 * * * * *', async () => {
  const expired = await pool.query(`
    SELECT c.*, r.name as respawn_name, h.username as holder_name, n.username as next_name
    FROM claims c
    JOIN respawns r ON r.id = c.respawn_id
    JOIN users h ON h.id = c.holder_id
    LEFT JOIN users n ON n.id = c.next_user_id
    WHERE c.holder_end <= NOW()
  `);
  for (const c of expired.rows) {
    if (c.next_user_id) {
      await pool.query(
        'UPDATE claims SET holder_id=$1, holder_end=NOW() + $2 * interval \'1 hour\', next_user_id=NULL, claimed_at=NOW() WHERE id=$3',
        [c.next_user_id, c.next_hours, c.id]
      );
      await logAction(c.next_user_id, c.respawn_id, 'expired_passed', c.next_hours);
      discordNotify(`⏰ Expiró **${c.respawn_name}** — ahora lo tiene **${c.next_name}** por ${c.next_hours}h`);
    } else {
      await pool.query('DELETE FROM claims WHERE id=$1', [c.id]);
      await logAction(c.holder_id, c.respawn_id, 'expired_freed', 0);
      discordNotify(`⏰ **${c.respawn_name}** expiró y quedó libre`);
    }
  }
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`🗡 Servidor corriendo en puerto ${PORT}`));
});