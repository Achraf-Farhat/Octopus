import { useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'

export default function Users() {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'L1' })
  const [error, setError] = useState('')

  async function loadUsers() {
    try {
      const response = await api.get('/users')
      setUsers(response.data ?? [])
    } catch {
      setError('Could not load users. Requires Manager or higher.')
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  async function createUser(event) {
    event.preventDefault()
    setError('')
    try {
      await api.post('/users', form)
      setForm({ username: '', email: '', password: '', role: 'L1' })
      await loadUsers()
    } catch {
      setError('Could not create user. Requires Admin role.')
    }
  }

  return (
    <AppLayout>
      <section className="panel page-header">
        <h1>Users</h1>
        <p className="muted">Manage SOC platform user accounts and roles.</p>
      </section>

      <section className="panel form-panel">
        <h2>Create user</h2>
        <form className="two-col" onSubmit={createUser}>
          <input placeholder="Username" value={form.username} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
          <input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
          <select value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}>
            <option value="L1">L1</option>
            <option value="L2">L2</option>
            <option value="L3">L3</option>
            <option value="Manager">Manager</option>
            <option value="Admin">Admin</option>
          </select>
          <button type="submit">Create user</button>
        </form>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="panel">
        <h2>Current users</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{user.is_active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan={4} className="muted">No users available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppLayout>
  )
}
