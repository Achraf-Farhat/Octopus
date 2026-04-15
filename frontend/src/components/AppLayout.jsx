import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function Icon({ name }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (name === 'dashboard') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="5" rx="2" />
        <rect x="13" y="10" width="8" height="11" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
      </svg>
    )
  }
  if (name === 'hunt') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    )
  }
  if (name === 'incidents') {
    return (
      <svg {...common}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    )
  }
  if (name === 'rules') {
    return (
      <svg {...common}>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.3-3.3a6 6 0 0 1-7.9 7.9l-6.9 6.9a2 2 0 1 1-2.8-2.8l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
      </svg>
    )
  }
  if (name === 'playbooks') {
    return (
      <svg {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  )
}

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/threat-hunt', label: 'Threat Hunt', icon: 'hunt' },
  { to: '/incidents', label: 'Incidents', icon: 'incidents' },
  { to: '/rules', label: 'Rules', icon: 'rules' },
  { to: '/playbooks', label: 'Playbooks', icon: 'playbooks' },
  { to: '/users', label: 'Users', icon: 'users' },
]

export default function AppLayout({ children }) {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(true)
  const shellClassName = useMemo(() => (collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'), [collapsed])

  return (
    <div className={shellClassName}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div>
            <span className="brand">Octopus</span>
            {!collapsed ? <p className="muted">AI-enhanced SOC platform</p> : null}
          </div>
          <button type="button" className="collapse-btn" onClick={() => setCollapsed((prev) => !prev)} aria-label="Toggle menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? (
                <polyline points="9 18 15 12 9 6" />
              ) : (
                <polyline points="15 18 9 12 15 6" />
              )}
            </svg>
          </button>
        </div>

        <nav className="side-links">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active-link nav-link' : 'nav-link')} title={collapsed ? link.label : undefined}>
              <span className="nav-icon"><Icon name={link.icon} /></span>
              {!collapsed ? <span>{link.label}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!collapsed ? (
            <div>
              <div className="muted small">Signed in as</div>
              <strong>{user?.username ?? 'unknown'}</strong>
            </div>
          ) : null}
          <button type="button" onClick={logout} className="secondary-button" title={collapsed ? 'Logout' : undefined}>
            {!collapsed ? (
              'Logout'
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            )}
          </button>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  )
}
