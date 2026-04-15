export default function MetricCard({ label, value, hint, tone = 'total' }) {
  const valueClassName = `metric-value metric-value-${tone}`

  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className={valueClassName}>{value}</strong>
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </div>
  )
}
