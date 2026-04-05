import { useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'

export default function Rules() {
  const [rules, setRules] = useState([])
  const [form, setForm] = useState({ rule_id: '', name: '', xml_content: '<rule id="100500" level="10"></rule>' })
  const [error, setError] = useState('')

  async function loadRules() {
    try {
      const response = await api.get('/rules')
      setRules(response.data ?? [])
    } catch {
      setError('Could not load rules.')
    }
  }

  useEffect(() => {
    loadRules()
  }, [])

  async function createRule(event) {
    event.preventDefault()
    setError('')
    try {
      await api.post('/rules', form)
      setForm({ rule_id: '', name: '', xml_content: '<rule id="100500" level="10"></rule>' })
      await loadRules()
    } catch {
      setError('Could not create rule. Requires Manager or higher.')
    }
  }

  async function deployRule(id) {
    setError('')
    try {
      await api.post(`/rules/${id}/deploy`)
      await loadRules()
    } catch {
      setError('Could not deploy rule. Requires Admin role.')
    }
  }

  return (
    <AppLayout>
      <section className="panel page-header">
        <h1>Custom Rules</h1>
        <p className="muted">Create and deploy local detection rules.</p>
      </section>

      <section className="panel form-panel">
        <h2>New rule</h2>
        <form className="stacked-panel" onSubmit={createRule}>
          <input placeholder="Rule ID" value={form.rule_id} onChange={(e) => setForm((prev) => ({ ...prev, rule_id: e.target.value }))} />
          <input placeholder="Rule name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          <textarea className="code-input" value={form.xml_content} onChange={(e) => setForm((prev) => ({ ...prev, xml_content: e.target.value }))} rows={6} />
          <button type="submit">Create rule</button>
        </form>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="panel">
        <h2>Rule registry</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Deployed at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.rule_id}</td>
                  <td>{rule.name}</td>
                  <td>{rule.status}</td>
                  <td>{rule.deployed_at ? new Date(rule.deployed_at).toLocaleString() : '-'}</td>
                  <td>
                    <button type="button" onClick={() => deployRule(rule.id)} disabled={rule.status === 'deployed'}>
                      {rule.status === 'deployed' ? 'Deployed' : 'Deploy'}
                    </button>
                  </td>
                </tr>
              ))}
              {!rules.length ? (
                <tr>
                  <td colSpan={5} className="muted">No rules yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppLayout>
  )
}
