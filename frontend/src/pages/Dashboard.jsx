import { useEffect, useMemo, useState } from 'react'
import AlertTable from '../components/AlertTable'
import AIExplanation from '../components/AIExplanation'
import AlertsTrendChart from '../components/AlertsTrendChart'
import AppLayout from '../components/AppLayout'
import MetricCard from '../components/MetricCard'
import SearchBar from '../components/SearchBar'
import api from '../lib/api'

function queryHasExplicitTimeClause(query) {
  const text = String(query || '')
  return /@timestamp\s*:\s*\[|\btimestamp\b|\bnow\s*[-+]/i.test(text)
}

function parseTranslationTimeRange(timeRange, fallbackQuery = '') {
  const normalized = String(timeRange || '').toLowerCase()
  const source = String(fallbackQuery || '').toLowerCase()

  if (normalized.includes('hour') || source.includes('last hour')) return { mode: 'relative', value: 1, unit: 'hours', preset: 'hours' }
  if (normalized.includes('today') || source.includes('today')) return { mode: 'relative', value: 1, unit: 'days', preset: 'days' }
  if (normalized.includes('day') || source.includes('day')) return { mode: 'relative', value: 7, unit: 'days', preset: 'days' }
  if (normalized.includes('month') || source.includes('month')) return { mode: 'relative', value: 1, unit: 'months', preset: 'months' }
  if (normalized.includes('year') || source.includes('year')) return { mode: 'relative', value: 1, unit: 'years', preset: 'years' }
  return null
}

function mergeQuery(baseQuery, timeClause) {
  const primary = (baseQuery || '').trim()
  const time = (timeClause || '').trim()
  if (primary && queryHasExplicitTimeClause(primary)) return primary
  if (primary && time) return `(${primary}) AND (${time})`
  return primary || time || ''
}

function getTimelineInterval(timeFilter) {
  if (!timeFilter || timeFilter.mode === 'all') return 'month'
  const value = Number(timeFilter.value)
  if (!Number.isFinite(value) || value <= 0) return 'day'

  if (timeFilter.unit === 'hours') return 'hour'
  if (timeFilter.unit === 'days') {
    if (value <= 7) return 'hour'
    if (value <= 90) return 'day'
    return 'week'
  }
  if (timeFilter.unit === 'months') {
    if (value <= 6) return 'week'
    if (value <= 24) return 'month'
    return 'year'
  }
  return value <= 2 ? 'month' : 'year'
}

function buildAlertDetailsDocument(item) {
  if (!item || typeof item !== 'object') return {}

  const source = item._source && typeof item._source === 'object' ? item._source : item
  const fields = item.fields && typeof item.fields === 'object' ? item.fields : {}

  const normalizedFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, value.length === 1 ? value[0] : value.join(', ')]
      }
      return [key, value]
    }),
  )

  return {
    _index: item._index,
    _id: item._id,
    _version: item._version,
    _score: item._score,
    ...source,
    ...normalizedFields,
    fields,
    highlight: item.highlight,
    sort: item.sort,
  }
}

function flattenObjectEntries(value, parentKey = '') {
  if (value === null || value === undefined) return [{ key: parentKey || 'value', value: 'null' }]
  if (Array.isArray(value)) return [{ key: parentKey || 'value', value: value.length ? value.join(', ') : '[]' }]
  if (typeof value !== 'object') return [{ key: parentKey || 'value', value: String(value) }]

  const entries = []
  for (const [key, nested] of Object.entries(value)) {
    const nextKey = parentKey ? `${parentKey}.${key}` : key
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      entries.push(...flattenObjectEntries(nested, nextKey))
    } else if (Array.isArray(nested)) {
      entries.push({ key: nextKey, value: nested.length ? nested.join(', ') : '[]' })
    } else if (nested === null || nested === undefined || nested === '') {
      entries.push({ key: nextKey, value: '—' })
    } else {
      entries.push({ key: nextKey, value: String(nested) })
    }
  }

  return entries
}

