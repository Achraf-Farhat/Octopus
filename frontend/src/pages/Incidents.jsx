import { useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'

export default function Incidents() {
  const [incidents, setIncidents] = useState([])
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadIncidents() {
    try {
      const response = await api.get('/incidents')
      setIncidents(response.data ?? [])
    } catch {
      setError('Could not load incidents.')
    }
  }

  useEffect(() => {
    loadIncidents()
  }, [])

  async function createIncident(event) {
    event.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.post('/incidents', { title: title.trim(), severity })
      setTitle('')
      setSeverity('medium')
      await loadIncidents()
    } catch {
      setError('Could not create incident. Requires L2 or higher.')
    } finally {
      setBusy(false)
    }
  }

  async function updateStatus(id, status) {
    try {
      await api.patch(`/incidents/${id}`, { status })
      await loadIncidents()
    } catch {
      setError('Could not update incident status.')
    }
  }

  return (
    <AppLayout>
      <section className="panel page-header">
        <h1>Incidents</h1>
        <p className="muted">Create, triage, and track SOC incidents.</p>
      </section>

      <section className="panel form-panel">
        <h2>New incident</h2>
        <form className="two-col" onSubmit={createIncident}>
          <input placeholder="Incident title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create incident'}</button>
        </form>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Incident queue</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>{incident.title}</td>
                  <td>{incident.severity}</td>
                  <td>{incident.status}</td>
                  <td>{incident.created_at ? new Date(incident.created_at).toLocaleString() : '-'}</td>
                  <td>
                    <button type="button" onClick={() => updateStatus(incident.id, 'in_progress')}>In progress</button>
                    <button type="button" onClick={() => updateStatus(incident.id, 'closed')}>Close</button>
                  </td>
                </tr>
              ))}
              {!incidents.length ? (
                <tr>
                  <td colSpan={5} className="muted">No incidents yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppLayout>
  )
}
