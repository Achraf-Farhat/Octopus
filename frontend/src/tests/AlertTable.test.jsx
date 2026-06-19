import { render, screen, fireEvent } from '@testing-library/react'
import AlertTable from '../components/AlertTable'
import { expect, test, vi } from 'vitest'

test('renders loading state', () => {
  render(<AlertTable loading={true} />)
  expect(screen.getByText('Loading alerts…')).toBeInTheDocument()
})

test('renders empty state', () => {
  render(<AlertTable alerts={[]} loading={false} />)
  expect(screen.getByText('No alerts available.')).toBeInTheDocument()
})

test('renders alerts list and handles click selection', () => {
  const onSelectAlert = vi.fn()
  const alerts = [
    {
      id: 1,
      timestamp: '2026-06-19T08:00:00Z',
      source: '192.168.1.100',
      severity: 12,
      rule: 'Brute force SSH attempt',
    },
    {
      id: 2,
      timestamp: '2026-06-19T08:05:00Z',
      source: '192.168.1.101',
      severity: 5,
      rule: 'Successful login',
    },
  ]

  render(
    <AlertTable
      alerts={alerts}
      loading={false}
      selectedId={1}
      onSelectAlert={onSelectAlert}
    />
  )

  expect(screen.getByText('192.168.1.100')).toBeInTheDocument()
  expect(screen.getByText('Brute force SSH attempt')).toBeInTheDocument()
  expect(screen.getByText('192.168.1.101')).toBeInTheDocument()
  expect(screen.getByText('Successful login')).toBeInTheDocument()

  // Verify severity tone class
  const highSev = screen.getByText('12')
  expect(highSev).toHaveClass('severity-high')

  const lowSev = screen.getByText('5')
  expect(lowSev).toHaveClass('severity-low')

  // Click on the second row
  const secondRow = screen.getByText('192.168.1.101').closest('tr')
  fireEvent.click(secondRow)
  expect(onSelectAlert).toHaveBeenCalledWith(alerts[1])
})
