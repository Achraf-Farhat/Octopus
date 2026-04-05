import { useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'

export default function Playbooks() {
  const [playbooks, setPlaybooks] = useState([])
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState('rule.level >= 10')
  const [stepsText, setStepsText] = useState('[{"action":"notify","channel":"slack"}]')
  const [error, setError] = useState('')

  async function loadPlaybooks() {
    try {
      const response = await api.get('/playbooks')
      setPlaybooks(response.data ?? [])
    } catch {
      setError('Could not load playbooks.')
    }
  }

  useEffect(() => {
    loadPlaybooks()
  }, [])

  async function createPlaybook(event) {
    event.preventDefault()
    setError('')
    try {
      const steps = JSON.parse(stepsText)
      await api.post('/playbooks', { name, trigger_condition: trigger, steps })
      setName('')
      await loadPlaybooks()
    } catch {
      setError('Could not create playbook. Check role and steps JSON format.')
    }
  }

  async function executePlaybook(id) {
    setError('')
    try {
      await api.post(`/playbooks/${id}/execute`)
      await loadPlaybooks()
    } catch {
      setError('Could not execute playbook. Requires L2 or higher.')
    }
  }

  return (
    <AppLayout>
      <section className="panel page-header">
        <h1>Playbooks</h1>
        <p className="muted">Define and run incident response playbooks.</p>
      </section>

      <section className="panel form-panel">
        <h2>New playbook</h2>
        <form className="stacked-panel" onSubmit={createPlaybook}>
          <input placeholder="Playbook name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Trigger condition" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
          <textarea className="code-input" rows={6} value={stepsText} onChange={(e) => setStepsText(e.target.value)} />
          <button type="submit">Create playbook</button>
        </form>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="panel">
        <h2>Available playbooks</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger</th>
                <th>Steps</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {playbooks.map((playbook) => (
                <tr key={playbook.id}>
                  <td>{playbook.name}</td>
                  <td>{playbook.trigger_condition || '-'}</td>
                  <td>{Array.isArray(playbook.steps) ? playbook.steps.length : 0}</td>
                  <td>
                    <button type="button" onClick={() => executePlaybook(playbook.id)}>Run now</button>
                  </td>
                </tr>
              ))}
              {!playbooks.length ? (
                <tr>
                  <td colSpan={4} className="muted">No playbooks yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppLayout>
  )
}
