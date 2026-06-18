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
  if (diffHours <= 24) return 'hour'
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

function normalizeTranslatedTimeRange(bounds) {
  if (!bounds || typeof bounds !== 'object') return null

  const startValue = bounds.startDateTime ?? bounds.start ?? bounds.from ?? null
  const endValue = bounds.endDateTime ?? bounds.end ?? bounds.to ?? null
  if (!startValue || !endValue) return null

  const startDate = new Date(startValue)
  const endDate = new Date(endValue)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null

  return {
    startDateTime: toLocalDateTimeValue(startDate),
    endDateTime: toLocalDateTimeValue(endDate),
  }
}

function getNextChartGranularity(granularity) {
  if (granularity === 'month') return 'day'
  if (granularity === 'week') return 'day'
  if (granularity === 'day') return 'hour'
  if (granularity === 'hour') return 'minute'
  if (granularity === 'minute') return 'second'
  if (granularity === 'second') return 'millisecond'
  return null
}

function getZoomWindow(timestamp, granularity) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null

  const start = new Date(date)
  const end = new Date(date)

  if (granularity === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(end.getMonth() + 1, 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (granularity === 'week') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    end.setDate(end.getDate() + 6)
    return { start, end }
  }

  if (granularity === 'day') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (granularity === 'hour') {
    start.setMinutes(0, 0, 0)
    end.setMinutes(59, 59, 999)
    return { start, end }
  }

  if (granularity === 'minute') {
    start.setSeconds(0, 0)
    end.setSeconds(59, 999)
    return { start, end }
  }

  if (granularity === 'second') {
    start.setMilliseconds(0)
    end.setMilliseconds(999)
    return { start, end }
  }

  return null
}

function aggregateAlertsByGranularity(alertItems, granularity, rangeStart, rangeEnd) {
  const grouped = new Map()

  for (const alert of alertItems) {
    const value = alert?.timestamp
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) continue
    if (date.getTime() < rangeStart.getTime() || date.getTime() > rangeEnd.getTime()) continue

    const bucket = new Date(date)
    if (granularity === 'minute') {
      bucket.setSeconds(0, 0)
    } else if (granularity === 'second') {
      bucket.setMilliseconds(0)
    }

    const key = bucket.getTime()
    grouped.set(key, (grouped.get(key) || 0) + 1)
  }

  return Array.from(grouped.entries())
    .sort((first, second) => first[0] - second[0])
    .map(([epoch, count]) => ({ timestamp: new Date(epoch).toISOString(), count }))
}

