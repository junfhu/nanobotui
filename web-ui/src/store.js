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
  
  // Send message
  sendMessage: async (sessionId, content) => {
    set({ sending: true, error: null })
    try {
      const response = await api.sendMessage(sessionId, content)
      const currentMessages = get().messages
      // Add user message
      const userMessage = {
        id: `temp-${Date.now()}`,
        sessionId,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        sequence: currentMessages.length,
        toolSteps: [],
        tokenUsage: null
      }
      // Add assistant message
      const assistantMessage = response.assistantMessage
      set({ 
        messages: [...currentMessages, userMessage, assistantMessage],
        sending: false 
      })
      return response
    } catch (error) {
      set({ error: error.message, sending: false })
      throw error
    }
  },
  
  // Clear messages
  clearMessages: () => {
    set({ messages: [] })
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
  }
}))
