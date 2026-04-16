import { useEffect, useMemo, useRef, useState } from 'react'

function formatTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function formatAxisTimestamp(value, granularity) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  if (granularity === 'hour') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (granularity === 'minute') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (granularity === 'second') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (granularity === 'millisecond') return `${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.${String(date.getMilliseconds()).padStart(3, '0')}`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function inferGranularity(items) {
  if (items.length < 2) return 'day'
  const deltas = []
  for (let index = 1; index < items.length; index += 1) {
    const current = new Date(items[index].timestamp).getTime()
    const previous = new Date(items[index - 1].timestamp).getTime()
    if (Number.isFinite(current) && Number.isFinite(previous) && current > previous) {
      deltas.push(current - previous)
    }
  }
  if (!deltas.length) return 'day'
  const avgDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length
  if (avgDelta <= 90 * 60 * 1000) return 'hour'
  if (avgDelta <= 36 * 60 * 60 * 1000) return 'day'
  if (avgDelta <= 9 * 24 * 60 * 60 * 1000) return 'week'
  return 'month'
}

function buildTicks(maxValue) {
  const safeMax = Math.max(1, maxValue)
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(safeMax * ratio))
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getBarFillColor(intensity, active) {
  if (active) return 'hsla(191, 100%, 72%, 1)'
  const normalized = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1)
  const alpha = 0.2 + normalized * 0.78
  const saturation = 52 + normalized * 44
  const lightness = 34 + normalized * 30
  return `hsla(194, ${saturation}%, ${lightness}%, ${alpha})`
}

function getBarStrokeColor(intensity, active) {
  if (active) return 'hsla(190, 100%, 82%, 1)'
  const normalized = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1)
  const alpha = 0.26 + normalized * 0.68
  const saturation = 58 + normalized * 40
  const lightness = 40 + normalized * 36
  return `hsla(197, ${saturation}%, ${lightness}%, ${alpha})`
}

