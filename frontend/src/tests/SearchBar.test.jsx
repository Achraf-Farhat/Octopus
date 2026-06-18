import { render, screen } from '@testing-library/react'
import SearchBar from '../components/SearchBar'
import { expect, test } from 'vitest'

test('renders SearchBar component', () => {
  render(<SearchBar value="" onChange={() => {}} onTranslate={() => {}} busy={false} />)
  expect(screen.getByLabelText(/Natural language search/i)).toBeInTheDocument()
})