function normalizeAlert(item) {
  const sourceDoc = item?._source && typeof item._source === 'object' ? item._source : item
  const fallbackSeverityMap = { critical: 14, error: 12, warning: 7, info: 3, debug: 1 }
  const fallbackSeverity = fallbackSeverityMap[String(sourceDoc.level ?? '').toLowerCase()]
  const normalizedSeverity = sourceDoc.rule?.level ?? sourceDoc.severity ?? fallbackSeverity ?? 'n/a'
  const fieldTimestamp = Array.isArray(item?.fields?.timestamp) ? item.fields.timestamp[0] : null

  return {
    id: sourceDoc.id ?? item._id ?? item.wazuh_alert_id ?? `${sourceDoc['@timestamp'] ?? sourceDoc.timestamp ?? ''}-${sourceDoc.tag ?? ''}`,
    timestamp: sourceDoc['@timestamp'] ?? sourceDoc.timestamp ?? fieldTimestamp ?? '',
    source: sourceDoc.data?.srcip ?? sourceDoc.src_ip ?? sourceDoc.agent?.ip ?? sourceDoc.agent?.name ?? sourceDoc.tag ?? 'unknown',
    severity: normalizedSeverity,
    rule: sourceDoc.rule?.id ?? sourceDoc.rule_id ?? sourceDoc.tag ?? 'n/a',
    status: sourceDoc.status ?? 'new',
    raw: item,
  }
}

