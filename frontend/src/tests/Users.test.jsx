import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Users from '../pages/Users'
import api from '../lib/api'
import { expect, test, vi } from 'vitest'

vi.mock('../components/AppLayout', () => ({
  default: ({ children }) => <div data-testid="app-layout">{children}</div>,
}))

vi.mock('../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

test('loads and displays users list successfully', async () => {
  const usersData = [
    { id: 1, username: 'alice', email: 'alice@example.com', role: 'Admin', is_active: true },
    { id: 2, username: 'bob', email: 'bob@example.com', role: 'L1', is_active: false },
  ]
  api.get.mockResolvedValue({ data: usersData })

  render(<Users />)

  expect(api.get).toHaveBeenCalledWith('/users')

  await waitFor(() => {
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0)
    expect(screen.getByText('Yes')).toBeInTheDocument()

    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('L1').length).toBeGreaterThan(0)
    expect(screen.getByText('No')).toBeInTheDocument()
  })
})

test('shows error when loading users fails', async () => {
  api.get.mockRejectedValue(new Error('Load failed'))

  render(<Users />)

  await waitFor(() => {
    expect(screen.getByText(/Could not load users\. Requires Manager or higher\./i)).toBeInTheDocument()
    expect(screen.getByText('No users available.')).toBeInTheDocument()
  })
})

test('creates a new user and reloads list', async () => {
  const usersData = [{ id: 1, username: 'alice', email: 'alice@example.com', role: 'Admin', is_active: true }]
  api.get.mockResolvedValueOnce({ data: usersData })
  api.post.mockResolvedValue({ data: { id: 2 } })
  api.get.mockResolvedValueOnce({
    data: [
      ...usersData,
      { id: 2, username: 'charlie', email: 'charlie@example.com', role: 'L2', is_active: true },
    ],
  })

  render(<Users />)

  await waitFor(() => {
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  const usernameInput = screen.getByPlaceholderText('Username')
  const emailInput = screen.getByPlaceholderText('Email')
  const passwordInput = screen.getByPlaceholderText('Password')
  const roleSelect = screen.getByRole('combobox')
  const submitButton = screen.getByRole('button', { name: /Create user/i })

  fireEvent.change(usernameInput, { target: { value: 'charlie' } })
  fireEvent.change(emailInput, { target: { value: 'charlie@example.com' } })
  fireEvent.change(passwordInput, { target: { value: 'password456' } })
  fireEvent.change(roleSelect, { target: { value: 'L2' } })

  fireEvent.click(submitButton)

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/users', {
      username: 'charlie',
      email: 'charlie@example.com',
      password: 'password456',
      role: 'L2',
    })
    expect(screen.getByText('charlie')).toBeInTheDocument()
  })
})

test('shows error when creating user fails', async () => {
  api.get.mockResolvedValue({ data: [] })
  api.post.mockRejectedValue(new Error('Create failed'))

  render(<Users />)

  const submitButton = screen.getByRole('button', { name: /Create user/i })
  fireEvent.click(submitButton)

  await waitFor(() => {
    expect(screen.getByText(/Could not create user\. Requires Admin role\./i)).toBeInTheDocument()
  })
})
