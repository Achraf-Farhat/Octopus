import { useMemo, useState } from 'react'

function formatTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function formatAxisTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function createCurvedPath(points) {
  if (points.length < 2) {
    return points.length === 1 ? `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}` : ''
  }

  const pathParts = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`]

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const previous = points[index - 1] ?? current
    const afterNext = points[index + 2] ?? next

    const controlPoint1X = current.x + (next.x - previous.x) / 6
    const controlPoint1Y = current.y + (next.y - previous.y) / 6
    const controlPoint2X = next.x - (afterNext.x - current.x) / 6
    const controlPoint2Y = next.y - (afterNext.y - current.y) / 6

    pathParts.push(
      `C ${controlPoint1X.toFixed(2)} ${controlPoint1Y.toFixed(2)}, ${controlPoint2X.toFixed(2)} ${controlPoint2Y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
    )
  }

  return pathParts.join(' ')
}

function buildTicks(maxValue) {
  const safeMax = Math.max(1, maxValue)
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(safeMax * ratio))
}

export default function AlertsTrendChart({ points }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  const chart = useMemo(() => {
    const safePoints = Array.isArray(points) ? points : []
    const normalized = safePoints
      .map((point) => ({
        timestamp: point?.timestamp,
        count: Number(point?.count ?? 0),
      }))
      .filter((point) => point.timestamp && Number.isFinite(point.count))

    const width = 860
    const height = 300
    const padding = { top: 16, right: 24, bottom: 46, left: 58 }
    const innerWidth = width - padding.left - padding.right
    const innerHeight = height - padding.top - padding.bottom

    if (!normalized.length) {
      return { width, height, points: [], path: '', maxCount: 0, padding, yTicks: [], xTicks: [] }
    }

    const maxCount = Math.max(...normalized.map((point) => point.count), 1)
    const minTime = new Date(normalized[0].timestamp).getTime()
    const maxTime = new Date(normalized[normalized.length - 1].timestamp).getTime()
    const timeSpan = Math.max(1, maxTime - minTime)

    const scaledPoints = normalized.map((point) => {
      const xValue = new Date(point.timestamp).getTime()
      const x = padding.left + ((xValue - minTime) / timeSpan) * innerWidth
      const y = padding.top + (1 - point.count / maxCount) * innerHeight
      return { ...point, x, y }
    })

    const path = createCurvedPath(scaledPoints)
    const yTicks = buildTicks(maxCount)
    const xTickIndexes = [0, Math.floor((scaledPoints.length - 1) / 3), Math.floor((scaledPoints.length - 1) * 2 / 3), scaledPoints.length - 1]
    const xTicks = Array.from(new Set(xTickIndexes)).map((index) => scaledPoints[index])

    return { width, height, points: scaledPoints, path, maxCount, padding, yTicks, xTicks }
  }, [points])

  const hoveredPoint = hoverIndex !== null ? chart.points[hoverIndex] : null

  return (
    <div className="trend-chart-wrap">
      <div className="panel-header">
        <h2>Alert progression</h2>
        <span className="muted small">Hover the line for details</span>
      </div>
      {chart.points.length ? (
        <div className="trend-chart-area">
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="trend-chart" role="img" aria-label="Alert trend chart">
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

            {chart.xTicks.map((point) => (
              <g key={`xtick-${point.timestamp}`}>
                <text x={point.x} y={chart.height - 16} textAnchor="middle" className="axis-label">
                  {formatAxisTimestamp(point.timestamp)}
                </text>
              </g>
            ))}

            <text x={chart.padding.left + 4} y={chart.padding.top + 10} className="axis-label">
              Count
            </text>
            <text x={chart.width - chart.padding.right - 88} y={chart.height - 10} className="axis-label">
              Timestamp
            </text>

            <path d={chart.path} className="trend-line" />

            {chart.points.map((point, index) => (
              <circle
                key={`${point.timestamp}-${index}`}
                cx={point.x}
                cy={point.y}
                r={hoverIndex === index ? 4.25 : 2.4}
                className="trend-node"
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            ))}
          </svg>

          {hoveredPoint ? (
            <div className="trend-tooltip">
              <strong>{hoveredPoint.count} alerts</strong>
              <span className="muted small">{formatTimestamp(hoveredPoint.timestamp)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted">No trend data available for the selected filters.</p>
      )}
    </div>
  )
}