export default function AlertsTrendChart({ points, granularity = 'day', isZoomed = false, zoomLabel = '', onBarClick, onResetZoom }) {
  const [hoveredBar, setHoveredBar] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [chartBounds, setChartBounds] = useState({ width: 0, height: 0 })
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 })
  const chartRef = useRef(null)
  const tooltipRef = useRef(null)

  const chart = useMemo(() => {
    const normalized = (Array.isArray(points) ? points : [])
      .map((point) => ({
        timestamp: point?.timestamp,
        count: Number(point?.count ?? 0),
      }))
      .filter((point) => point.timestamp && Number.isFinite(point.count))

    const width = 900
    const height = 320
    const padding = { top: 18, right: 20, bottom: 52, left: 58 }
    const innerWidth = width - padding.left - padding.right
    const innerHeight = height - padding.top - padding.bottom

    if (!normalized.length) {
      return {
        width,
        height,
        padding,
        bars: [],
        yTicks: [],
        maxCount: 0,
        granularity: 'day',
      }
    }

    const resolvedGranularity = granularity || inferGranularity(normalized)
    const maxCount = Math.max(...normalized.map((point) => point.count), 1)
    const yTicks = buildTicks(maxCount)

    const step = innerWidth / Math.max(1, normalized.length)
    const barWidth = Math.max(8, Math.min(44, step * 0.72))

    const bars = normalized.map((point, index) => {
      const x = padding.left + index * step + (step - barWidth) / 2
      const ratio = point.count / maxCount
      const barHeight = Math.max(2, ratio * innerHeight)
      const y = padding.top + innerHeight - barHeight
      return {
        ...point,
        index,
        x,
        y,
        barWidth,
        barHeight,
        intensity: maxCount > 0 ? Math.log1p(point.count) / Math.log1p(maxCount) : 0,
      }
    })

    return { width, height, padding, bars, yTicks, maxCount, granularity: resolvedGranularity }
  }, [granularity, points])

  function handleMouseMove(event, bar) {
    const bounds = chartRef.current?.getBoundingClientRect()
    if (!bounds) return
    setChartBounds({ width: bounds.width, height: bounds.height })
    setHoveredBar(bar)
    setTooltipPos({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    })
  }

  function handleMouseLeave() {
    setHoveredBar(null)
  }

  useEffect(() => {
    if (!hoveredBar || !tooltipRef.current) return
    const bounds = tooltipRef.current.getBoundingClientRect()
    const width = Math.round(bounds.width)
    const height = Math.round(bounds.height)
    setTooltipSize((previous) => {
      if (previous.width === width && previous.height === height) return previous
      return { width, height }
    })
  }, [hoveredBar, tooltipPos.x, tooltipPos.y])

  const tooltipMaxLeft = Math.max(8, chartBounds.width - tooltipSize.width - 8)
  const tooltipPreferredTop = tooltipPos.y - tooltipSize.height - 10
  const tooltipFallbackTop = tooltipPos.y + 12
  const tooltipMaxTop = Math.max(8, chartBounds.height - tooltipSize.height - 8)
  const tooltipLeft = clamp(tooltipPos.x + 12, 8, tooltipMaxLeft)
  const tooltipTop = clamp(tooltipPreferredTop >= 8 ? tooltipPreferredTop : tooltipFallbackTop, 8, tooltipMaxTop)

  return (
    <div className="trend-chart-wrap">
      <div className="panel-header">
        <h2>Alert chronology</h2>
        <div className="trend-meta">
          {isZoomed ? <span className="pill">Zoomed: {zoomLabel}</span> : <span className="muted small">Click bars to drill down timeline</span>}
          {isZoomed ? (
            <button type="button" className="secondary-button trend-reset-btn" onClick={onResetZoom}>
              Reset zoom
            </button>
          ) : null}
        </div>
      </div>

      {chart.bars.length ? (
        <div className="trend-chart-area" ref={chartRef}>
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" className="trend-chart" role="img" aria-label="Alert bar chart">
            <line
              x1={chart.padding.left}
              y1={chart.height - chart.padding.bottom}
              x2={chart.width - chart.padding.right}
              y2={chart.height - chart.padding.bottom}
              className="axis-line"
            />
            <line
              x1={chart.padding.left}
              y1={chart.padding.top}
              x2={chart.padding.left}
              y2={chart.height - chart.padding.bottom}
              className="axis-line"
            />

            {chart.yTicks.map((tick) => {
              const ratio = tick / Math.max(1, chart.maxCount)
              const y = chart.padding.top + (1 - ratio) * (chart.height - chart.padding.top - chart.padding.bottom)
              return (
                <g key={`ytick-${tick}`}>
                  <text x={chart.padding.left - 10} y={y + 4} textAnchor="end" className="axis-label">
                    {tick}
                  </text>
                </g>
              )
            })}

            {chart.bars.filter((_, index) => {
              if (chart.bars.length <= 10) return true
              const spacing = Math.ceil(chart.bars.length / 6)
              return index % spacing === 0 || index === chart.bars.length - 1
            }).map((bar) => (
              <text key={`xtick-${bar.timestamp}`} x={bar.x + bar.barWidth / 2} y={chart.height - 16} textAnchor="middle" className="axis-label">
                {formatAxisTimestamp(bar.timestamp, chart.granularity)}
              </text>
            ))}

            

            {chart.bars.map((bar) => {
              const active = hoveredBar?.index === bar.index
              return (
                <rect
                  key={`${bar.timestamp}-${bar.index}`}
                  x={bar.x}
                  y={bar.y}
                  width={bar.barWidth}
                  height={bar.barHeight}
                  rx={3}
                  className={`trend-bar ${active ? 'active' : ''} ${chart.granularity !== 'millisecond' ? 'clickable' : ''}`}
                  style={{
                    fill: getBarFillColor(bar.intensity, active),
                    stroke: getBarStrokeColor(bar.intensity, active),
                  }}
                  onMouseMove={(event) => handleMouseMove(event, bar)}
                  onMouseLeave={handleMouseLeave}
                  onClick={() => onBarClick?.(bar, chart.granularity)}
                />
              )
            })}
          </svg>

          {hoveredBar ? (
            <div
              ref={tooltipRef}
              className="trend-tooltip"
              style={{
                left: `${tooltipLeft}px`,
                top: `${tooltipTop}px`,
              }}
            >
              <strong>{hoveredBar.count} alerts</strong>
              <span className="muted small">{formatTimestamp(hoveredBar.timestamp)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted">No trend data available for the selected filters.</p>
      )}
    </div>
  )
}
