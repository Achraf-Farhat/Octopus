export default function AIExplanation({ explanation, onExplain, busy = false, selectedAlert }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>AI explanation</h2>
        <span className="pill">Cached in Redis</span>
      </div>
      <p className="muted">{explanation}</p>
      <button type="button" onClick={onExplain} disabled={busy || !selectedAlert}>
        {busy ? 'Explaining…' : 'Explain selected alert'}
      </button>
    </div>
  )
}
