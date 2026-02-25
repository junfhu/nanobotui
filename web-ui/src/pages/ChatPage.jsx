import React, { useEffect, useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layout, Input, Button, Typography, Avatar, Space, Spin, message, Empty, Modal, ConfigProvider, theme as antdTheme, Upload } from 'antd'
import { SendOutlined, PlusOutlined, DeleteOutlined, EditOutlined, RobotOutlined, UserOutlined, StopOutlined, PaperClipOutlined, AudioOutlined, AudioMutedOutlined } from '@ant-design/icons'
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
  const [selectedFile, setSelectedFile] = useState(null)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [sessionToRename, setSessionToRename] = useState(null)
  const messagesEndRef = useRef(null)
  
  // Voice recognition states
  const [isListening, setIsListening] = useState(false)
  const [recognition, setRecognition] = useState(null)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [audioChunks, setAudioChunks] = useState([])
  const [currentTranscript, setCurrentTranscript] = useState('')
  
  // Initialize speech recognition
  useEffect(() => {
    // Check if browser supports speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition()
      recognitionInstance.continuous = false
      recognitionInstance.interimResults = true
      recognitionInstance.lang = 'zh-CN' // Default to Chinese, can be changed
      
      recognitionInstance.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            // Append final result to input message
            setInputMessage(prev => prev + result[0].transcript);
          } else {
            // Store interim result for potential display (though we won't use it directly)
            interimTranscript += result[0].transcript;
          }
        }
        // Update current transcript for interim results
        setCurrentTranscript(interimTranscript);
      }
      
      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error', event.error)
        setIsListening(false)
        message.error(`语音识别错误: ${event.error}`)
      }
      
      recognitionInstance.onend = () => {
        // Reset the current transcript when recognition ends
        setCurrentTranscript('');
        setIsListening(false)
      }
      
      setRecognition(recognitionInstance)
    }
    
    // Cleanup on unmount
    return () => {
      if (recognition) {
        recognition.stop()
      }
    }
  }, [])
  
  // Toggle voice recognition
  const toggleVoiceRecognition = async () => {
    if (!recognition) {
      message.error('您的浏览器不支持语音识别')
      return
    }
    
    if (isListening) {
      recognition.stop()
      setIsListening(false)
    } else {
      try {
        recognition.start()
        setIsListening(true)
        message.info('开始语音识别，请说话...')
      } catch (error) {
        console.error('Error starting speech recognition:', error)
        message.error('启动语音识别失败')
      }
    }
  }
  
  // Alternative: Record audio and send to backend for transcription
  const toggleAudioRecording = async () => {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      message.error('您的浏览器不支持录音功能')
      return
    }
    
    if (isListening) {
      // Stop recording
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop()
      }
      setIsListening(false)
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        setMediaRecorder(recorder)
        setAudioChunks([])
        
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            setAudioChunks(prev => [...prev, event.data])
          }
        }
        
        recorder.onstop = async () => {
          // Combine audio chunks into a blob
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }) // Using webm which is the default for MediaRecorder
          
          try {
            // Send audio to backend for transcription
            message.info('音频录制完成，正在转录...')
            const transcriptionResult = await api.transcribeVoice(audioBlob)
            const transcriptionText = transcriptionResult.text || ''
            
            if (transcriptionText) {
              setInputMessage(prev => prev + transcriptionText)
              message.success('语音转文字成功')
            } else {
              message.warning('未能转录出文字内容')
            }
          } catch (error) {
            console.error('Transcription error:', error)
            message.error(`语音转文字失败: ${error.message}`)
          }
          
          // Clean up the stream
          stream.getTracks().forEach(track => track.stop())
        }
        
        recorder.start()
        setIsListening(true)
        message.info('开始录音，请说话...')
      } catch (error) {
        console.error('Error accessing microphone:', error)
        message.error('无法访问麦克风，请检查权限')
      }
    }
  }

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

  // Handle file selection
  const handleFileChange = (info) => {
    if (info.fileList.length > 0) {
      const file = info.fileList[info.fileList.length - 1].originFileObj
      setSelectedFile(file)
      message.info(t('chat.fileSelected', { fileName: file.name }))
    } else {
      setSelectedFile(null)
    }
  }

  // Remove selected file
  const removeSelectedFile = () => {
    setSelectedFile(null)
  }

  // Handle send message
  const handleSendMessage = async () => {
    if ((!inputMessage.trim() && !selectedFile) || !currentSession || sending) return
    
    const text = inputMessage.trim()
    setInputMessage('')
    
    try {
      // Send message with file if available
      const result = await sendMessage(currentSession.id, text, selectedFile)
      if (result?.aborted) {
        return
      }
      // Clear file after successful send
      setSelectedFile(null)
    } catch (error) {
      setInputMessage(text)
      message.error(t('chat.sendMessageFailed'))
      console.error(error)
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
            {/* File preview area */}
            {selectedFile && (
              <div className="file-preview-area">
                <div className="file-preview-item">
                  <div className="file-info">
                    <span className="file-name">{selectedFile.name}</span>
                    <span className="file-size">({(selectedFile.size / 1024).toFixed(2)}KB)</span>
                  </div>
                  <Button 
                    type="text" 
                    onClick={removeSelectedFile}
                    danger
                    size="small"
                  >
                    ×
                  </Button>
                </div>
              </div>
            )}
            
            <div className="chat-input-row">
              <Upload
                beforeUpload={(file) => {
                  handleFileChange({ fileList: [{ originFileObj: file }] });
                  return false; // Prevent automatic upload
                }}
                showUploadList={false}
                disabled={sending}
              >
                <Button
                  icon={<PaperClipOutlined />}
                  className="upload-button"
                  disabled={sending}
                >
                </Button>
              </Upload>
              
              <Button
                icon={isListening ? <AudioMutedOutlined /> : <AudioOutlined />}
                className="voice-button"
                onClick={toggleVoiceRecognition}
                disabled={!currentSession || sending}
                type={isListening ? "primary" : "default"}
                danger={isListening}
              />
              
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
                disabled={(!currentSession || (!inputMessage.trim() && !selectedFile)) && !sending}
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
