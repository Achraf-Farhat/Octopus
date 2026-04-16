function formatAlertTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '—'

  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(date)

  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(date)

  return `${datePart} @ ${timePart}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

function getSeverityTone(value) {
  if (value === null || value === undefined) return 'low'
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    if (numeric >= 14) return 'critical'
    if (numeric >= 10) return 'high'
    if (numeric >= 6) return 'medium'
    return 'low'
  }

  const text = String(value).toLowerCase()
  if (text.includes('critical')) return 'critical'
  if (text.includes('high') || text.includes('error')) return 'high'
  if (text.includes('medium') || text.includes('warning')) return 'medium'
  return 'low'
}

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
              <th>Timestamp</th>
              <th>Source IP</th>
              <th>Severity</th>
              <th>Rule</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="4" className="muted">Loading alerts…</td>
              </tr>
            ) : alerts.length ? (
              alerts.map((alert) => {
                const tone = getSeverityTone(alert.severity)
                return (
                  <tr
                    key={alert.id}
                    className={`alert-row ${selectedId === alert.id ? 'selected-row' : ''}`.trim()}
                    onClick={() => onSelectAlert?.(alert)}
                  >
                    <td>{formatAlertTimestamp(alert.timestamp)}</td>
                    <td>{alert.source}</td>
                    <td>
                      <strong className={`severity-value severity-${tone}`}>{alert.severity}</strong>
                    </td>
                    <td>{alert.rule}</td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan="4" className="muted">No alerts available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
