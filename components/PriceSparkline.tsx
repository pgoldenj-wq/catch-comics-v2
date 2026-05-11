'use client'

/**
 * PriceSparkline — client component.
 *
 * Renders a compact Recharts line chart of price history over time.
 * Only renders if there are 7 or more data points; shows a placeholder otherwise.
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts'

export interface SparkPoint {
  /** ISO date string, e.g. "2025-03-15" */
  date:  string
  /** Price in major currency units */
  price: number
}

interface Props {
  points:   SparkPoint[]
  currency: string
}

const MIN_POINTS = 7

function fmt(price: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style:    'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(price)
}

export default function PriceSparkline({ points, currency }: Props) {
  if (points.length < MIN_POINTS) {
    return (
      <p className="text-sm text-gray-400 italic">
        Not enough price history yet ({points.length} / {MIN_POINTS} data points needed).
      </p>
    )
  }

  const prices  = points.map(p => p.price)
  const minPrice = Math.min(...prices)
  const data    = points.map(p => ({
    date:  new Date(p.date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
    price: p.price,
  }))

  return (
    <div className="w-full h-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={v => fmt(v, currency)}
          />
          <Tooltip
            formatter={(value) => [fmt(Number(value), currency), 'Price']}
            contentStyle={{
              background: '#1f2937',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#f9fafb',
            }}
          />
          <ReferenceLine
            y={minPrice}
            stroke="#10b981"
            strokeDasharray="3 3"
            label={{ value: 'Low', position: 'right', fontSize: 10, fill: '#10b981' }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#6366f1' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