export default function Dashboard() {
  const [alerts, setAlerts] = useState([])
  const [trendPoints, setTrendPoints] = useState([])
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [explanation, setExplanation] = useState('Select an alert to generate an explanation.')
  const [metrics, setMetrics] = useState({ total: 0, low: 0, medium: 0, high: 0, critical: 0 })
  const [search, setSearch] = useState('SSH brute force from IP today')
  const [translation, setTranslation] = useState('')
  const [translationMeta, setTranslationMeta] = useState({ language: 'dql', confidence: null, timeRange: 'unspecified', notes: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('')
  const [totalAlerts, setTotalAlerts] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [activeBaseQuery, setActiveBaseQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState({ mode: 'all', value: 30, unit: 'days', startDate: '', endDate: '', preset: 'all' })

  function buildCalendarClause(filter) {
    if (!filter || filter.mode === 'all') return ''
    if (filter.mode === 'custom' && filter.startDate && filter.endDate) {
      const start = new Date(filter.startDate)
      const end = new Date(filter.endDate)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
      return `@timestamp:[${start.toISOString()} TO ${end.toISOString()}]`
    }
    if (filter.mode === 'relative') {
      const value = Number(filter.value)
      if (!Number.isFinite(value) || value <= 0) return ''
      const suffix = filter.unit === 'hours' ? 'h' : filter.unit === 'months' ? 'M' : filter.unit === 'years' ? 'y' : 'd'
      return `@timestamp:[now-${value}${suffix} TO now]`
    }
    return ''
  }

  function getIntervalOptions() {
    return [
      { key: 'all', label: 'All time' },
      { key: 'hours', label: 'Hours' },
      { key: 'days', label: 'Days' },
      { key: 'months', label: 'Months' },
      { key: 'years', label: 'Years' },
      { key: 'custom', label: 'Custom' },
    ]
  }

  function applyCalendarMode(nextMode) {
    setTimeFilter((previous) => {
      if (nextMode === 'all') return { mode: 'all', value: 30, unit: 'days', startDate: '', endDate: '', preset: 'all' }
      if (nextMode === 'custom') return { ...previous, mode: 'custom', preset: 'custom' }
      const nextUnit = nextMode === 'hours' ? 'hours' : nextMode === 'days' ? 'days' : nextMode === 'months' ? 'months' : nextMode === 'years' ? 'years' : previous.unit
      const nextValue = nextMode === 'hours' ? 6 : nextMode === 'days' ? 7 : nextMode === 'months' ? 1 : nextMode === 'years' ? 1 : previous.value
      return { ...previous, mode: 'relative', unit: nextUnit, value: nextValue, preset: nextMode }
    })
  }

  async function loadAlerts(baseQuery, nextPage = 1) {
    const finalBaseQuery = baseQuery ?? ''
    const combinedQuery = mergeQuery(finalBaseQuery, buildCalendarClause(timeFilter))
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/alerts', {
        params: {
          ...(combinedQuery ? { query: combinedQuery } : {}),
          limit: pageSize,
          offset: Math.max(0, (nextPage - 1) * pageSize),
        },
      })
      const items = (response.data?.data?.items ?? []).map(normalizeAlert)
      const total = Number(response.data?.data?.total ?? items.length)
      setTotalAlerts(Number.isFinite(total) ? total : items.length)
      setPage(nextPage)
      setActiveBaseQuery(finalBaseQuery)
      setActiveQuery(combinedQuery)
      setAlerts(items)
      setSelectedAlert(items[0] ?? null)
      setExplanation(items[0] ? 'Use the AI explain button to summarize the selected alert.' : 'No alerts available.')
      if (response.data?.data?.source === 'cache') {
        setError(`Live Wazuh unavailable. Showing cached alerts. ${response.data?.data?.message ?? ''}`.trim())
      }
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(detail ? `Could not load alerts from Wazuh: ${detail}` : 'Could not load alerts from Wazuh.')
    } finally {
      setLoading(false)
    }
  }

  async function loadSummary(baseQuery) {
    const finalBaseQuery = baseQuery ?? ''
    const combinedQuery = mergeQuery(finalBaseQuery, buildCalendarClause(timeFilter))
    try {
      const response = await api.get('/alerts/summary', {
        params: {
          ...(combinedQuery ? { query: combinedQuery } : {}),
          interval: getTimelineInterval(timeFilter),
        },
      })
      const data = response.data?.data ?? {}
      const severity = data?.severity ?? {}
      setMetrics({
        total: Number(data?.total ?? 0) || 0,
        low: Number(severity.low ?? 0) || 0,
        medium: Number(severity.medium ?? 0) || 0,
        high: Number(severity.high ?? 0) || 0,
        critical: Number(severity.critical ?? 0) || 0,
      })
      setTrendPoints(Array.isArray(data?.timeline) ? data.timeline : [])
      if (data?.source === 'cache') {
        setError(`Live Wazuh unavailable. Showing cached summary. ${data?.message ?? ''}`.trim())
      }
    } catch {
      setMetrics({ total: 0, low: 0, medium: 0, high: 0, critical: 0 })
      setTrendPoints([])
    }
  }

  useEffect(() => {
    Promise.all([loadAlerts('', 1), loadSummary('')])
  }, [])

  async function translateQuery() {
    setBusy(true)
    setError('')
    try {
      const response = await api.post('/ai/translate-search', { query: search, mode: 'auto' }, { timeout: 90000 })
      const translatedQuery = response.data?.query ?? response.data?.dql ?? ''
      setTranslation(translatedQuery || 'No translation returned.')
      setTranslationMeta({
        language: response.data?.language ?? 'dql',
        confidence: typeof response.data?.confidence === 'number' ? response.data.confidence : null,
        timeRange: response.data?.time_range ?? 'unspecified',
        notes: response.data?.notes ?? '',
      })
      const inferredFilter = parseTranslationTimeRange(response.data?.time_range, search)
      if (inferredFilter) {
        setTimeFilter((previous) => ({ ...previous, ...inferredFilter }))
      }
      return translatedQuery
    } catch (err) {
      if (err?.code === 'ECONNABORTED') {
        setError('AI translation timed out. Try a shorter query or retry in a few seconds.')
      } else {
        const detail = err?.response?.data?.detail
        setError(detail ? `AI translation failed: ${detail}` : 'AI translation failed.')
      }
      return ''
    } finally {
      setBusy(false)
    }
  }

  async function handleTranslateOnly() {
    await translateQuery()
  }

  async function handleTranslateAndSearch() {
    const translated = await translateQuery()
    if (!translated) return
    await Promise.all([loadAlerts(translated, 1), loadSummary(translated)])
  }

  async function runTranslatedSearch() {
    const cleaned = (translation || '').trim()
    if (!cleaned) {
      setError('Please translate first or enter a query to search.')
      return
    }
    await Promise.all([loadAlerts(cleaned, 1), loadSummary(cleaned)])
  }

  async function applyTimeFilter() {
    await Promise.all([loadAlerts(activeBaseQuery, 1), loadSummary(activeBaseQuery)])
  }

  async function goToNextPage() {
    const hasMore = page * pageSize < totalAlerts
    if (!hasMore || loading) return
    await loadAlerts(activeBaseQuery, page + 1)
  }

  async function goToPreviousPage() {
    if (page <= 1 || loading) return
    await loadAlerts(activeBaseQuery, page - 1)
  }

  async function explainSelectedAlert() {
    if (!selectedAlert) return
    setBusy(true)
    setError('')
    try {
      const response = await api.post('/ai/explain-alert', {
        rule_description: `Rule ${selectedAlert.rule}`,
        severity: String(selectedAlert.severity),
        src_ip: selectedAlert.source,
        mitre_technique: 'T0000',
        alert_data: JSON.stringify(selectedAlert.raw),
      })
      setExplanation(response.data?.explanation ?? 'No explanation returned.')
    } catch {
      setError('AI explanation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function copySelectedAlertJson() {
    if (!selectedAlert?.raw) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedAlert.raw, null, 2))
      setCopyState('Copied')
      setTimeout(() => setCopyState(''), 1500)
    } catch {
      setCopyState('Copy failed')
      setTimeout(() => setCopyState(''), 1500)
    }
  }

  const cards = useMemo(
    () => [
      { label: 'Active alerts', value: metrics.total, hint: 'From Wazuh Indexer' },
      { label: 'Low severity', value: metrics.low, hint: 'Rule level 0-6' },
      { label: 'Medium severity', value: metrics.medium, hint: 'Rule level 7-11' },
      { label: 'High severity', value: metrics.high, hint: 'Rule level 12-14' },
      { label: 'Critical severity', value: metrics.critical, hint: 'Rule level 15+' },
    ],
    [metrics],
  )

  const selectedDetails = useMemo(() => {
    if (!selectedAlert?.raw) return []
    const fullDoc = buildAlertDetailsDocument(selectedAlert.raw)
    return flattenObjectEntries(fullDoc).filter((entry) => entry.key !== '_source')
  }, [selectedAlert])

  const calendarClause = useMemo(() => buildCalendarClause(timeFilter), [timeFilter])
  const timeRangeLabel = useMemo(() => {
    if (timeFilter.mode === 'all') return 'All time'
    if (timeFilter.mode === 'custom' && timeFilter.startDate && timeFilter.endDate) return `${timeFilter.startDate} to ${timeFilter.endDate}`
    if (timeFilter.mode === 'relative') {
      const unitLabel = timeFilter.unit === 'hours' ? 'hours' : timeFilter.unit === 'months' ? 'months' : timeFilter.unit === 'years' ? 'years' : 'days'
      return `Last ${timeFilter.value} ${unitLabel}`
    }
    return 'Custom'
  }, [timeFilter])

  return (
    <AppLayout>
      <div id="dashboard">
        <header className="hero">
          <div>
            <span className="eyebrow">Security Operations Platform</span>
            <h1>Turn Wazuh alerts into action with AI.</h1>
            <p className="lead">Search in plain English, generate explanations, and investigate live alerts from one place.</p>
          </div>
          <div className="hero-card hero-logo-card">
            <img src="/octopus-logo.png" alt="Octopus logo" className="hero-logo" />
          </div>
        </header>

        <section className="metrics-grid">
          {cards.map((card) => <MetricCard key={card.label} {...card} />)}
        </section>

        <section className="panel hunt-panel" id="hunt">
          <div className="panel-header">
            <h2>Natural language search</h2>
            <button type="button" disabled={busy} onClick={handleTranslateAndSearch}>{busy ? 'Working…' : 'Translate & Search'}</button>
          </div>

          <div className="hunt-grid">
            <div className="search-stack">
              <SearchBar value={search} onChange={setSearch} onTranslate={handleTranslateOnly} busy={busy} />
              <div className="translation-box">
                <span className="muted small">Translated {translationMeta.language.toUpperCase()}</span>
                <textarea
                  rows={2}
                  value={translation}
                  onChange={(event) => setTranslation(event.target.value)}
                  className="code-input"
                  placeholder="Waiting for translation..."
                />
                <span className="muted small">
                  Confidence: {translationMeta.confidence !== null ? Math.round(translationMeta.confidence * 100) : '—'}%
                  {' · '}Time range: {translationMeta.timeRange || 'unspecified'}
                </span>
                {translationMeta.notes ? <span className="muted small">Note: {translationMeta.notes}</span> : null}
                <div className="search-row">
                  <button type="button" className="secondary-button" onClick={runTranslatedSearch} disabled={busy || loading || !translation.trim()}>
                    Search translated query
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setTranslation('')} disabled={busy || loading}>
                    Clear translation
                  </button>
                  <span className="muted small">Active filter: {activeQuery || 'match all alerts'}</span>
                </div>
              </div>
            </div>

            <aside className="calendar-panel">
              <div className="panel-header">
                <h3>Date range</h3>
                <span className="pill">{timeRangeLabel}</span>
              </div>
              <div className="calendar-mode-strip">
                {getIntervalOptions().map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={timeFilter.mode === option.key || timeFilter.preset === option.key ? 'mode-pill active' : 'mode-pill'}
                    onClick={() => applyCalendarMode(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {timeFilter.mode === 'relative' ? (
                <div className="calendar-row">
                  <input
                    type="number"
                    min="1"
                    value={timeFilter.value}
                    onChange={(event) => setTimeFilter((previous) => ({ ...previous, value: event.target.value }))}
                    className="time-input"
                  />
                  <select value={timeFilter.unit} onChange={(event) => setTimeFilter((previous) => ({ ...previous, unit: event.target.value }))}>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                  </select>
                </div>
              ) : null}

              {timeFilter.mode === 'custom' ? (
                <div className="calendar-row calendar-range-row">
                  <label>
                    <span className="muted small">From</span>
                    <input
                      type="datetime-local"
                      value={timeFilter.startDate}
                      onChange={(event) => setTimeFilter((previous) => ({ ...previous, startDate: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span className="muted small">To</span>
                    <input
                      type="datetime-local"
                      value={timeFilter.endDate}
                      onChange={(event) => setTimeFilter((previous) => ({ ...previous, endDate: event.target.value }))}
                    />
                  </label>
                </div>
              ) : null}

              <div className="search-row">
                <button type="button" className="secondary-button" onClick={applyTimeFilter} disabled={loading || busy}>
                  Apply time filter
                </button>
                <span className="muted small">Filter clause: {calendarClause || 'none'}</span>
              </div>
            </aside>
          </div>
        </section>

        <section className="panel">
          <AlertsTrendChart points={trendPoints} />
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="content-grid" id="alerts">
          <div className="stacked-panel">
            <AlertTable alerts={alerts} loading={loading} selectedId={selectedAlert?.id} onSelectAlert={setSelectedAlert} />
            <div className="panel-header">
              <span className="muted small">
                Page {page} · Showing {alerts.length} of {totalAlerts}
              </span>
              <div className="search-row">
                <button type="button" className="secondary-button" disabled={loading || page <= 1} onClick={goToPreviousPage}>
                  Previous
                </button>
                <button type="button" disabled={loading || page * pageSize >= totalAlerts} onClick={goToNextPage}>
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="stacked-panel" id="ai">
            <AIExplanation explanation={explanation} onExplain={explainSelectedAlert} busy={busy} selectedAlert={selectedAlert} />
            <div className="panel">
              <div className="panel-header">
                <h2>Selected alert</h2>
                <span className="pill">Live Wazuh</span>
              </div>
              {selectedAlert ? (
                <div className="selected-alert">
                  <div><span className="muted small">Source</span><strong>{selectedAlert.source}</strong></div>
                  <div><span className="muted small">Rule</span><strong>{selectedAlert.rule}</strong></div>
                  <div><span className="muted small">Severity</span><strong>{selectedAlert.severity}</strong></div>
                  <div><span className="muted small">Timestamp</span><strong>{selectedAlert.timestamp}</strong></div>
                </div>
              ) : (
                <p className="muted">No alert selected.</p>
              )}

              {selectedAlert ? (
                <div className="alert-details-block">
                  <div className="panel-header">
                    <h3>Alert details</h3>
                    <span className="muted small">{selectedDetails.length} fields</span>
                  </div>
                  <div className="table-wrap">
                    <table className="details-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDetails.map((entry) => (
                          <tr key={entry.key}>
                            <td>{entry.key}</td>
                            <td>{entry.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="panel-header">
                    <h3>Raw JSON</h3>
                    <button type="button" className="secondary-button" onClick={copySelectedAlertJson}>
                      {copyState || 'Copy JSON'}
                    </button>
                  </div>
                  <pre className="json-viewer">{JSON.stringify(selectedAlert.raw, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
