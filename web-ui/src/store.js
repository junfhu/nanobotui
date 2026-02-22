import { create } from 'zustand'
import { api } from './api'

// Session store
export const useSessionStore = create((set, get) => ({
  sessions: { items: [] },
  currentSession: null,
  loading: false,
  error: null,
  
  // Load sessions
  loadSessions: async () => {
    set({ loading: true, error: null })
    try {
      const sessions = await api.getSessions()
      set({ sessions, loading: false })
      // Set first session as current if none
      if (!get().currentSession && sessions.items.length > 0) {
        set({ currentSession: sessions.items[0] })
      }
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },
  
  // Create session
  createSession: async (title) => {
    set({ loading: true, error: null })
    try {
      const session = await api.createSession(title)
      const currentSessions = get().sessions
      set({ 
        sessions: { 
          ...currentSessions,
          items: [session, ...currentSessions.items]
        },
        currentSession: session,
        loading: false 
      })
      return session
    } catch (error) {
      set({ error: error.message, loading: false })
      throw error
    }
  },
  
  // Delete session
  deleteSession: async (sessionId) => {
    set({ loading: true, error: null })
    try {
      await api.deleteSession(sessionId)
      const currentSessions = get().sessions
      const updatedSessions = {
        ...currentSessions,
        items: currentSessions.items.filter(s => s.id !== sessionId)
      }
      set({ 
        sessions: updatedSessions,
        currentSession: get().currentSession?.id === sessionId 
          ? (updatedSessions.items.length > 0 ? updatedSessions.items[0] : null)
          : get().currentSession,
        loading: false 
      })
    } catch (error) {
      set({ error: error.message, loading: false })
      throw error
    }
  },
  
  // Rename session
  renameSession: async (sessionId, title) => {
    set({ loading: true, error: null })
    try {
      const result = await api.renameSession(sessionId, title)
      const currentSessions = get().sessions
      const updatedSessions = {
        ...currentSessions,
        items: currentSessions.items.map(s => 
          s.id === sessionId ? { ...s, title, updatedAt: result.updatedAt } : s
        )
      }
      set({ 
        sessions: updatedSessions,
        currentSession: get().currentSession?.id === sessionId 
          ? { ...get().currentSession, title, updatedAt: result.updatedAt }
          : get().currentSession,
        loading: false 
      })
    } catch (error) {
      set({ error: error.message, loading: false })
      throw error
    }
  },
  
  // Set current session
  setCurrentSession: (session) => {
    set({ currentSession: session })
  }
}))

// Message store
export const useMessageStore = create((set, get) => ({
  messages: [],
  loading: false,
  sending: false,
  progress: '',
  abortController: null,
  error: null,
  
  // Load messages
  loadMessages: async (sessionId) => {
    set({ loading: true, error: null })
    try {
      const messages = await api.getMessages(sessionId)
      set({ messages, loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },

  // Refresh messages silently (used for background updates like cron reminders)
  refreshMessages: async (sessionId) => {
    try {
      const messages = await api.getMessages(sessionId)
      set((state) => {
        if (state.sending) {
          return {}
        }
        const currentLastId = state.messages[state.messages.length - 1]?.id
        const incomingLastId = messages[messages.length - 1]?.id
        if (state.messages.length === messages.length && currentLastId === incomingLastId) {
          return {}
        }
        return { messages }
      })
    } catch {
      // Ignore background refresh errors to avoid noisy UI.
    }
  },

  appendIncomingMessage: (incoming) => {
    if (!incoming?.id) {
      return
    }
    set((state) => {
      if (state.messages.some((m) => m.id === incoming.id)) {
        return {}
      }
      // Reconcile optimistic user message with persisted one from SSE.
      if (incoming.role === 'user') {
        const tempIdx = state.messages.findIndex((m) =>
          m.id?.startsWith('temp-user-') &&
          m.role === 'user' &&
          m.sessionId === incoming.sessionId &&
          m.content === incoming.content
        )
        if (tempIdx !== -1) {
          const next = [...state.messages]
          next[tempIdx] = incoming
          return { messages: next }
        }
      }
      return { messages: [...state.messages, incoming] }
    })
  },
  
  // Send message
  sendMessage: async (sessionId, content) => {
    if (get().sending) {
      return { aborted: false, ignored: true }
    }

    const currentMessages = get().messages
    const tempUserId = `temp-user-${Date.now()}`
    const tempUserMessage = {
      id: tempUserId,
      sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      sequence: currentMessages.length,
      toolSteps: [],
      tokenUsage: null
    }

    // Optimistic update: show user message immediately.
    const controller = new AbortController()
    set({
      messages: [...currentMessages, tempUserMessage],
      sending: true,
      progress: '',
      abortController: controller,
      error: null
    })

    try {
      const response = await api.sendMessageStream(sessionId, content, {
        signal: controller.signal,
        onProgress: (text) => {
          set({ progress: text || '' })
        },
        onAck: (userMessage) => {
          if (!userMessage?.id) return
          set((state) => {
            if (state.messages.some((m) => m.id === userMessage.id)) {
              return {}
            }
            const tempIdx = state.messages.findIndex((m) => m.id === tempUserId)
            if (tempIdx === -1) {
              return { messages: [...state.messages, userMessage] }
            }
            const next = [...state.messages]
            next[tempIdx] = userMessage
            return { messages: next }
          })
        },
      })

      const assistantMessage = response.assistantMessage
      set((state) => {
        if (assistantMessage?.id && state.messages.some((m) => m.id === assistantMessage.id)) {
          return { sending: false, progress: '' }
        }
        return {
          messages: [...state.messages, assistantMessage],
          sending: false,
          progress: ''
        }
      })
      return response
    } catch (error) {
      if (error?.name === 'AbortError') {
        set({ sending: false, progress: '', abortController: null })
        return { aborted: true }
      }
      set({ error: error.message, sending: false, progress: '', abortController: null })
      throw error
    } finally {
      set((state) => {
        if (state.abortController === controller) {
          return { abortController: null }
        }
        return {}
      })
    }
  },

  // Stop current sending request
  stopMessage: () => {
    const controller = get().abortController
    if (controller) {
      controller.abort()
    }
  },
  
  // Clear messages
  clearMessages: () => {
    set({ messages: [], progress: '', abortController: null })
  }
}))

// Config store
export const useConfigStore = create((set, get) => ({
  config: null,
  loading: false,
  saving: false,
  error: null,
  
  // Load config
  loadConfig: async () => {
    set({ loading: true, error: null })
    try {
      const config = await api.getConfig()
      set({ config, loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },
  
  // Update agent config
  updateAgentConfig: async (agentConfig) => {
    set({ saving: true, error: null })
    try {
      await api.updateAgentConfig(agentConfig)
      const currentConfig = get().config
      set({ 
        config: { ...currentConfig, agent: agentConfig },
        saving: false 
      })
    } catch (error) {
      set({ error: error.message, saving: false })
      throw error
    }
  },
  
  // Update channels config
  updateChannels: async (channelsConfig) => {
    set({ saving: true, error: null })
    try {
      await api.updateChannels(channelsConfig)
      const currentConfig = get().config
      set({ 
        config: { ...currentConfig, channels: channelsConfig },
        saving: false 
      })
    } catch (error) {
      set({ error: error.message, saving: false })
      throw error
    }
  },
  
  // Save full config
  saveConfig: async (newConfig) => {
    set({ saving: true, error: null })
    try {
      await api.saveConfig(newConfig)
      set({ config: newConfig, saving: false })
    } catch (error) {
      set({ error: error.message, saving: false })
      throw error
    }
  },

  // Backup config to named file
  backupConfig: async (filename, configToBackup) => {
    set({ saving: true, error: null })
    try {
      const result = await api.backupConfig(filename, configToBackup)
      set({ saving: false })
      return result
    } catch (error) {
      set({ error: error.message, saving: false })
      throw error
    }
  },

  // Restore config from named file
  restoreConfig: async (filename) => {
    set({ saving: true, error: null })
    try {
      const result = await api.restoreConfig(filename)
      const restoredConfig = result?.config || null
      set({
        config: restoredConfig || get().config,
        saving: false
      })
      return result
    } catch (error) {
      set({ error: error.message, saving: false })
      throw error
    }
  }
}))
