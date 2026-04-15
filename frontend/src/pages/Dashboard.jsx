import { useEffect, useMemo, useRef, useState } from 'react'
import AlertTable from '../components/AlertTable'
import AIExplanation from '../components/AIExplanation'
import AlertsTrendChart from '../components/AlertsTrendChart'
import AppLayout from '../components/AppLayout'
import MetricCard from '../components/MetricCard'
import api from '../lib/api'

function queryHasExplicitTimeClause(query) {
  const text = String(query || '')
  return /@timestamp\s*:\s*\[|\btimestamp\b|\bnow\s*[-+]/i.test(text)
}

function mergeQuery(baseQuery, timeClause) {
  const primary = (baseQuery || '').trim()
  const time = (timeClause || '').trim()
  if (primary && queryHasExplicitTimeClause(primary)) return primary
  if (primary && time) return `(${primary}) AND (${time})`
  return primary || time || ''
}

function getTimelineInterval(timeFilter) {
  const start = timeFilter?.startDateTime ? new Date(timeFilter.startDateTime) : null
  const end = timeFilter?.endDateTime ? new Date(timeFilter.endDateTime) : null
  if (!start || !end) return 'month'
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'month'
  if (start.getTime() > end.getTime()) return 'month'

  const diffHours = (end.getTime() - start.getTime()) / 36e5
  if (diffHours <= 48) return 'hour'
  if (diffHours <= 24 * 90) return 'day'
  if (diffHours <= 24 * 365 * 2) return 'week'
  return 'month'
}

function toLocalDateTimeValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function getDefaultTimeFilter() {
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return {
    startDateTime: toLocalDateTimeValue(start),
    endDateTime: toLocalDateTimeValue(end),
  }
}

function hasValidTimeRange(filter) {
  const start = filter?.startDateTime ? new Date(filter.startDateTime) : null
  const end = filter?.endDateTime ? new Date(filter.endDateTime) : null
  if (!start || !end) return false
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
  return start.getTime() <= end.getTime()
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

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const dayCount = lastDay.getDate()
  const offset = firstDay.getDay()
  const cells = []

  for (let i = 0; i < offset; i += 1) cells.push(null)
  for (let day = 1; day <= dayCount; day += 1) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(null)

  return cells
}

function extractHour(dateTimeValue) {
  const raw = String(dateTimeValue || '')
  const hour = Number(raw.split('T')[1]?.split(':')[0] ?? 0)
  if (!Number.isFinite(hour)) return 0
  return Math.max(0, Math.min(23, hour))
}

function setDateWithHour(year, month, day, hour) {
  return toLocalDateTimeValue(new Date(year, month, day, hour, 0, 0, 0))
}

export default function Dashboard() {
  const dynamicExamples = useMemo(
    () => ['Today\'s alerts', 'Alerts from this IP address', 'Critical alerts from last 6 hours', 'Failed SSH logins this week'],
    [],
  )

  const [alerts, setAlerts] = useState([])
  const [trendPoints, setTrendPoints] = useState([])
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [explanation, setExplanation] = useState('Select an alert to generate an explanation.')
  const [metrics, setMetrics] = useState({ total: 0, low: 0, medium: 0, high: 0, critical: 0 })
  const [search, setSearch] = useState('')
  const [translation, setTranslation] = useState('')
  const [translationMeta, setTranslationMeta] = useState({ language: 'dql', timeRange: 'unspecified', notes: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('')
  const [totalAlerts, setTotalAlerts] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [activeBaseQuery, setActiveBaseQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [searchHistory, setSearchHistory] = useState([])
  const [timeFilter, setTimeFilter] = useState(getDefaultTimeFilter)
  const [exampleIndex, setExampleIndex] = useState(0)
  const [exampleText, setExampleText] = useState('')
  const [isDeletingExample, setIsDeletingExample] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarStage, setCalendarStage] = useState('start')
  const [manualDateEntry, setManualDateEntry] = useState(false)
  const [calendarView, setCalendarView] = useState(() => {
    const now = new Date()
    return { month: now.getMonth(), year: now.getFullYear() }
  })
  const hasMountedDateSync = useRef(false)
  const calendarRef = useRef(null)

  const dayCells = useMemo(() => getCalendarDays(calendarView.year, calendarView.month), [calendarView.month, calendarView.year])

  const startDate = useMemo(() => {
    if (!timeFilter.startDateTime) return null
    const value = new Date(timeFilter.startDateTime)
    return Number.isNaN(value.getTime()) ? null : value
  }, [timeFilter.startDateTime])

  const endDate = useMemo(() => {
    if (!timeFilter.endDateTime) return null
    const value = new Date(timeFilter.endDateTime)
    return Number.isNaN(value.getTime()) ? null : value
  }, [timeFilter.endDateTime])

  useEffect(() => {
    if ((search || '').trim().length > 0) return undefined

    const current = dynamicExamples[exampleIndex % dynamicExamples.length]
    let delay = isDeletingExample ? 34 : 68

    if (!isDeletingExample && exampleText === current) {
      delay = 900
    }
    if (isDeletingExample && exampleText.length === 0) {
      delay = 260
    }

    const timer = setTimeout(() => {
      if (!isDeletingExample) {
        if (exampleText === current) {
          setIsDeletingExample(true)
        } else {
          setExampleText(current.slice(0, exampleText.length + 1))
        }
      } else if (exampleText.length === 0) {
        setIsDeletingExample(false)
        setExampleIndex((value) => (value + 1) % dynamicExamples.length)
      } else {
        setExampleText(current.slice(0, exampleText.length - 1))
      }
    }, delay)

    return () => clearTimeout(timer)
  }, [dynamicExamples, exampleIndex, exampleText, isDeletingExample, search])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!showCalendar) return
      if (calendarRef.current && !calendarRef.current.contains(event.target)) {
        setShowCalendar(false)
        setManualDateEntry(false)
        setCalendarStage('start')
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showCalendar])

  async function loadSearchHistory() {
    try {
      const response = await api.get('/alerts/history', { params: { limit: 20 } })
      setSearchHistory(Array.isArray(response.data?.data?.items) ? response.data.data.items : [])
    } catch {
      setSearchHistory([])
    }
  }

  function buildCalendarClause(filter) {
    const start = filter?.startDateTime ? new Date(filter.startDateTime) : null
    const end = filter?.endDateTime ? new Date(filter.endDateTime) : null
    if (!start || !end) return ''
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
    if (start.getTime() > end.getTime()) return ''
    return `@timestamp:[${start.toISOString()} TO ${end.toISOString()}]`
  }

  async function loadAlerts(baseQuery, nextPage = 1, options = {}) {
    const {
      persistHistory = false,
      naturalQuery = '',
      translatedQuery = '',
    } = options
    const finalBaseQuery = baseQuery ?? ''
    const combinedQuery = mergeQuery(finalBaseQuery, buildCalendarClause(timeFilter))
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/alerts', {
        params: {
          ...(combinedQuery ? { query: combinedQuery } : {}),
          ...(persistHistory && naturalQuery.trim() && translatedQuery.trim()
            ? {
                nl_query: naturalQuery.trim(),
                translated_query: translatedQuery.trim(),
                persist_history: true,
              }
            : {}),
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
      if (persistHistory) {
        await loadSearchHistory()
      }
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
    Promise.all([loadAlerts('', 1), loadSummary(''), loadSearchHistory()])
  }, [])

  useEffect(() => {
    if (!hasMountedDateSync.current) {
      hasMountedDateSync.current = true
      return
    }
    if (!hasValidTimeRange(timeFilter)) return
    Promise.all([loadAlerts(activeBaseQuery, 1), loadSummary(activeBaseQuery)])
  }, [timeFilter.startDateTime, timeFilter.endDateTime])

  function applyHistorySearch(historyId) {
    const selected = searchHistory.find((item) => String(item.id) === String(historyId))
    if (!selected) return
    const generated = (selected.dql_translation || selected.query || '').trim()
    if (generated) {
      setTranslation(generated)
      setSearch(selected.query || '')
    }
  }

  async function translateQuery() {
    setBusy(true)
    setError('')
    try {
      const response = await api.post('/ai/translate-search', { query: search, mode: 'auto' }, { timeout: 90000 })
      const translatedQuery = response.data?.query ?? response.data?.dql ?? ''
      setTranslation(translatedQuery || 'No translation returned.')
      setTranslationMeta({
        language: response.data?.language ?? 'dql',
        timeRange: response.data?.time_range ?? 'unspecified',
        notes: response.data?.notes ?? '',
      })
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

  async function runTranslatedSearch() {
    const cleaned = (translation || '').trim()
    if (!cleaned) {
      setError('Please translate first or enter a query to search.')
      return
    }
    await Promise.all([
      loadAlerts(cleaned, 1, {
        persistHistory: true,
        naturalQuery: search,
        translatedQuery: cleaned,
      }),
      loadSummary(cleaned),
    ])
  }

  function goToPreviousMonth() {
    setCalendarView((previous) => {
      if (previous.month === 0) {
        return { month: 11, year: previous.year - 1 }
      }
      return { month: previous.month - 1, year: previous.year }
    })
  }

  function goToNextMonth() {
    setCalendarView((previous) => {
      if (previous.month === 11) {
        return { month: 0, year: previous.year + 1 }
      }
      return { month: previous.month + 1, year: previous.year }
    })
  }

  function handleCalendarDateSelect(day) {
    if (!day) return

    const selectedValue = setDateWithHour(
      calendarView.year,
      calendarView.month,
      day,
      calendarStage === 'start' ? extractHour(timeFilter.startDateTime) : extractHour(timeFilter.endDateTime),
    )

    if (calendarStage === 'start') {
      setTimeFilter((previous) => {
        const currentEnd = previous.endDateTime ? new Date(previous.endDateTime) : null
        const selected = new Date(selectedValue)
        if (currentEnd && selected.getTime() > currentEnd.getTime()) {
          return { ...previous, startDateTime: selectedValue, endDateTime: selectedValue }
        }
        return { ...previous, startDateTime: selectedValue }
      })
      setCalendarStage('end')
      return
    }

    setTimeFilter((previous) => {
      const currentStart = previous.startDateTime ? new Date(previous.startDateTime) : null
      const selected = new Date(selectedValue)
      if (currentStart && selected.getTime() < currentStart.getTime()) {
        return { ...previous, startDateTime: selectedValue, endDateTime: previous.startDateTime }
      }
      return { ...previous, endDateTime: selectedValue }
    })
    setCalendarStage('start')
    setShowCalendar(false)
    setManualDateEntry(false)
  }

  function isEndSelectionBlocked(day) {
    if (calendarStage !== 'end' || !startDate || !day) return false
    const candidate = new Date(calendarView.year, calendarView.month, day)
    const startFloor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
    return candidate.getTime() < startFloor.getTime()
  }

  function openCalendarFromStart() {
    setCalendarStage('start')
    setShowCalendar((previous) => {
      const next = !previous
      if (!next) {
        setManualDateEntry(false)
      }
      return next
    })
  }

  function openManualDateEntry(event) {
    event.preventDefault()
    setCalendarStage('start')
    setShowCalendar(true)
    setManualDateEntry(true)
  }

  function handleHourChange(type, hourValue) {
    const hour = String(hourValue).padStart(2, '0')
    const key = type === 'start' ? 'startDateTime' : 'endDateTime'

    setTimeFilter((previous) => {
      const current = previous[key]
      if (!current) return previous
      const [datePart] = current.split('T')
      return { ...previous, [key]: `${datePart}T${hour}:00` }
    })
  }

  function isInSelectedRange(day) {
    if (!startDate || !endDate || !day) return false
    const date = new Date(calendarView.year, calendarView.month, day)
    const min = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime()
    const max = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime()
    const current = date.getTime()
    return current >= min && current <= max
  }

  function isRangeStart(day) {
    if (!startDate || !day) return false
    return day === startDate.getDate() && calendarView.month === startDate.getMonth() && calendarView.year === startDate.getFullYear()
  }

  function isRangeEnd(day) {
    if (!endDate || !day) return false
    return day === endDate.getDate() && calendarView.month === endDate.getMonth() && calendarView.year === endDate.getFullYear()
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
      { label: 'Active alerts', value: metrics.total, tone: 'total' },
      { label: 'Low severity', value: metrics.low, tone: 'low' },
      { label: 'Medium severity', value: metrics.medium, tone: 'medium' },
      { label: 'High severity', value: metrics.high, tone: 'high' },
      { label: 'Critical severity', value: metrics.critical, tone: 'critical' },
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
        <section className="metrics-grid">
          {cards.map((card) => <MetricCard key={card.label} {...card} />)}
        </section>

        <section className="panel hunt-panel" id="hunt">
          <div className="panel-header">
            <div className="search-title-wrap">
              <h2>Search</h2>
              <span className="search-help" tabIndex={0} aria-label="Search usage help">
                !
                <span className="search-help-tooltip">
                  Write your request in natural language, generate a query, review it, then run search.
                </span>
              </span>
            </div>
          </div>

          <div className="search-console">
            <div className="search-console-grid">
              <div className="search-console-input-wrap">
                <input
                  id="nl-search"
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={exampleText || ' '}
                  className="nl-search-input"
                />
              </div>
              <div className="search-console-actions">
                <button type="button" className="generate-query-btn" disabled={busy} onClick={handleTranslateOnly}>
                  {busy ? 'Generating…' : 'Generate Query'}
                </button>
              </div>

              <div className="search-console-query-wrap">
                <textarea
                  rows={2}
                  value={translation}
                  onChange={(event) => setTranslation(event.target.value)}
                  className="code-input generated-query-box"
                  placeholder="Generated query appears here"
                />
              </div>
            </div>

            <div className="search-console-footer">
              <div className="search-footer-field">
                <select className="history-dropdown" id="history-select" defaultValue="" onChange={(event) => applyHistorySearch(event.target.value)}>
                  <option value="">History</option>
                  {searchHistory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {new Date(item.created_at).toLocaleString()} · {item.query}
                    </option>
                  ))}
                </select>
              </div>

              <div className="search-footer-spacer" aria-hidden="true" />

              <div className="calendar-control" ref={calendarRef}>
                <button type="button" className="calendar-toggle-btn" onClick={openCalendarFromStart} onDoubleClick={openManualDateEntry}>
                  {startDate ? startDate.toLocaleDateString() : 'Pick Start'} to {endDate ? endDate.toLocaleDateString() : 'Pick End'}
                </button>

                {showCalendar ? (
                  <div className="calendar-popup" role="dialog" aria-label="Date range picker">
                    <div className="calendar-header">
                      <button type="button" onClick={goToPreviousMonth} aria-label="Previous month">&#8249;</button>
                      <span className="calendar-title">
                        {new Date(calendarView.year, calendarView.month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                      </span>
                      <button type="button" onClick={goToNextMonth} aria-label="Next month">&#8250;</button>
                    </div>

                    <div className="calendar-weekdays">
                      <span>Sun</span>
                      <span>Mon</span>
                      <span>Tue</span>
                      <span>Wed</span>
                      <span>Thu</span>
                      <span>Fri</span>
                      <span>Sat</span>
                    </div>

                    <div className="calendar-grid">
                      {dayCells.map((day, index) => (
                        <button
                          key={`${calendarView.year}-${calendarView.month}-${index}`}
                          type="button"
                          className={[
                            'calendar-day',
                            day ? 'active' : 'empty',
                            isEndSelectionBlocked(day) ? 'blocked' : '',
                            isInSelectedRange(day) ? 'in-range' : '',
                            isRangeStart(day) ? 'range-start' : '',
                            isRangeEnd(day) ? 'range-end' : '',
                          ].filter(Boolean).join(' ')}
                          disabled={!day || isEndSelectionBlocked(day)}
                          onClick={() => handleCalendarDateSelect(day)}
                        >
                          {day || ''}
                        </button>
                      ))}
                    </div>

                    <div className="calendar-hours">
                      <label>
                        Start hour
                        <select value={String(extractHour(timeFilter.startDateTime)).padStart(2, '0')} onChange={(event) => handleHourChange('start', event.target.value)}>
                          {Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0')).map((hour) => (
                            <option key={`start-${hour}`} value={hour}>{hour}:00</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        End hour
                        <select value={String(extractHour(timeFilter.endDateTime)).padStart(2, '0')} onChange={(event) => handleHourChange('end', event.target.value)}>
                          {Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0')).map((hour) => (
                            <option key={`end-${hour}`} value={hour}>{hour}:00</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {manualDateEntry ? (
                      <div className="manual-range-entry">
                        <label>
                          Start date/time
                          <input
                            type="datetime-local"
                            value={timeFilter.startDateTime}
                            onChange={(event) => setTimeFilter((previous) => ({ ...previous, startDateTime: event.target.value }))}
                          />
                        </label>
                        <label>
                          End date/time
                          <input
                            type="datetime-local"
                            value={timeFilter.endDateTime}
                            onChange={(event) => setTimeFilter((previous) => ({ ...previous, endDateTime: event.target.value }))}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="search-footer-action">
                <button type="button" className="run-search-btn footer-run-btn" onClick={runTranslatedSearch} disabled={busy || loading || !translation.trim()}>
                  Run Search
                </button>
              </div>
            </div>
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
