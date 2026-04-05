import { useEffect, useMemo, useState } from 'react'
import AlertTable from '../components/AlertTable'
import AIExplanation from '../components/AIExplanation'
import AppLayout from '../components/AppLayout'
import MetricCard from '../components/MetricCard'
import SearchBar from '../components/SearchBar'
import api from '../lib/api'

function getAlertSourceDocument(item) {
  return item?._source && typeof item._source === 'object' ? item._source : item
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
  if (value === null || value === undefined) {
    return [{ key: parentKey || 'value', value: 'null' }]
  }

  if (Array.isArray(value)) {
    return [{ key: parentKey || 'value', value: value.length ? value.join(', ') : '[]' }]
  }

  if (typeof value !== 'object') {
    return [{ key: parentKey || 'value', value: String(value) }]
  }

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
  const sourceDoc = getAlertSourceDocument(item)
  const fallbackSeverityMap = {
    critical: 14,
    error: 12,
    warning: 7,
    info: 3,
    debug: 1,
  }
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
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [explanation, setExplanation] = useState('Select an alert to generate an explanation.')
  const [metrics, setMetrics] = useState({ total: 0, high: 0, medium: 0, low: 0 })
  const [search, setSearch] = useState('SSH brute force from IP today')
  const [translation, setTranslation] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('')
  const [totalAlerts, setTotalAlerts] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [activeQuery, setActiveQuery] = useState('')

  async function loadAlerts(query, nextPage = 1) {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/alerts', {
        params: {
          ...(query ? { query } : {}),
          limit: pageSize,
          offset: Math.max(0, (nextPage - 1) * pageSize),
        },
      })
      const items = (response.data?.data?.items ?? []).map(normalizeAlert)
      const total = Number(response.data?.data?.total ?? items.length)
      setTotalAlerts(Number.isFinite(total) ? total : items.length)
      setPage(nextPage)
      setActiveQuery(query ?? '')
      setAlerts(items)

      const numericSeverities = items
        .map((item) => Number(item.severity))
        .filter((severity) => Number.isFinite(severity))

      setMetrics({
        total: Number.isFinite(total) ? total : items.length,
        high: numericSeverities.filter((severity) => severity >= 10).length,
        medium: numericSeverities.filter((severity) => severity >= 5 && severity < 10).length,
        low: numericSeverities.filter((severity) => severity < 5).length,
      })
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

  useEffect(() => {
    loadAlerts('', 1)
  }, [])

  async function handleTranslate() {
    setBusy(true)
    setError('')
    try {
      const response = await api.post('/ai/translate-search', { query: search })
      setTranslation(response.data?.dql ?? 'No translation returned.')
      await loadAlerts(response.data?.dql ?? '', 1)
    } catch {
      setError('AI translation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function goToNextPage() {
    const hasMore = page * pageSize < totalAlerts
    if (!hasMore || loading) return
    await loadAlerts(activeQuery, page + 1)
  }

  async function goToPreviousPage() {
    if (page <= 1 || loading) return
    await loadAlerts(activeQuery, page - 1)
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
      { label: 'High severity', value: metrics.high, hint: 'Severity level ≥ 10' },
      { label: 'Medium severity', value: metrics.medium, hint: 'Severity 5–9' },
      { label: 'Low severity', value: metrics.low, hint: 'Severity 0–4' },
    ],
    [metrics],
  )

  const selectedDetails = useMemo(() => {
    if (!selectedAlert?.raw) return []
    const fullDoc = buildAlertDetailsDocument(selectedAlert.raw)
    return flattenObjectEntries(fullDoc).filter((entry) => entry.key !== '_source')
  }, [selectedAlert])

  return (
    <AppLayout>
      <div id="dashboard">
        <header className="hero">
          <div>
            <span className="eyebrow">Security Operations Platform</span>
            <h1>Turn Wazuh alerts into action with AI.</h1>
            <p className="lead">
              Search in plain English, generate explanations, and investigate live alerts from one place.
            </p>
          </div>
          <div className="hero-card hero-logo-card">
            <img src="/octopus-logo.png" alt="Octopus logo" className="hero-logo" />
          </div>
        </header>

        <section className="metrics-grid">
          {cards.map((card) => (
            <MetricCard key={card.label} {...card} />
          ))}
        </section>

        <section className="panel" id="hunt">
          <div className="panel-header">
            <h2>Natural language search</h2>
            <button type="button" disabled={busy} onClick={handleTranslate}>
              {busy ? 'Working…' : 'Translate & Search'}
            </button>
          </div>
          <SearchBar value={search} onChange={setSearch} onTranslate={handleTranslate} busy={busy} />
          <div className="translation-box">
            <span className="muted small">Translated DQL</span>
            <code>{translation || 'Waiting for translation…'}</code>
          </div>
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
