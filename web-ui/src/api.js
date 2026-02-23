import i18n from './i18n'

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'
const AUTH_TOKEN_KEY = 'nanobot-auth-token'
const AUTH_USER_KEY = 'nanobot-auth-user'

export const authStorage = {
  getToken: () => localStorage.getItem(AUTH_TOKEN_KEY) || '',
  setToken: (token) => localStorage.setItem(AUTH_TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(AUTH_TOKEN_KEY),
  getUser: () => {
    try {
      const raw = localStorage.getItem(AUTH_USER_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },
  setUser: (user) => localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || null)),
  clearUser: () => localStorage.removeItem(AUTH_USER_KEY),
  clearAll: () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
  }
}

async function request(path, options = {}) {
  const { skipJsonContentType, ...fetchOptions } = options
  const token = authStorage.getToken()
  const headers = skipJsonContentType
    ? { ...(fetchOptions.headers || {}) }
    : { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  
  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      success: false,
      error: { code: 'NETWORK_ERROR', message: i18n.t('api.networkError') }
    }))
    const err = new Error(errorData.error?.message || i18n.t('api.requestFailed'))
    err.code = errorData.error?.code
    throw err
  }

  const data = await response.json()
  
  if (!data.success) {
    const err = new Error(data.error?.message || i18n.t('api.requestFailed'))
    err.code = data.error?.code
    throw err
  }

  return data.data
}

export const api = {
  // Health check
  health: () => request('/health'),

  // Sessions
  getSessions: (page = 1, pageSize = 20) =>
    request(`/chat/sessions?page=${page}&pageSize=${pageSize}`),

  createSession: (title) =>
    request('/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  deleteSession: (sessionId) =>
    request(`/chat/sessions/${sessionId}`, {
      method: 'DELETE',
    }),

  renameSession: (sessionId, title) =>
    request(`/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  // Messages
  getMessages: (sessionId, limit = 50, before) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.append('before', String(before))
    return request(`/chat/sessions/${sessionId}/messages?${params}`)
  },

  sendMessage: (sessionId, content, signal) =>
    request(`/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
      signal,
    }),

  sendMessageStream: async (sessionId, content, { onProgress, onAck, signal } = {}) => {
    const token = authStorage.getToken()
    const headers = { 'Content-Type': 'application/json' }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    const response = await fetch(`${API_BASE}/chat/sessions/${sessionId}/messages/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content }),
      signal,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        success: false,
        error: { code: 'NETWORK_ERROR', message: i18n.t('api.networkError') }
      }))
      const err = new Error(errorData.error?.message || i18n.t('api.requestFailed'))
      err.code = errorData.error?.code
      throw err
    }

    if (!response.body) {
      throw new Error(i18n.t('api.requestFailed'))
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalData = null

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''

      for (const frame of frames) {
        const line = frame
          .split('\n')
          .find((l) => l.startsWith('data:'))
        if (!line) continue

        const payload = JSON.parse(line.slice(5).trim())
        if (payload.type === 'progress' && onProgress) {
          onProgress(payload.content || '')
        } else if (payload.type === 'ack' && onAck) {
          onAck(payload.userMessage)
        } else if (payload.type === 'final') {
          finalData = {
            content: payload.content,
            assistantMessage: payload.assistantMessage,
          }
        } else if (payload.type === 'error') {
          throw new Error(payload.message || i18n.t('api.requestFailed'))
        }
      }
    }

    if (!finalData) {
      throw new Error(i18n.t('api.requestFailed'))
    }
    return finalData
  },

  subscribeSessionEvents: (sessionId, { onMessage, onError } = {}) => {
    const token = authStorage.getToken()
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    const source = new EventSource(`${API_BASE}/chat/sessions/${sessionId}/events/stream${qs}`)

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (onMessage) onMessage(payload)
      } catch {
        // Ignore malformed SSE payloads.
      }
    }

    source.onerror = (err) => {
      if (onError) onError(err)
    }

    return source
  },

  login: (username, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => request('/auth/me'),

  logout: () => request('/auth/logout', { method: 'POST' }),

  changePassword: (oldPassword, newPassword) =>
    request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  // Configuration
  getConfig: () => request('/config'),

  updateAgentConfig: (agent) =>
    request('/config/agent', {
      method: 'PUT',
      body: JSON.stringify({ agent }),
    }),
  
  // IM Channels
  getChannels: () => request('/channels'),
  
  updateChannels: (channels) =>
    request('/channels', {
      method: 'PUT',
      body: JSON.stringify(channels),
    }),

  // AI Providers
  getProviders: () => request('/providers'),
  
  createProvider: (provider) =>
    request('/providers', {
      method: 'POST',
      body: JSON.stringify(provider),
    }),

  // Status
  getStatus: () => request('/status'),

  restartWebBackend: () =>
    request('/system/restart-web', {
      method: 'POST',
    }),

  // Save full config
  saveConfig: (config) =>
    request('/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  backupConfig: (filename, config) =>
    request('/config/backup', {
      method: 'POST',
      body: JSON.stringify({ filename, config }),
    }),

  restoreConfig: (filename) =>
    request('/config/restore', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),

  // Skills
  listSkills: () => request('/skills'),

  deleteSkill: (name, source) =>
    request(`/skills/${encodeURIComponent(name)}?source=${encodeURIComponent(source)}`, {
      method: 'DELETE',
    }),
}
