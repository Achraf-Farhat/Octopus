import { render, screen } from '@testing-library/react'
import MetricCard from '../components/MetricCard'
import { expect, test } from 'vitest'

test('renders MetricCard with label, value, and hint', () => {
  render(<MetricCard label="Active Alerts" value="42" hint="10% increase" tone="high" />)
  expect(screen.getByText('Active Alerts')).toBeInTheDocument()
  expect(screen.getByText('42')).toBeInTheDocument()
  expect(screen.getByText('10% increase')).toBeInTheDocument()
})

test('renders MetricCard value with correct tone class name', () => {
  const { rerender } = render(<MetricCard label="Total" value="10" tone="total" />)
  let valNode = screen.getByText('10')
  expect(valNode).toHaveClass('metric-value-total')

  rerender(<MetricCard label="High" value="20" tone="high" />)
  valNode = screen.getByText('20')
  expect(valNode).toHaveClass('metric-value-high')
})
