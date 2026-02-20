import i18n from './i18n'

const API_BASE = 'http://localhost:8080/api/v1'

async function request(path, options = {}) {
  const { skipJsonContentType, ...fetchOptions } = options
  const headers = skipJsonContentType 
    ? { ...(fetchOptions.headers || {}) }
    : { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) }
  
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

  // Save full config
  saveConfig: (config) =>
    request('/config', {
      method: 'POST',
      body: JSON.stringify(config),
    })
}
