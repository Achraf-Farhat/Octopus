import { render, screen } from '@testing-library/react'
import PermissionGate from '../components/PermissionGate'
import { expect, test } from 'vitest'

test('renders children if allowedRoles is empty', () => {
  render(
    <PermissionGate allowedRoles={[]} userRole="User">
      <div>Allowed Content</div>
    </PermissionGate>
  )
  expect(screen.getByText('Allowed Content')).toBeInTheDocument()
})

test('renders children if allowedRoles includes userRole', () => {
  render(
    <PermissionGate allowedRoles={['Admin', 'L2']} userRole="Admin">
      <div>Allowed Content</div>
    </PermissionGate>
  )
  expect(screen.getByText('Allowed Content')).toBeInTheDocument()
})

test('renders fallback if userRole is not allowed', () => {
  render(
    <PermissionGate
      allowedRoles={['Admin']}
      userRole="L1"
      fallback={<div>Access Denied</div>}
    >
      <div>Allowed Content</div>
    </PermissionGate>
  )
  expect(screen.queryByText('Allowed Content')).not.toBeInTheDocument()
  expect(screen.getByText('Access Denied')).toBeInTheDocument()
})