export default function Dashboard() {
  const MIN_ALERTS_PANE_WIDTH = 36
  const MAX_ALERTS_PANE_WIDTH = 68
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
  const [chartZoomStack, setChartZoomStack] = useState([])
  const [chartGranularity, setChartGranularity] = useState(getTimelineInterval(getDefaultTimeFilter()))
  const [chartRange, setChartRange] = useState(getDefaultTimeFilter)
  const [chartZoomLabel, setChartZoomLabel] = useState('')
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
  const [chartPanelHeight, setChartPanelHeight] = useState(null)
  const [alertsPaneWidth, setAlertsPaneWidth] = useState(52)
  const [calendarView, setCalendarView] = useState(() => {
    const now = new Date()
    return { month: now.getMonth(), year: now.getFullYear() }
  })
  const hasMountedDateSync = useRef(false)
  const suppressNextTimeFilterSyncRef = useRef(false)
  const calendarRef = useRef(null)
  const huntPanelRef = useRef(null)
  const contentGridRef = useRef(null)
  const isResizingContentRef = useRef(false)

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

  useEffect(() => {
    const panel = huntPanelRef.current
    if (!panel) return undefined

    const syncHeight = () => {
      const measured = Math.round(panel.getBoundingClientRect().height)
      if (measured > 0) setChartPanelHeight(measured)
    }

    syncHeight()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncHeight)
      observer.observe(panel)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', syncHeight)
    return () => window.removeEventListener('resize', syncHeight)
  }, [])

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

  async function loadSummary(baseQuery, options = {}) {
    const {
      filterOverride = null,
      intervalOverride = null,
      preserveMetrics = false,
      updateChartState = true,
    } = options
    const finalBaseQuery = baseQuery ?? ''
    const effectiveFilter = filterOverride ?? timeFilter
    const combinedQuery = mergeQuery(finalBaseQuery, buildCalendarClause(effectiveFilter))
    try {
      const response = await api.get('/alerts/summary', {
        params: {
          ...(combinedQuery ? { query: combinedQuery } : {}),
          interval: intervalOverride ?? getTimelineInterval(effectiveFilter),
        },
      })
      const data = response.data?.data ?? {}
      const severity = data?.severity ?? {}
      if (!preserveMetrics) {
        setMetrics({
          total: Number(data?.total ?? 0) || 0,
          low: Number(severity.low ?? 0) || 0,
          medium: Number(severity.medium ?? 0) || 0,
          high: Number(severity.high ?? 0) || 0,
          critical: Number(severity.critical ?? 0) || 0,
        })
      }
      const timeline = Array.isArray(data?.timeline) ? data.timeline : []
      setTrendPoints(timeline)
      if (updateChartState) {
        setChartGranularity(intervalOverride ?? getTimelineInterval(effectiveFilter))
        setChartRange({
          startDateTime: effectiveFilter.startDateTime,
          endDateTime: effectiveFilter.endDateTime,
        })
      }
      if (data?.source === 'cache') {
        setError(`Live Wazuh unavailable. Showing cached summary. ${data?.message ?? ''}`.trim())
      }
    } catch {
      if (!preserveMetrics) {
        setMetrics({ total: 0, low: 0, medium: 0, high: 0, critical: 0 })
      }
      setTrendPoints([])
    }
  }

  async function loadAlertsForRange(baseQuery, filter, limit = 2000) {
    const finalBaseQuery = baseQuery ?? ''
    const combinedQuery = mergeQuery(finalBaseQuery, buildCalendarClause(filter))
    const response = await api.get('/alerts', {
      params: {
        ...(combinedQuery ? { query: combinedQuery } : {}),
        limit,
        offset: 0,
      },
    })
    return (response.data?.data?.items ?? []).map(normalizeAlert)
  }

  useEffect(() => {
    Promise.all([loadAlerts('', 1), loadSummary(''), loadSearchHistory()])
  }, [])

  useEffect(() => {
    if (!hasMountedDateSync.current) {
      hasMountedDateSync.current = true
      return
    }
    if (suppressNextTimeFilterSyncRef.current) {
      suppressNextTimeFilterSyncRef.current = false
      return
    }
    if (!hasValidTimeRange(timeFilter)) return
    setChartZoomStack([])
    setChartZoomLabel('')
    Promise.all([loadAlerts(activeBaseQuery, 1), loadSummary(activeBaseQuery)])
  }, [timeFilter.startDateTime, timeFilter.endDateTime])

  function applyTranslatedTimeRange(bounds) {
    const nextRange = normalizeTranslatedTimeRange(bounds)
    if (!nextRange) return

    suppressNextTimeFilterSyncRef.current = true
    setTimeFilter(nextRange)
    setCalendarStage('start')
    setManualDateEntry(false)
    setShowCalendar(false)

    const startDate = new Date(nextRange.startDateTime)
    if (!Number.isNaN(startDate.getTime())) {
      setCalendarView({
        month: startDate.getMonth(),
        year: startDate.getFullYear(),
      })
    }
  }

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
      const timeRangeBounds = response.data?.time_range_bounds ?? null
      setTranslation(translatedQuery || 'No translation returned.')
      setTranslationMeta({
        language: response.data?.language ?? 'dql',
        timeRange: response.data?.time_range ?? 'unspecified',
        timeRangeBounds,
        notes: response.data?.notes ?? '',
      })
      applyTranslatedTimeRange(timeRangeBounds)
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
    setChartZoomStack([])
    setChartZoomLabel('')
    await Promise.all([
      loadAlerts(cleaned, 1, {
        persistHistory: true,
        naturalQuery: search,
        translatedQuery: cleaned,
      }),
      loadSummary(cleaned),
    ])
  }

  async function handleChartBarClick(point, granularity) {
    if (!point?.timestamp) return
    const nextGranularity = getNextChartGranularity(granularity)
    if (!nextGranularity) return

    const window = getZoomWindow(point.timestamp, granularity)
    if (!window) return

    const nextFilter = {
      startDateTime: toLocalDateTimeValue(window.start),
      endDateTime: toLocalDateTimeValue(window.end),
    }

    setChartZoomStack((previous) => [
      ...previous,
      {
        points: trendPoints,
        granularity: chartGranularity,
        range: chartRange,
        label: chartZoomLabel,
      },
    ])

    setChartZoomLabel(
      nextGranularity === 'hour'
        ? window.start.toLocaleDateString()
        : nextGranularity === 'minute'
          ? `${window.start.toLocaleDateString()} ${window.start.toLocaleTimeString([], { hour: '2-digit' })}`
          : nextGranularity === 'second'
            ? window.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : `${window.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    )

    if (nextGranularity === 'day' || nextGranularity === 'hour') {
      await loadSummary(activeBaseQuery, {
        filterOverride: nextFilter,
        intervalOverride: nextGranularity,
        preserveMetrics: true,
      })
      return
    }

    try {
      const alertsInWindow = await loadAlertsForRange(activeBaseQuery, nextFilter)
      const aggregated = aggregateAlertsByGranularity(alertsInWindow, nextGranularity, window.start, window.end)
      setTrendPoints(aggregated)
      setChartGranularity(nextGranularity)
      setChartRange(nextFilter)
    } catch {
      setTrendPoints([])
    }
  }

  async function resetChartZoom() {
    setChartZoomStack((previous) => {
      if (!previous.length) return previous
      const nextStack = [...previous]
      const last = nextStack.pop()
      setTrendPoints(last.points)
      setChartGranularity(last.granularity)
      setChartRange(last.range)
      setChartZoomLabel(last.label)
      return nextStack
    })
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
    const jsonText = JSON.stringify(selectedAlert.raw, null, 2)

    async function writeWithFallback(text) {
      if (navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch {
          // Fallback to legacy copy when Clipboard API is blocked.
        }
      }

      try {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.setAttribute('readonly', 'readonly')
        textArea.style.position = 'fixed'
        textArea.style.top = '-1000px'
        textArea.style.left = '-1000px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        const copied = document.execCommand('copy')
        document.body.removeChild(textArea)
        return copied
      } catch {
        return false
      }
    }

    const copied = await writeWithFallback(jsonText)
    setCopyState(copied ? 'Copied' : 'Copy failed')
    setTimeout(() => setCopyState(''), 1500)
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

  function formatDetailTimestamp(value) {
    if (!value) return value
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    }).format(date)
  }

  function organizeAlertDetails(rawAlert) {
    if (!rawAlert || typeof rawAlert !== 'object') return { main: [], groups: {} }
    
    const fullDoc = buildAlertDetailsDocument(rawAlert)
    const allEntries = flattenObjectEntries(fullDoc).filter((entry) => entry.key !== '_source')
    
    const longTextFields = new Set(['full_log', 'previous_log', 'previous_output', 'location', 'decoder.name', 'input.type'])
    const groups = {
      agent: [],
      rule: [],
      other: [],
      longText: [],
    }
    
    const fieldOrder = [
      '_index', '_id', '_version', '_score',
      'agent.name', 'agent.id',
      'input.type', 'decoder.name', 'location',
      'rule.id', 'rule.level', 'rule.description', 'rule.firedtimes',
      'rule.groups', 'rule.pci_dss', 'rule.hipaa', 'rule.nist_800_53', 'rule.gdpr', 'rule.gpg13', 'rule.tsc', 'rule.mail',
      '@timestamp', 'timestamp', 'id', 'manager.name', 'sort',
    ]
    
    const otherFields = allEntries.filter(
      (entry) => !fieldOrder.includes(entry.key) && !longTextFields.has(entry.key)
    )
    
    allEntries.forEach((entry) => {
      if (longTextFields.has(entry.key)) {
        groups.longText.push(entry)
      } else if (entry.key.startsWith('agent.')) {
        groups.agent.push(entry)
      } else if (entry.key.startsWith('rule.')) {
        groups.rule.push(entry)
      } else if (!fieldOrder.includes(entry.key)) {
        groups.other.push(entry)
      }
    })
    
    const main = fieldOrder
      .map((key) => allEntries.find((e) => e.key === key))
      .filter(Boolean)
    
    return { main, groups: { ...groups, other: otherFields } }
  }

  const selectedDetails = useMemo(() => {
    if (!selectedAlert?.raw) return null
    return organizeAlertDetails(selectedAlert.raw)
  }, [selectedAlert])

  const selectedRawJsonText = useMemo(
    () => (selectedAlert?.raw ? JSON.stringify(selectedAlert.raw, null, 2) : ''),
    [selectedAlert],
  )

  const selectedRawJsonLines = useMemo(
    () => (selectedRawJsonText ? selectedRawJsonText.split('\n') : []),
    [selectedRawJsonText],
  )

  function tokenizeJsonLine(line) {
    const tokens = []
    let index = 0

    function pushToken(text, type = 'plain') {
      if (text) tokens.push({ text, type })
    }

    while (index < line.length) {
      const char = line[index]

      if (/\s/.test(char)) {
        const start = index
        while (index < line.length && /\s/.test(line[index])) index += 1
        pushToken(line.slice(start, index), 'plain')
        continue
      }

      if (char === '"') {
        let end = index + 1
        let escaped = false

        while (end < line.length) {
          const nextChar = line[end]
          if (escaped) {
            escaped = false
            end += 1
            continue
          }
          if (nextChar === '\\') {
            escaped = true
            end += 1
            continue
          }
          if (nextChar === '"') {
            end += 1
            break
          }
          end += 1
        }

        const stringToken = line.slice(index, end)
        let probe = end
        while (probe < line.length && /\s/.test(line[probe])) probe += 1
        const tokenType = line[probe] === ':' ? 'key' : 'string'
        pushToken(stringToken, tokenType)
        index = end
        continue
      }

      if (/[{}\[\],:]/.test(char)) {
        pushToken(char, 'punctuation')
        index += 1
        continue
      }

      const remaining = line.slice(index)
      const numberMatch = remaining.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
      if (numberMatch) {
        pushToken(numberMatch[0], 'number')
        index += numberMatch[0].length
        continue
      }

      const literalMatch = remaining.match(/^(true|false|null)\b/)
      if (literalMatch) {
        const literal = literalMatch[1]
        pushToken(literal, literal === 'null' ? 'null' : 'boolean')
        index += literal.length
        continue
      }

      pushToken(char, 'plain')
      index += 1
    }

    return tokens
  }

  const selectedRawJsonTokenLines = useMemo(
    () => selectedRawJsonLines.map((line) => tokenizeJsonLine(line)),
    [selectedRawJsonLines],
  )

  const hasCopiedJson = copyState === 'Copied'

  function clampPaneWidth(value) {
    return Math.max(MIN_ALERTS_PANE_WIDTH, Math.min(MAX_ALERTS_PANE_WIDTH, value))
  }

  function stopContentResize() {
    isResizingContentRef.current = false
    document.body.classList.remove('resizing-columns')
    window.removeEventListener('mousemove', handleContentResize)
    window.removeEventListener('mouseup', stopContentResize)
  }

  function handleContentResize(event) {
    if (!isResizingContentRef.current) return
    const bounds = contentGridRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return

    const ratio = ((event.clientX - bounds.left) / bounds.width) * 100
    setAlertsPaneWidth(clampPaneWidth(ratio))
  }

  function startContentResize(event) {
    if (window.innerWidth <= 1450) return
    event.preventDefault()
    isResizingContentRef.current = true
    document.body.classList.add('resizing-columns')
    window.addEventListener('mousemove', handleContentResize)
    window.addEventListener('mouseup', stopContentResize)
  }

  useEffect(() => () => stopContentResize(), [])

  return (
    <AppLayout>
      <div id="dashboard">
        <section className="metrics-grid">
          {cards.map((card) => <MetricCard key={card.label} {...card} />)}
        </section>

        <section className="panel hunt-panel" id="hunt" ref={huntPanelRef}>
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleTranslateOnly()
                    }
                  }}
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

        <section className="panel trend-panel" style={chartPanelHeight ? { height: `${chartPanelHeight}px` } : undefined}>
          <AlertsTrendChart
            points={trendPoints}
            granularity={chartGranularity}
            isZoomed={chartZoomStack.length > 0}
            zoomLabel={chartZoomLabel}
            onBarClick={handleChartBarClick}
            onResetZoom={resetChartZoom}
          />
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <div
          className="content-grid resizable-content-grid"
          id="alerts"
          ref={contentGridRef}
          style={{ '--alerts-pane-width': `${alertsPaneWidth}%` }}
        >
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

          <div
            className="content-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize alerts and details panels"
            onMouseDown={startContentResize}
          />

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

              {selectedAlert && selectedDetails ? (
                <div className="alert-details-block">
                  <div className="details-section">
                    <div className="details-grid">
                      {selectedDetails.main.map((entry) => (
                        <div key={entry.key} className="detail-row">
                          <span className="detail-label">{entry.key}</span>
                          <span className="detail-value">{entry.key.includes('timestamp') || entry.key === '@timestamp' ? formatDetailTimestamp(entry.value) : entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedDetails.groups.agent.length > 0 && (
                    <div className="details-section">
                      <h4 className="details-group-title">Agent</h4>
                      <div className="details-grid">
                        {selectedDetails.groups.agent.map((entry) => (
                          <div key={entry.key} className="detail-row">
                            <span className="detail-label">{entry.key.replace('agent.', '')}</span>
                            <span className="detail-value">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedDetails.groups.rule.length > 0 && (
                    <div className="details-section">
                      <h4 className="details-group-title">Rule</h4>
                      <div className="details-grid">
                        {selectedDetails.groups.rule.map((entry) => (
                          <div key={entry.key} className="detail-row">
                            <span className="detail-label">{entry.key.replace('rule.', '')}</span>
                            <span className="detail-value">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedDetails.groups.longText.length > 0 && (
                    <div className="details-section">
                      <h4 className="details-group-title">Content</h4>
                      {selectedDetails.groups.longText.map((entry) => (
                        <div key={entry.key} className="detail-long-field">
                          <span className="detail-label">{entry.key}</span>
                          <pre className="detail-long-value">{entry.value}</pre>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedDetails.groups.other.length > 0 && (
                    <div className="details-section">
                      <h4 className="details-group-title">Other</h4>
                      <div className="details-grid">
                        {selectedDetails.groups.other.map((entry) => (
                          <div key={entry.key} className="detail-row">
                            <span className="detail-label">{entry.key}</span>
                            <span className="detail-value">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="panel-header" style={{ marginTop: '1.5rem' }}>
                    <h3>Raw JSON</h3>
                    <button
                      type="button"
                      className={`secondary-button copy-json-btn ${hasCopiedJson ? 'copied' : ''}`.trim()}
                      onClick={copySelectedAlertJson}
                      aria-label="Copy JSON"
                      title={copyState || 'Copy JSON'}
                    >
                      {hasCopiedJson ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M9 16.2L4.8 12L3.4 13.4L9 19L21 7L19.6 5.6L9 16.2Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M16 1H6C4.9 1 4 1.9 4 3V17H6V3H16V1ZM19 5H10C8.9 5 8 5.9 8 7V21C8 22.1 8.9 23 10 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H10V7H19V21Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="json-viewer" role="region" aria-label="Raw JSON viewer">
                    <div className="json-editor-topbar">
                      <span className="json-dot" />
                      <span className="json-dot" />
                      <span className="json-dot" />
                      <span className="json-editor-title">alert.json</span>
                    </div>
                    <ol className="json-lines">
                      {selectedRawJsonTokenLines.map((tokens, index) => (
                        <li key={`json-line-${index + 1}`}>
                          <code>
                            {tokens.length
                              ? tokens.map((token, tokenIndex) => (
                                  <span key={`json-token-${index + 1}-${tokenIndex}`} className={`json-token json-token-${token.type}`}>
                                    {token.text}
                                  </span>
                                ))
                              : ' '}
                          </code>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
