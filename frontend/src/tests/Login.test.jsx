import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Login from '../pages/Login'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}))

test('updates input values and submits form successfully', async () => {
  const loginMock = vi.fn().mockResolvedValue()
  const navigateMock = vi.fn()
  useAuth.mockReturnValue({ login: loginMock })
  useNavigate.mockReturnValue(navigateMock)

  render(<Login />)

  const usernameInput = screen.getByLabelText('Username')
  const passwordInput = screen.getByLabelText('Password')
  const submitButton = screen.getByRole('button', { name: /Sign in/i })

  // Check default value
  expect(usernameInput.value).toBe('admin')

  // Update values
  fireEvent.change(usernameInput, { target: { value: 'testuser' } })
  fireEvent.change(passwordInput, { target: { value: 'password123' } })

  expect(usernameInput.value).toBe('testuser')
  expect(passwordInput.value).toBe('password123')

  // Submit
  fireEvent.click(submitButton)

  await waitFor(() => {
    expect(loginMock).toHaveBeenCalledWith('testuser', 'password123')
    expect(navigateMock).toHaveBeenCalledWith('/dashboard', { replace: true })
  })
})

test('shows error banner on failed login', async () => {
  const loginMock = vi.fn().mockRejectedValue(new Error('Auth failed'))
  useAuth.mockReturnValue({ login: loginMock })
  useNavigate.mockReturnValue(vi.fn())

  render(<Login />)

  const passwordInput = screen.getByLabelText('Password')
  const submitButton = screen.getByRole('button', { name: /Sign in/i })

  fireEvent.change(passwordInput, { target: { value: 'wrongpass' } })
  fireEvent.click(submitButton)

  expect(screen.getByRole('button', { name: /Signing in…/i })).toBeDisabled()

  await waitFor(() => {
    expect(screen.getByText(/Invalid credentials or API unavailable\./i)).toBeInTheDocument()
  })

  // After submit completes, button should be re-enabled
  expect(screen.getByRole('button', { name: /Sign in/i })).toBeEnabled()
})
