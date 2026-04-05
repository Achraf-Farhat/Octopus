export default function AlertTable({ alerts = [], loading = false, selectedId, onSelectAlert }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Recent alerts</h2>
        <span className="pill">{alerts.length} items</span>
      </div>
      <div className="table-wrap">
        <table className="alerts-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Timestamp</th>
              <th>Source IP</th>
              <th>Severity</th>
              <th>Rule</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" className="muted">Loading alerts…</td>
              </tr>
            ) : alerts.length ? (
              alerts.map((alert) => (
                <tr
                  key={alert.id}
                  className={selectedId === alert.id ? 'selected-row' : ''}
                  onClick={() => onSelectAlert?.(alert)}
                >
                  <td>{alert.id}</td>
                  <td>{alert.timestamp || '—'}</td>
                  <td>{alert.source}</td>
                  <td>{alert.severity}</td>
                  <td>{alert.rule}</td>
                  <td>{alert.status}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="muted">No alerts available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
