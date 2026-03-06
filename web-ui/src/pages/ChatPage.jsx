import React, { useEffect, useLayoutEffect, useState, useRef, useMemo } from 'react'
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
const AUTO_SCROLL_THRESHOLD = 96
const VIRTUAL_OVERSCAN_PX = 800
const DEFAULT_VIEWPORT_HEIGHT = 800
const MESSAGE_VERTICAL_GAP = 16
const DEFAULT_MESSAGE_HEIGHT = 140

const estimateMessageHeight = (msg) => {
  const content = msg?.content || ''
  const lineCount = content.split('\n').length
  const contentWeight = Math.ceil(content.length / 48) * 18
  const codeBlockWeight = (content.match(/```/g) || []).length * 48
  const fileWeight = Array.isArray(msg?.files) ? msg.files.length * 28 : 0
  const roleBase = msg?.role === 'user' ? 92 : 108
  return Math.max(DEFAULT_MESSAGE_HEIGHT, roleBase + lineCount * 10 + contentWeight + codeBlockWeight + fileWeight)
}

const findFirstVisibleIndex = (offsets, target) => {
  let low = 0
  let high = offsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (offsets[mid] < target) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return low
}

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
  const messagesViewportRef = useRef(null)
  const messagesListRef = useRef(null)
  const initialScrollPendingRef = useRef(true)
  const activeSessionIdRef = useRef(null)
  const lastRenderedMessageCountRef = useRef(0)
  const shouldAutoScrollRef = useRef(true)
  const measuredHeightsRef = useRef(new Map())
  const [heightVersion, setHeightVersion] = useState(0)
  const [viewportState, setViewportState] = useState({
    scrollTop: 0,
    viewportHeight: 0
  })
  
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

  useEffect(() => {
    const nextSessionId = currentSession?.id ?? null
    if (activeSessionIdRef.current === nextSessionId) {
      return
    }
    activeSessionIdRef.current = nextSessionId
    initialScrollPendingRef.current = true
    lastRenderedMessageCountRef.current = 0
    shouldAutoScrollRef.current = true
    measuredHeightsRef.current = new Map()
    setHeightVersion((prev) => prev + 1)
    setViewportState({
      scrollTop: 0,
      viewportHeight: 0
    })
  }, [currentSession?.id])

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

  const measuredHeights = useMemo(
    () => messages.map((msg) => measuredHeightsRef.current.get(msg.id) ?? estimateMessageHeight(msg)),
    [messages, heightVersion]
  )

  const virtualMetrics = useMemo(() => {
    const offsets = []
    let totalHeight = 0

    for (let i = 0; i < measuredHeights.length; i += 1) {
      offsets.push(totalHeight)
      totalHeight += measuredHeights[i] + MESSAGE_VERTICAL_GAP
    }

    return { offsets, totalHeight }
  }, [measuredHeights])

  const getVirtualRange = (scrollTop, viewportHeight) => {
    if (messages.length === 0) {
      return { start: 0, end: 0 }
    }

    const safeViewportHeight = Math.max(viewportHeight || DEFAULT_VIEWPORT_HEIGHT, 1)
    const from = Math.max(0, scrollTop - VIRTUAL_OVERSCAN_PX)
    const to = scrollTop + safeViewportHeight + VIRTUAL_OVERSCAN_PX
    const start = Math.min(
      messages.length,
      findFirstVisibleIndex(virtualMetrics.offsets, from)
    )
    let end = Math.min(
      messages.length,
      findFirstVisibleIndex(virtualMetrics.offsets, to)
    )

    if (end < messages.length) {
      end += 1
    }

    if (end <= start) {
      end = Math.min(messages.length, start + 1)
    }

    return { start, end }
  }

  const effectiveViewportHeight = (
    viewportState.viewportHeight ||
    messagesViewportRef.current?.clientHeight ||
    DEFAULT_VIEWPORT_HEIGHT
  )
  const maxScrollTop = Math.max(0, virtualMetrics.totalHeight - effectiveViewportHeight)
  const effectiveScrollTop = initialScrollPendingRef.current
    ? maxScrollTop
    : Math.min(viewportState.scrollTop, maxScrollTop)
  const virtualRange = getVirtualRange(effectiveScrollTop, effectiveViewportHeight)
  const visibleMessages = useMemo(
    () => messages.slice(virtualRange.start, virtualRange.end),
    [messages, virtualRange.end, virtualRange.start]
  )
  const topSpacerHeight = virtualMetrics.offsets[virtualRange.start] || 0
  const bottomSpacerHeight = Math.max(
    0,
    virtualMetrics.totalHeight - (
      virtualMetrics.offsets[virtualRange.end] || virtualMetrics.totalHeight
    )
  )

  const syncViewportState = () => {
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }

    setViewportState((prev) => {
      const next = {
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.clientHeight
      }
      if (
        prev.scrollTop === next.scrollTop &&
        prev.viewportHeight === next.viewportHeight
      ) {
        return prev
      }
      return next
    })
  }

  const measureRenderedMessages = () => {
    const listNode = messagesListRef.current
    if (!listNode) {
      return false
    }

    let changed = false
    const nextHeights = new Map(measuredHeightsRef.current)
    const messageNodes = listNode.querySelectorAll('[data-message-id]')

    messageNodes.forEach((node) => {
      const messageId = node.getAttribute('data-message-id')
      if (!messageId) {
        return
      }

      const measuredHeight = Math.ceil(node.getBoundingClientRect().height)
      const cachedHeight = nextHeights.get(messageId)
      if (cachedHeight !== measuredHeight) {
        nextHeights.set(messageId, measuredHeight)
        changed = true
      }
    })

    if (changed) {
      measuredHeightsRef.current = nextHeights
      setHeightVersion((prev) => prev + 1)
    }

    return changed
  }

  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport || messagesLoading) {
      return
    }

    measureRenderedMessages()

    if (messages.length === 0) {
      lastRenderedMessageCountRef.current = 0
      syncViewportState()
      return
    }

    if (initialScrollPendingRef.current) {
      viewport.scrollTop = viewport.scrollHeight
      initialScrollPendingRef.current = false
      shouldAutoScrollRef.current = true
      lastRenderedMessageCountRef.current = messages.length
      syncViewportState()
      return
    }

    if (messages.length > lastRenderedMessageCountRef.current && shouldAutoScrollRef.current) {
      scrollToBottom(sending ? 'smooth' : 'auto')
    }

    lastRenderedMessageCountRef.current = messages.length
    syncViewportState()
  }, [messages.length, messagesLoading, sending, heightVersion, virtualRange.end, virtualRange.start])

  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }

    syncViewportState()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncViewportState)
      return () => window.removeEventListener('resize', syncViewportState)
    }

    const observer = new ResizeObserver(() => {
      measureRenderedMessages()
      syncViewportState()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const scrollToBottom = (behavior = 'smooth') => {
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
  }

  const handleMessagesScroll = () => {
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD
    syncViewportState()
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
    <div className="messages-container" ref={messagesListRef}>
      {topSpacerHeight > 0 && (
        <div
          className="messages-spacer"
          style={{ height: `${topSpacerHeight}px` }}
          aria-hidden="true"
        />
      )}
      {visibleMessages.map((msg) => (
        <div
          key={msg.id}
          data-message-id={msg.id}
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
      {bottomSpacerHeight > 0 && (
        <div
          className="messages-spacer"
          style={{ height: `${bottomSpacerHeight}px` }}
          aria-hidden="true"
        />
      )}
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
    </div>
  ), [bottomSpacerHeight, progress, sending, t, topSpacerHeight, visibleMessages])

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

          <Content
            className="chat-content"
            ref={messagesViewportRef}
            onScroll={handleMessagesScroll}
          >
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
