import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { clearAuthState, getStoredUser, setAuthState } from '../lib/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function restoreSession() {
      try {
        const response = await api.get('/auth/me')
        if (active) {
          setUser(response.data)
          setAuthState({ user: response.data })
        }
      } catch {
        clearAuthState()
        if (active) setUser(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    restoreSession()
    return () => {
      active = false
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      async login(username, password) {
        const response = await api.post('/auth/login', { username, password })
        const { access_token: accessToken, refresh_token: refreshToken } = response.data
        setAuthState({ accessToken, refreshToken })
        const me = await api.get('/auth/me')
        setUser(me.data)
        setAuthState({ user: me.data })
      },
      async logout() {
        const refreshToken = localStorage.getItem('octopus_refresh_token')
        try {
          if (refreshToken) {
            await api.post('/auth/logout', { refresh_token: refreshToken })
          }
        } finally {
          clearAuthState()
          setUser(null)
        }
      },
      async resetPassword(currentPassword, newPassword) {
        await api.post('/auth/change-password', {
          current_password: currentPassword,
          new_password: newPassword,
        })
      },
      setUser,
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
