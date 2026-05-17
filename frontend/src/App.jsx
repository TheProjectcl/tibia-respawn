import { useState, useEffect, useCallback, useRef } from 'react'


const API = ''

function fmt(sec) {
  if (sec <= 0) return '00:00:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return [h, m, s].map(x => String(x).padStart(2, '0')).join(':')
}

function Toast({ toasts }) {
  return (
    <div style={{ position: 'fixed', top: 64, right: 12, zIndex: 999, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: '#1a1a24', border: `1px solid ${t.err ? '#c0392b88' : '#c9a84c66'}`,
          borderLeft: `3px solid ${t.err ? '#c0392b' : '#c9a84c'}`,
          borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#e0ddd5',
          animation: 'fadeIn .3s ease', maxWidth: 280
        }}>{t.msg}</div>
      ))}
    </div>
  )
}

function HoursBtns({ id, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
      {[1, 2, 3].map(h => (
        <button key={h} onClick={() => onChange(id, h)} style={{
          background: value === h ? '#c9a84c22' : '#1f1f2e',
          border: `1px solid ${value === h ? '#c9a84c' : '#3a3a4a'}`,
          color: value === h ? '#c9a84c' : '#aaa',
          padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12
        }}>{h}h</button>
      ))}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [loginErr, setLoginErr] = useState('')
  const [respawns, setRespawns] = useState([])
  const [tab, setTab] = useState('respawns')
  const [hours, setHours] = useState({})
  const [confirm, setConfirm] = useState({})
  const [toasts, setToasts] = useState([])
  const [adminUsers, setAdminUsers] = useState([])
  const [adminLogs, setAdminLogs] = useState([])
  const [newRespawn, setNewRespawn] = useState('')
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'member' })
  const [editingUser, setEditingUser] = useState(null)
  const [editUserForm, setEditUserForm] = useState({ password: '', role: 'member' })
  const [guildName, setGuildName] = useState('Dark Brotherhood')
  const [editingGuildName, setEditingGuildName] = useState(false)
  const [tempGuildName, setTempGuildName] = useState('')
  const [warMode, setWarMode] = useState(false)
  const [confirmWar, setConfirmWar] = useState(false)
  const toastId = useRef(0)

  const toast = useCallback((msg, err = false) => {
    const id = ++toastId.current
    setToasts(p => [...p, { id, msg, err }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(API + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Error')
    return data
  }, [])

  const loadRespawns = useCallback(async () => {
    try { setRespawns(await api('/respawns')) } catch {}
  }, [api])

  useEffect(() => {
    api('/auth/me').then(u => {
      setUser(u)
      loadRespawns()
      // Cargar nombre de guild guardado
      const saved = localStorage.getItem('guildName')
      if (saved) setGuildName(saved)
      const savedWar = localStorage.getItem('warMode')
      if (savedWar === 'true') setWarMode(true)
    }).catch(() => {})
  }, [api, loadRespawns])

  useEffect(() => {
    if (!user) return
    const iv = setInterval(loadRespawns, 5000)
    return () => clearInterval(iv)
  }, [user, loadRespawns])

  const login = async () => {
    try {
      const u = await api('/auth/login', { method: 'POST', body: loginForm })
      setUser(u); setLoginErr(''); loadRespawns()
      const saved = localStorage.getItem('guildName')
      if (saved) setGuildName(saved)
    } catch (e) { setLoginErr(e.message) }
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    setUser(null); setRespawns([])
  }

  const setH = (id, h) => setHours(p => ({ ...p, [id]: h }))
  const getH = id => hours[id] || 1

  const action = async (path, method = 'POST', body, successMsg) => {
    try {
      await api(path, { method, body })
      toast(successMsg)
      loadRespawns()
    } catch (e) { toast(e.message, true) }
  }

  const loadAdminData = useCallback(async () => {
    try {
      const [u, l] = await Promise.all([api('/admin/users'), api('/admin/logs')])
      setAdminUsers(u); setAdminLogs(l)
    } catch {}
  }, [api])

  useEffect(() => { if (tab === 'admin' && user?.role === 'admin') loadAdminData() }, [tab, user, loadAdminData])

  // Guardar nombre de guild
  const saveGuildName = () => {
    if (!tempGuildName.trim()) return
    setGuildName(tempGuildName.trim())
    localStorage.setItem('guildName', tempGuildName.trim())
    setEditingGuildName(false)
    toast('✓ Nombre de guild actualizado')
  }

  // Modo Guerra — pausa/reanuda todos los respawns
  const toggleWarMode = async () => {
    const newMode = !warMode
    try {
      // Poner todos los respawns en mantenimiento o sacarlos
      await Promise.all(respawns.map(r =>
        api(`/admin/respawns/${r.id}`, { method: 'PUT', body: { maintenance: newMode } })
      ))
      setWarMode(newMode)
      localStorage.setItem('warMode', newMode)
      setConfirmWar(false)
      loadRespawns()
      if (newMode) {
        toast('⚔ ¡MODO GUERRA ACTIVADO! Todos los respawns pausados')
      } else {
        toast('✅ Modo Guerra desactivado — respawns reactivados')
      }
    } catch (e) { toast(e.message, true) }
  }

  // Editar usuario
  const saveEditUser = async () => {
    if (!editingUser) return
    try {
      await api(`/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: {
          password: editUserForm.password || undefined,
          role: editUserForm.role
        }
      })
      setEditingUser(null)
      loadAdminData()
      toast('✓ Usuario actualizado')
    } catch (e) { toast(e.message, true) }
  }

  // Eliminar usuario
  const deleteUser = async (id, username) => {
    try {
      await api(`/admin/users/${id}`, { method: 'DELETE' })
      loadAdminData()
      toast(`🗑 ${username} desactivado`)
    } catch (e) { toast(e.message, true) }
  }

  const myActiveRespawnId = respawns.find(r =>
    r.claim?.holder_name === user?.username || r.claim?.next_name === user?.username
  )?.id

  if (!user) return (
    <div style={{ background: '#0f0f13', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 10, padding: 32, width: 320 }}>
        <div style={{ fontFamily: "'Cinzel',serif", color: '#c9a84c', fontSize: 22, textAlign: 'center', marginBottom: 4 }}>⚔ {guildName}</div>
        <div style={{ color: '#555', fontSize: 12, textAlign: 'center', marginBottom: 24 }}>Guild Respawn Manager</div>
        {loginErr && <div style={{ background: '#3a0d0d', border: '1px solid #c0392b55', borderRadius: 5, padding: '8px 12px', color: '#e05252', fontSize: 13, marginBottom: 12 }}>{loginErr}</div>}
        <input value={loginForm.username} onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))}
          placeholder="Personaje" style={{ width: '100%', background: '#12121a', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '8px 12px', borderRadius: 5, fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }} />
        <input type="password" value={loginForm.password} onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && login()}
          placeholder="Contraseña" style={{ width: '100%', background: '#12121a', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '8px 12px', borderRadius: 5, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />
        <button onClick={login} style={{ width: '100%', background: '#c9a84c22', border: '1px solid #c9a84c88', color: '#c9a84c', padding: '10px', borderRadius: 5, cursor: 'pointer', fontFamily: "'Cinzel',serif", fontSize: 14 }}>
          Entrar a la Guild
        </button>
      </div>
    </div>
  )

  const bannerRespawns = respawns.filter(r => r.claim?.next_name === user.username)

  return (
    <div style={{ background: '#0f0f13', minHeight: '100vh', fontFamily: 'sans-serif', color: '#e0ddd5' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap');
        @keyframes fadeIn { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }
        @keyframes warPulse { 0%,100% { opacity:1 } 50% { opacity:0.6 } }
        * { box-sizing: border-box; }
        @media (max-width: 600px) { .cards-grid { grid-template-columns: 1fr !important; } .btn-full { width: 100%; } }
      `}</style>

      {/* MODO GUERRA BANNER */}
      {warMode && (
        <div style={{ background: '#3a0d0d', borderBottom: '2px solid #c0392b', padding: '8px 16px', textAlign: 'center', fontFamily: "'Cinzel',serif", color: '#e05252', fontSize: 14, animation: 'warPulse 2s infinite' }}>
          ⚔ MODO GUERRA ACTIVO — Todos los respawns pausados ⚔
        </div>
      )}

      {/* HEADER */}
      <div style={{ background: '#12121a', borderBottom: '1px solid #2a2a3a', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#c9a84c', fontSize: 20 }}>⚔</span>
          <div>
            <div style={{ fontFamily: "'Cinzel',serif", color: '#c9a84c', fontSize: 17, fontWeight: 600 }}>{guildName}</div>
            <div style={{ fontSize: 12, color: '#888' }}>🗡 {user.username} {user.role === 'admin' && <span style={{ color: '#c9a84c' }}>· Admin</span>}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {user.role === 'admin' && (
            <button onClick={() => { if (!confirmWar) { setConfirmWar(true); setTimeout(() => setConfirmWar(false), 4000) } else { toggleWarMode() } }}
              style={{ background: warMode ? '#c0392b33' : confirmWar ? '#c0392b44' : '#2a2a3a', border: `1px solid ${warMode ? '#c0392b' : confirmWar ? '#e05252' : '#3a3a4a'}`, color: warMode ? '#ff6b6b' : confirmWar ? '#ff6b6b' : '#aaa', padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontFamily: warMode || confirmWar ? "'Cinzel',serif" : 'sans-serif', transition: 'all .2s' }}>
              {warMode ? '✅ Desactivar Guerra' : confirmWar ? '⚔ ¿Confirmar?' : '⚔ Modo Guerra'}
            </button>
          )}
          <button onClick={logout} style={{ background: 'transparent', border: '1px solid #3a3a4a', color: '#888', padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Salir</button>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        {/* BANNER next */}
        {bannerRespawns.map(r => (
          <div key={r.id} style={{ background: '#1a1a24', border: '1px solid #c9a84c44', borderLeft: '3px solid #c9a84c', borderRadius: 6, padding: '10px 14px', marginBottom: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#c9a84c' }}>⚔</span>
            <span>Pronto es tu turno en <strong style={{ color: '#c9a84c' }}>{r.name}</strong> — <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{fmt(r.claim.seconds_left)}</span> restante al holder</span>
          </div>
        ))}

        {/* TABS */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {['respawns', ...(user.role === 'admin' ? ['admin'] : [])].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 13,
              border: `1px solid ${tab === t ? '#c9a84c' : '#2a2a3a'}`,
              background: tab === t ? '#c9a84c22' : '#12121a',
              color: tab === t ? '#c9a84c' : '#888',
              fontFamily: tab === t ? "'Cinzel',serif" : 'sans-serif'
            }}>
              {t === 'respawns' ? '⚔ Respawns' : '👑 Admin'}
            </button>
          ))}
        </div>

        {/* TAB RESPAWNS */}
        {tab === 'respawns' && (
          <>
            <div style={{ fontFamily: "'Cinzel',serif", color: '#c9a84c', fontSize: 12, letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #2a2a3a' }}>RESPAWNS</div>
            <div className="cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
              {respawns.map(r => {
                const c = r.claim
                const isHolder = c?.holder_name === user.username
                const isNext = c?.next_name === user.username
                const hasActive = !!myActiveRespawnId
                const sec = c ? Math.max(0, c.seconds_left) : 0
                const urgent = sec < 600

                return (
                  <div key={r.id} style={{ background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: "'Cinzel',serif", fontSize: 13, color: '#e8e4d8', fontWeight: 600 }}>{r.name}</span>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
                        background: r.maintenance ? '#2a2a2a' : isHolder ? '#0d1a3a' : !c ? '#0d3320' : '#3a0d0d',
                        color: r.maintenance ? '#777' : isHolder ? '#4a90d9' : !c ? '#4caf7a' : '#e05252',
                        border: `1px solid ${r.maintenance ? '#3a3a3a' : isHolder ? '#1a3a6a' : !c ? '#1d5535' : '#5a1a1a'}`
                      }}>
                        {r.maintenance ? (warMode ? '⚔ Guerra' : '') : isHolder ? 'Tu respawn' : !c ? 'Libre' : 'Ocupado'}
                      </span>
                    </div>

                    {r.maintenance && <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: '12px 0' }}>{warMode ? 'Pausado por Modo Guerra' : 'No disponible temporalmente'}</div>}

                    {!r.maintenance && !c && (
                      <>
                        <HoursBtns id={r.id} value={getH(r.id)} onChange={setH} />
                        <button className="btn-full" onClick={() => !hasActive && action(`/respawns/${r.id}/claim`, 'POST', { hours: getH(r.id) }, `⚔ Claimedaste ${r.name}!`)}
                          style={{ background: hasActive ? '#2a2a3a' : '#c9a84c22', border: `1px solid ${hasActive ? '#3a3a4a' : '#c9a84c88'}`, color: hasActive ? '#666' : '#c9a84c', padding: '6px 12px', borderRadius: 5, cursor: hasActive ? 'not-allowed' : 'pointer', fontSize: 12, width: '100%' }}>
                          ⚔ Claimear
                        </button>
                        {hasActive && <div style={{ fontSize: 11, color: '#555', marginTop: 5 }}>Ya tenés un respawn activo</div>}
                      </>
                    )}

                    {!r.maintenance && c && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ color: '#888', fontSize: 12 }}>🗡</span>
                          <span style={{ color: '#c9a84c', fontSize: 13, fontWeight: 500 }}>{c.holder_name}</span>
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: urgent ? '#e05252' : '#e8e4d8', letterSpacing: 2, margin: '4px 0 8px' }}>{fmt(sec)}</div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                          {c.next_name ? <>→ next: <span style={{ color: '#c9a84c' }}>{c.next_name}</span>{isNext && <span style={{ color: '#4caf7a', marginLeft: 6 }}>✓ eres vos</span>}</> : <span style={{ color: '#555' }}>— sin next</span>}
                        </div>
                        {isHolder && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {!confirm[r.id]
                              ? <button onClick={() => setConfirm(p => ({ ...p, [r.id]: true }))} style={{ background: '#c0392b22', border: '1px solid #c0392b88', color: '#e05252', padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Liberar</button>
                              : <>
                                <button onClick={() => { action(`/respawns/${r.id}/release`, 'POST', {}, `✓ Liberaste ${r.name}`); setConfirm(p => ({ ...p, [r.id]: false })) }} style={{ background: '#c0392b44', border: '1px solid #c0392b', color: '#ff6b6b', padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>¿Confirmar?</button>
                                <button onClick={() => setConfirm(p => ({ ...p, [r.id]: false }))} style={{ background: '#2a2a3a', border: '1px solid #3a3a4a', color: '#aaa', padding: '6px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>✕</button>
                              </>
                            }
{!c.next_name && sec <= 300 && (
  <button onClick={() => action(`/respawns/${r.id}/extend`, 'POST', {}, `⏱ Extendiste ${r.name} a 3h`)} style={{ background: '#c9a84c22', border: '1px solid #c9a84c88', color: '#c9a84c', padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Extender 3h</button>
)}
{!c.next_name && sec > 300 && (
  <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Extender disponible con menos de 5 min</div>
)}                          </div>
                        )}
                        {isNext && (
                          <button onClick={() => action(`/respawns/${r.id}/leave-queue`, 'POST', {}, `↩ Saliste de la cola`)} style={{ background: '#c0392b22', border: '1px solid #c0392b88', color: '#e05252', padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Salir de la cola</button>
                        )}
                        {!isHolder && !isNext && !c.next_name && !hasActive && (
                          <>
                            <HoursBtns id={r.id} value={getH(r.id)} onChange={setH} />
                            <button onClick={() => action(`/respawns/${r.id}/join-queue`, 'POST', { hours: getH(r.id) }, `📋 Estás en cola para ${r.name}`)} style={{ background: '#1a3a6a22', border: '1px solid #4a90d966', color: '#4a90d9', padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12, width: '100%' }}>📋 Anotarme como next</button>
                          </>
                        )}
                        {!isHolder && !isNext && c.next_name && (
                          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Cola completa</div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* TAB ADMIN */}
        {tab === 'admin' && user.role === 'admin' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Nombre de Guild */}
            <div style={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 8, padding: 14 }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: '#c9a84c', fontSize: 12, letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #2a2a3a' }}>NOMBRE DE LA GUILD</div>
              {!editingGuildName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: "'Cinzel',serif", color: '#e8e4d8', fontSize: 16 }}>{guildName}</span>
                  <button onClick={() => { setTempGuildName(guildName); setEditingGuildName(true) }} style={{ background: '#1a1a24', border: '1px solid #3a3a4a', color: '#aaa', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>✏ Editar</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={tempGuildName} onChange={e => setTempGuildName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveGuildName()}
                    style={{ flex: 1, background: '#1a1a24', border: '1px solid #c9a84c88', color: '#e0ddd5', padding: '6px 10px', borderRadius: 5, fontSize: 14, fontFamily: "'Cinzel',serif" }} />
                  <button onClick={saveGuildName} style={{ background: '#c9a84c22', border: '1px solid #c9a84c88', color: '#c9a84c', padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Guardar</button>
                  <button onClick={() => setEditingGuildName(false)} style={{ background: '#2a2a3a', border: '1px solid #3a3a4a', color: '#888', padding: '6px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
              )}
            </div>

            {/* Respawns CRUD */}
            <div style={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 8, padding: 14 }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: '#c9a84c', fontSize: 12, letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #2a2a3a' }}>GESTIÓN DE RESPAWNS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{['Respawn', 'Estado', 'Acciones'].map(h => <th key={h} style={{ textAlign: 'left', color: '#888', padding: '6px 8px', borderBottom: '1px solid #2a2a3a', fontWeight: 500 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {respawns.map(r => (
                    <tr key={r.id}>
                      <td style={{ padding: '6px 8px', color: '#c9a84c', fontFamily: "'Cinzel',serif" }}>{r.name}</td>
                      <td style={{ padding: '6px 8px' }}>{r.claim ? <span style={{ color: '#e05252', fontSize: 11 }}>🗡 {r.claim.holder_name}</span> : <span style={{ color: '#4caf7a', fontSize: 11 }}>Libre</span>} {r.maintenance && <span style={{ color: '#777', marginLeft: 4, fontSize: 11 }}>[Mant.]</span>}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.claim && <button onClick={() => action(`/admin/respawns/${r.id}/force-release`, 'POST', {}, '⚡ Liberado forzosamente')} style={{ background: '#3a0d0d', border: '1px solid #c0392b88', color: '#e05252', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>⚡ Forzar</button>}
                          <button onClick={async () => { await api(`/admin/respawns/${r.id}`, { method: 'PUT', body: { maintenance: !r.maintenance } }); loadRespawns() }} style={{ background: '#1a1a2a', border: '1px solid #3a3a4a', color: '#aaa', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>{r.maintenance ? '✓ Reactivar' : '⏸ Pausar'}</button>
                          <button onClick={async () => { try { await api(`/admin/respawns/${r.id}`, { method: 'DELETE' }); loadRespawns(); toast('🗑 Eliminado') } catch (e) { toast(e.message, true) } }} style={{ background: '#2a2a2a', border: '1px solid #3a3a4a', color: '#666', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input value={newRespawn} onChange={e => setNewRespawn(e.target.value)} placeholder="Nombre del respawn" style={{ flex: 1, background: '#1a1a24', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '6px 10px', borderRadius: 5, fontSize: 13 }} />
                <button onClick={async () => { if (!newRespawn.trim()) return; try { await api('/admin/respawns', { method: 'POST', body: { name: newRespawn } }); setNewRespawn(''); loadRespawns(); toast('✓ Respawn creado') } catch (e) { toast(e.message, true) } }} style={{ background: '#c9a84c22', border: '1px solid #c9a84c88', color: '#c9a84c', padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>+ Agregar</button>
              </div>
            </div>

            {/* Usuarios */}
            <div style={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 8, padding: 14 }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: '#c9a84c', fontSize: 12, letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #2a2a3a' }}>PERSONAJES</div>

              {/* Modal editar usuario */}
              {editingUser && (
                <div style={{ background: '#1a1a24', border: '1px solid #c9a84c44', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                  <div style={{ color: '#c9a84c', fontSize: 13, marginBottom: 10, fontFamily: "'Cinzel',serif" }}>Editando: {editingUser.username}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input value={editUserForm.password} onChange={e => setEditUserForm(p => ({ ...p, password: e.target.value }))}
                      placeholder="Nueva contraseña (dejar vacío para no cambiar)"
                      type="password"
                      style={{ flex: 1, minWidth: 160, background: '#12121a', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '6px 10px', borderRadius: 5, fontSize: 13 }} />
                    <select value={editUserForm.role} onChange={e => setEditUserForm(p => ({ ...p, role: e.target.value }))}
                      style={{ background: '#12121a', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '6px 10px', borderRadius: 5, fontSize: 13 }}>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button onClick={saveEditUser} style={{ background: '#c9a84c22', border: '1px solid #c9a84c88', color: '#c9a84c', padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Guardar</button>
                    <button onClick={() => setEditingUser(null)} style={{ background: '#2a2a3a', border: '1px solid #3a3a4a', color: '#888', padding: '6px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>✕</button>
                  </div>
                </div>
              )}

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{['Personaje', 'Rol', 'Estado', 'Acciones'].map(h => <th key={h} style={{ textAlign: 'left', color: '#888', padding: '6px 8px', borderBottom: '1px solid #2a2a3a', fontWeight: 500 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {adminUsers.map(u => (
                    <tr key={u.id}>
                      <td style={{ padding: '6px 8px', color: '#e8e4d8' }}>{u.username}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: u.role === 'admin' ? '#0d1a3a' : '#0d3320', color: u.role === 'admin' ? '#4a90d9' : '#4caf7a', border: `1px solid ${u.role === 'admin' ? '#1a3a6a' : '#1d5535'}` }}>{u.role}</span>
                      </td>
                      <td style={{ padding: '6px 8px', color: u.active ? '#4caf7a' : '#e05252', fontSize: 11 }}>{u.active ? 'Activo' : 'Inactivo'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => { setEditingUser(u); setEditUserForm({ password: '', role: u.role }) }}
                            style={{ background: '#1a1a2a', border: '1px solid #3a3a4a', color: '#aaa', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>✏ Editar</button>
                          {u.role !== 'admin' && (
                            <button onClick={() => deleteUser(u.id, u.username)}
                              style={{ background: '#3a0d0d', border: '1px solid #c0392b55', color: '#e05252', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>🗑 Desactivar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} placeholder="Nombre del personaje" style={{ flex: 1, minWidth: 120, background: '#1a1a24', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '6px 10px', borderRadius: 5, fontSize: 13 }} />
                <input type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="Contraseña" style={{ flex: 1, minWidth: 120, background: '#1a1a24', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '6px 10px', borderRadius: 5, fontSize: 13 }} />
                <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))} style={{ background: '#1a1a24', border: '1px solid #3a3a4a', color: '#e0ddd5', padding: '6px 10px', borderRadius: 5, fontSize: 13 }}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
                <button onClick={async () => { if (!newUser.username || !newUser.password) return; try { await api('/admin/users', { method: 'POST', body: newUser }); setNewUser({ username: '', password: '', role: 'member' }); loadAdminData(); toast('✓ Personaje creado') } catch (e) { toast(e.message, true) } }} style={{ background: '#c9a84c22', border: '1px solid #c9a84c88', color: '#c9a84c', padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>+ Crear</button>
              </div>
            </div>

            {/* Logs */}
            <div style={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 8, padding: 14 }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: '#c9a84c', fontSize: 12, letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #2a2a3a' }}>LOG DE ACTIVIDAD</div>
              {adminLogs.slice(0, 30).map(l => {
                const colors = { claim: ['#0d3320', '#4caf7a'], release: ['#3a0d0d', '#e05252'], extend: ['#1a1a0a', '#c9a84c'], join_queue: ['#0d1a3a', '#4a90d9'], leave_queue: ['#3a0d0d', '#e05252'], force_release: ['#3a0d1a', '#e052a0'], expired_passed: ['#0d1a3a', '#4a90d9'], expired_freed: ['#2a2a2a', '#888'] }
                const [bg, col] = colors[l.action] || ['#2a2a2a', '#aaa']
                return (
                  <div key={l.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '5px 0', borderBottom: '1px solid #1a1a24', alignItems: 'center' }}>
                    <span style={{ color: '#c9a84c', minWidth: 70 }}>{l.username}</span>
                    <span style={{ color: '#aaa', flex: 1 }}>{l.respawn_name}</span>
                    <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: bg, color: col }}>{l.action}</span>
                    <span style={{ color: '#555', fontSize: 11 }}>{new Date(l.created_at).toLocaleTimeString()}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <Toast toasts={toasts} />
    </div>
  )
}