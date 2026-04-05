import axios from 'axios'
import { clearAuthState, getAccessToken, getRefreshToken, setAuthState } from './auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 30000,
})

api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status !== 401 || originalRequest?._retry) {
      return Promise.reject(error)
    }

    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      clearAuthState()
      return Promise.reject(error)
    }

    originalRequest._retry = true
    try {
      const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, { refresh_token: refreshToken })
      const { access_token: accessToken, refresh_token: nextRefreshToken } = response.data
      setAuthState({ accessToken, refreshToken: nextRefreshToken })
      originalRequest.headers.Authorization = `Bearer ${accessToken}`
      return api(originalRequest)
    } catch (refreshError) {
      clearAuthState()
      return Promise.reject(refreshError)
    }
  },
)

export default api
