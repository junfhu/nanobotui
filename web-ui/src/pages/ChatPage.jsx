import React, { useEffect, useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layout, Input, Button, Typography, Avatar, Space, Spin, message, Empty, Modal, ConfigProvider, theme as antdTheme } from 'antd'
import { SendOutlined, PlusOutlined, DeleteOutlined, EditOutlined, RobotOutlined, UserOutlined, StopOutlined } from '@ant-design/icons'
import { useOutletContext } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useSessionStore, useMessageStore } from '../store'
import { api } from '../api'
import 'highlight.js/styles/github.css'
import './ChatPage.css'

const { Header, Sider, Content } = Layout
const { TextArea } = Input
const { Text } = Typography

const extractTextFromNode = (node) => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('')
  if (React.isValidElement(node)) return extractTextFromNode(node.props?.children)
  return ''
}

const copyTextToClipboard = async (text) => {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

const EMPTY_FINAL_PREFIX = '__NB_I18N_EMPTY_FINAL__:'

const ChatPage = () => {
  const { t } = useTranslation()
  const { themeMode = 'dark' } = useOutletContext() || {}
  const isDark = themeMode === 'dark'
  const {
    sessions,
    currentSession,
    loading: sessionsLoading,
    error: sessionsError,
    loadSessions,
    createSession,
    deleteSession,
    renameSession,
    setCurrentSession
  } = useSessionStore()
  const {
    messages,
    loading: messagesLoading,
    sending,
    progress,
    error: messagesError,
    loadMessages,
    appendIncomingMessage,
    sendMessage,
    stopMessage,
    clearMessages
  } = useMessageStore()
  const [inputMessage, setInputMessage] = useState('')
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [sessionToRename, setSessionToRename] = useState(null)
  const messagesEndRef = useRef(null)

  // Load sessions on mount
  useEffect(() => {
    loadSessions()
  }, [])

  // Load messages when current session changes
  useEffect(() => {
    if (currentSession) {
      clearMessages()
      loadMessages(currentSession.id)
    }
  }, [currentSession])

  // Real-time session updates (e.g. cron reminders)
  useEffect(() => {
    if (!currentSession) return
    const source = api.subscribeSessionEvents(currentSession.id, {
      onMessage: (payload) => {
        if (payload?.type === 'message' && payload.message) {
          if (payload.message.sessionId === currentSession.id) {
            appendIncomingMessage(payload.message)
          }
        }
      }
    })

    return () => source.close()
  }, [currentSession?.id])

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages, sending])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Handle create session
  const handleCreateSession = async () => {
    try {
      await createSession()
      message.success(t('chat.sessionCreated'))
    } catch (error) {
      message.error(t('chat.createSessionFailed'))
      console.error(error)
    }
  }

  // Handle delete session
  const handleDeleteSession = async (sessionId) => {
    try {
      await deleteSession(sessionId)
      message.success(t('chat.sessionDeleted'))
    } catch (error) {
      message.error(t('chat.deleteSessionFailed'))
      console.error(error)
    }
  }

  // Handle rename session
  const handleRenameSession = (session) => {
    setSessionToRename(session)
    setRenameTitle(session.title)
    setShowRenameModal(true)
  }

  // Handle save rename
  const handleSaveRename = async () => {
    if (sessionToRename && renameTitle) {
      try {
        await renameSession(sessionToRename.id, renameTitle)
        setShowRenameModal(false)
        setSessionToRename(null)
        setRenameTitle('')
        message.success(t('chat.sessionRenamed'))
      } catch (error) {
        message.error(t('chat.renameSessionFailed'))
        console.error(error)
      }
    }
  }

  // Handle send message
  const handleSendMessage = async () => {
    if (inputMessage.trim() && currentSession) {
      const text = inputMessage.trim()
      setInputMessage('')
      try {
        const result = await sendMessage(currentSession.id, text)
        if (result?.aborted) {
          return
        }
      } catch (error) {
        setInputMessage(text)
        message.error(t('chat.sendMessageFailed'))
        console.error(error)
      }
    }
  }

  const handleStopMessage = () => {
    stopMessage()
  }

  // Handle key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Format message time
  const formatMessageTime = (isoString) => {
    try {
      const d = new Date(isoString)
      const h = String(d.getHours()).padStart(2, '0')
      const m = String(d.getMinutes()).padStart(2, '0')
      return `${h}:${m}`
    } catch {
      return ''
    }
  }

  const antTheme = useMemo(() => ({
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#1890ff',
      borderRadius: 8,
    },
  }), [isDark])

  const PreWithCopy = ({ children, ...props }) => {
    const [copied, setCopied] = useState(false)
    const codeText = extractTextFromNode(children).replace(/\n$/, '')

    const handleCopy = async () => {
      if (!codeText.trim()) return
      try {
        await copyTextToClipboard(codeText)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } catch (error) {
        message.error(t('chat.copyFailed'))
        console.error(error)
      }
    }

    return (
      <div className="code-block">
        <pre {...props}>{children}</pre>
        <button
          type="button"
          className="code-copy-button"
          onClick={handleCopy}
        >
          {copied ? t('chat.copied') : t('chat.copy')}
        </button>
      </div>
    )
  }

  const markdownComponents = useMemo(() => ({
    pre: PreWithCopy
  }), [t])

  const localizeMessageContent = (raw) => {
    const content = raw || ''
    if (!content.startsWith(EMPTY_FINAL_PREFIX)) {
      return content
    }
    const countRaw = content.slice(EMPTY_FINAL_PREFIX.length).trim()
    const toolCount = Number.parseInt(countRaw, 10)
    return t('chat.emptyFinalResponse', { count: Number.isFinite(toolCount) ? toolCount : 0 })
  }

  const renderedMessages = useMemo(() => (
    <div className="messages-container">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`message-wrapper ${msg.role}`}
        >
          <div className="message-bubble">
            <div className="message-header">
              <div className="message-author-row">
                <Avatar
                  icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                  className={`message-avatar ${msg.role}`}
                />
                <Text strong className={`message-speaker ${msg.role}`}>
                  {msg.role === 'user' ? t('chat.you') : t('chat.assistantName')}
                </Text>
              </div>
              {msg.createdAt && (
                <span className="message-time">{formatMessageTime(msg.createdAt)}</span>
              )}
            </div>
            <div className="message-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                className="markdown-body"
                components={markdownComponents}
              >
                {localizeMessageContent(msg.content)}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      ))}
      {sending && (
        <div className="message-wrapper assistant">
          <div className="message-bubble">
            <div className="message-header">
              <div className="message-author-row">
                <Avatar icon={<RobotOutlined />} className="message-avatar assistant" />
                <Text strong className="message-speaker assistant">
                  {t('chat.assistantName')}
                </Text>
              </div>
            </div>
            <div className="message-content">
              <div className="loading-text">
                <div className="loading-status">
                  <Spin size="small" />
                  <span>{t('chat.thinking')}</span>
                </div>
                {progress && (
                  <div className="loading-progress">
                    {progress}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  ), [messages, sending, progress, t])

  return (
    <ConfigProvider theme={antTheme}>
      <Layout className="chat-page">
        <Sider width={280} theme={isDark ? 'dark' : 'light'} className="chat-sider">
          <div className="sider-header">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateSession}
              block
              size="large"
            >
              {t('chat.newSession')}
            </Button>
          </div>
          <div className="sessions-list">
            {sessionsLoading ? (
              <div className="loading-sessions">
                <Spin />
              </div>
            ) : sessionsError ? (
              <div className="error-sessions">
                {sessionsError}
              </div>
            ) : sessions.items && sessions.items.length > 0 ? (
              <>
                {sessions.items.map((session) => (
                  <div
                    key={session.id}
                    className={`session-item ${currentSession?.id === session.id ? 'active' : ''}`}
                    onClick={() => setCurrentSession(session)}
                  >
                    <div className="session-info">
                      <Text ellipsis className="session-title">
                        {session.title}
                      </Text>
                      <Text type="secondary" className="session-meta">
                        {new Date(session.lastMessageAt).toLocaleDateString()}
                      </Text>
                    </div>
                    <div className="session-actions">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRenameSession(session)
                        }}
                        className="session-action-btn"
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteSession(session.id)
                        }}
                        className="session-action-btn"
                      />
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <Empty description={t('chat.noSessions')} className="empty-sessions" />
            )}
          </div>
        </Sider>

        <Layout>
          <Header className="chat-header">
            <Space>
              <Text strong className="chat-session-title">
                {currentSession?.title || t('chat.selectOrCreate')}
              </Text>
            </Space>
          </Header>

          <Content className="chat-content">
            {!currentSession ? (
              <div className="empty-chat">
                <Empty
                  image={<RobotOutlined style={{ fontSize: 64, color: 'var(--nb-primary)' }} />}
                  description={t('chat.selectToStart')}
                />
              </div>
            ) : messagesLoading ? (
              <div className="loading-messages">
                <Spin size="large" />
                <div className="loading-message-text">{t('chat.loadingMessages')}</div>
              </div>
            ) : messagesError ? (
              <div className="error-messages">
                {messagesError}
              </div>
            ) : messages.length > 0 ? (
              renderedMessages
            ) : (
              <div className="empty-chat">
                <Empty
                  image={<RobotOutlined style={{ fontSize: 64, color: 'var(--nb-primary)' }} />}
                  description={t('chat.firstMessage')}
                />
              </div>
            )}
          </Content>

          <div className="chat-input-container">
            <div className="chat-input-row">
              <TextArea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={t('chat.messagePlaceholder')}
                autoSize={{ minRows: 1, maxRows: 4 }}
                disabled={!currentSession || sending}
                className="chat-input"
              />
              <Button
                type="primary"
                icon={sending ? <StopOutlined /> : <SendOutlined />}
                onClick={sending ? handleStopMessage : handleSendMessage}
                danger={sending}
                disabled={(!currentSession || !inputMessage.trim()) && !sending}
                className="send-button"
              >
                {sending ? t('chat.stop') : t('chat.sendMessage')}
              </Button>
            </div>
          </div>
        </Layout>

        {/* Rename modal */}
        <Modal
          title={t('chat.renameSession')}
          open={showRenameModal}
          onOk={handleSaveRename}
          onCancel={() => setShowRenameModal(false)}
          okButtonProps={{ disabled: !renameTitle }}
        >
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder={t('chat.sessionTitlePlaceholder')}
            autoFocus
          />
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default ChatPage
