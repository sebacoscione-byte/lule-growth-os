export interface TrendSeries {
  key: string
  label: string
  color: string
}

function shortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })
}

export function TrendChart({
  points,
  series,
  height = 240,
  emptyMessage = "Todavía no hay datos para graficar en este período.",
}: {
  points: Array<{ date: string }>
  series: TrendSeries[]
  height?: number
  emptyMessage?: string
}) {
  const valueAt = (point: { date: string }, key: string) => Number((point as unknown as Record<string, unknown>)[key]) || 0
  const hasData = points.some(point => series.some(item => valueAt(point, item.key) > 0))
  if (points.length === 0 || !hasData) {
    return <div className="flex min-h-48 items-center justify-center rounded-xl bg-gray-50 px-4 text-center text-sm text-gray-400">{emptyMessage}</div>
  }

  const width = 760
  const padding = { top: 16, right: 16, bottom: 34, left: 44 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const maxValue = Math.max(1, ...points.flatMap(point => series.map(item => valueAt(point, item.key))))
  const x = (index: number) => padding.left + (points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth)
  const y = (value: number) => padding.top + chartHeight - (value / maxValue) * chartHeight
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2" aria-hidden="true">
        {series.map(item => (
          <span key={item.key} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Evolución temporal de ${series.map(item => item.label).join(", ")}`}
      >
        {ticks.map(tick => {
          const tickY = y(maxValue * tick)
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={tickY} y2={tickY} stroke="#e5e7eb" strokeWidth="1" />
              <text x={padding.left - 8} y={tickY + 4} textAnchor="end" fontSize="10" fill="#9ca3af">
                {Math.round(maxValue * tick)}
              </text>
            </g>
          )
        })}
        {series.map(item => {
          const coordinates = points.map((point, index) => `${x(index)},${y(valueAt(point, item.key))}`).join(" ")
          return (
            <g key={item.key}>
              <polyline points={coordinates} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((point, index) => valueAt(point, item.key) > 0 && (
                <circle key={`${item.key}-${point.date}`} cx={x(index)} cy={y(valueAt(point, item.key))} r="2.5" fill={item.color} />
              ))}
            </g>
          )
        })}
        {labelIndexes.map(index => (
          <text key={index} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fontSize="10" fill="#9ca3af">
            {shortDate(points[index].date)}
          </text>
        ))}
      </svg>
    </div>
  )
}
