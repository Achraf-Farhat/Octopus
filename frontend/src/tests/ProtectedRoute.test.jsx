import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../context/AuthContext'
import { expect, test, vi } from 'vitest'

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

test('renders loading screen when auth is loading', () => {
  useAuth.mockReturnValue({ isAuthenticated: false, loading: true })

  render(
    <MemoryRouter>
      <ProtectedRoute>
        <div>Secret Area</div>
      </ProtectedRoute>
    </MemoryRouter>
  )

  expect(screen.getByText(/Loading Octopus.../i)).toBeInTheDocument()
  expect(screen.queryByText(/Secret Area/i)).not.toBeInTheDocument()
})

test('redirects to /login when user is not authenticated', () => {
  useAuth.mockReturnValue({ isAuthenticated: false, loading: false })

  render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route
          path="/secret"
          element={
            <ProtectedRoute>
              <div>Secret Area</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>
  )

  expect(screen.queryByText(/Secret Area/i)).not.toBeInTheDocument()
  expect(screen.getByText(/Login Page/i)).toBeInTheDocument()
})

test('renders children when user is authenticated', () => {
  useAuth.mockReturnValue({ isAuthenticated: true, loading: false })

  render(
    <MemoryRouter>
      <ProtectedRoute>
        <div>Secret Area</div>
      </ProtectedRoute>
    </MemoryRouter>
  )

  expect(screen.getByText(/Secret Area/i)).toBeInTheDocument()
})
