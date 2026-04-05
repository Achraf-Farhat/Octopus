export default function PermissionGate({ allowedRoles = [], userRole, children, fallback = null }) {
  if (!allowedRoles.length || allowedRoles.includes(userRole)) {
    return children
  }

  return fallback
}
