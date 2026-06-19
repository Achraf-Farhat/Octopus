import { fireEvent, render, screen } from '@testing-library/react'
import AIExplanation from '../components/AIExplanation'
import { expect, test, vi } from 'vitest'

test('renders AIExplanation text and handles button interactions', () => {
  const onExplain = vi.fn()
  const explanation = 'This alert indicates a potential brute force attempt.'
  const selectedAlert = { id: 1 }

  render(
    <AIExplanation
      explanation={explanation}
      onExplain={onExplain}
      busy={false}
      selectedAlert={selectedAlert}
    />
  )

  expect(screen.getByText(explanation)).toBeInTheDocument()
  
  const button = screen.getByRole('button', { name: /Explain selected alert/i })
  expect(button).toBeEnabled()

  fireEvent.click(button)
  expect(onExplain).toHaveBeenCalledTimes(1)
})

test('disables button when busy or no selected alert', () => {
  const { rerender } = render(
    <AIExplanation
      explanation="Test"
      onExplain={() => {}}
      busy={true}
      selectedAlert={{ id: 1 }}
    />
  )

  expect(screen.getByRole('button', { name: /Explaining…/i })).toBeDisabled()

  rerender(
    <AIExplanation
      explanation="Test"
      onExplain={() => {}}
      busy={false}
      selectedAlert={null}
    />
  )

  expect(screen.getByRole('button', { name: /Explain selected alert/i })).toBeDisabled()
})
