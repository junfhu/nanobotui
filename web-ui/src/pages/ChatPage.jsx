import React, { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Layout, Input, Button, Typography, Avatar, Space, Spin, message, Empty, Modal, ConfigProvider } from 'antd'
import { SendOutlined, PlusOutlined, DeleteOutlined, EditOutlined, RobotOutlined, UserOutlined, StopOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useSessionStore, useMessageStore } from '../store'
import 'highlight.js/styles/github-dark.css'
import './ChatPage.css'

const { Header, Sider, Content } = Layout
const { TextArea } = Input
const { Text } = Typography

const ChatPage = () => {
  const { t } = useTranslation()
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
    error: messagesError,
    loadMessages, 
    sendMessage, 
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

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages])

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
      try {
        await sendMessage(currentSession.id, inputMessage.trim())
        setInputMessage('')
      } catch (error) {
        message.error(t('chat.sendMessageFailed'))
        console.error(error)
      }
    }
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

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
          colorSuccess: '#52c41a',
          colorError: '#ff4d4f',
          colorText: '#ffffff',
          colorTextSecondary: '#e0e0e0',
          colorTextTertiary: '#999999',
          colorBorder: '#333333',
          colorBorderSecondary: '#444444',
          colorBgLayout: '#121212',
          colorBgElevated: '#1f1f1f',
          colorBgContainer: '#2d2d2d',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        },
        components: {
          Button: {
            borderRadius: 8,
            height: 36,
          },
          Input: {
            borderRadius: 8,
            colorBgContainer: '#2d2d2d',
            colorText: '#ffffff',
            colorBorder: '#333333',
          },
          Modal: {
            colorBgContainer: '#1f1f1f',
            colorText: '#ffffff',
            colorBorder: '#333333',
          },
          Empty: {
            colorText: '#999999',
          },
        },
      }}
    >
      <Layout className="chat-page">
        <Sider width={280} theme="dark" className="chat-sider">
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
              <Text strong style={{ fontSize: 16, color: 'white' }}>
                {currentSession?.title || t('chat.selectOrCreate')}
              </Text>
            </Space>
          </Header>

          <Content className="chat-content">
            {!currentSession ? (
              <div className="empty-chat">
                <Empty
                  image={<RobotOutlined style={{ fontSize: 64, color: '#1890ff' }} />}
                  description={t('chat.selectToStart')}
                />
              </div>
            ) : messagesLoading ? (
              <div className="loading-messages">
                <Spin size="large" />
                <div style={{ marginTop: 16, color: '#999' }}>{t('chat.loadingMessages')}</div>
              </div>
            ) : messagesError ? (
              <div className="error-messages">
                {messagesError}
              </div>
            ) : messages.length > 0 ? (
              <div className="messages-container">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`message-wrapper ${message.role}`}
                  >
                    <div className="message-bubble">
                      <div className="message-avatar-row">
                        <Avatar
                          icon={message.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                          className={`message-avatar ${message.role}`}
                        />
                        <div className="message-header">
                          <Text strong style={{ color: message.role === 'user' ? '#1890ff' : '#52c41a' }}>
                            {message.role === 'user' ? t('chat.you') : t('chat.assistantName')}
                          </Text>
                          {message.createdAt && (
                            <span className="message-time">{formatMessageTime(message.createdAt)}</span>
                          )}
                        </div>
                      </div>
                      <div className="message-content">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                          className="markdown-body"
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="message-wrapper assistant">
                    <div className="message-bubble">
                      <div className="message-avatar-row">
                        <Avatar icon={<RobotOutlined />} className="message-avatar assistant" />
                        <div className="message-header">
                          <Text strong style={{ color: '#52c41a' }}>{t('chat.assistantName')}</Text>
                        </div>
                      </div>
                      <div className="message-content">
                        <div className="loading-text">
                          <div className="loading-status">
                            <Spin size="small" />
                            <span>{t('chat.thinking')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="empty-chat">
                <Empty
                  image={<RobotOutlined style={{ fontSize: 64, color: '#1890ff' }} />}
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
                onClick={handleSendMessage}
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
