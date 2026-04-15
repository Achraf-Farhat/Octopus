export default function SearchBar({ value, onChange, onTranslate, busy = false }) {
  return (
    <div className="search-card">
      <label htmlFor="nl-search">Natural language search</label>
      <div className="search-row">
        <input
          id="nl-search"
          type="text"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder="Show me SSH brute force from China today"
        />
        <button type="button" disabled={busy} onClick={onTranslate}>
          {busy ? 'Translating…' : 'Translate'}
        </button>
      </div>
    </div>
  )
}
