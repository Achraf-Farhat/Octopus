import { useEffect, useMemo, useState, useRef } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'
import { getAccessToken } from '../lib/auth'
import {
  MessageSquare,
  Plus,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  RefreshCw,
  Search,
  Sparkles,
  User,
  Shield,
  Clock,
  Trash2
} from 'lucide-react'

const SESSION_STORAGE_KEY = 'octopus_threat_hunt_session_id'

function getStoredSessionId() {
  return localStorage.getItem(SESSION_STORAGE_KEY) || ''
}

function CodeBlock({ rawCode }) {
  const [copied, setCopied] = useState(false)

  // Extract language and code body
  const match = rawCode.match(/^```(\w*)\n([\s\S]*?)```$/)
  const lang = match ? match[1] : 'code'
  const code = match ? match[2].trim() : rawCode.replace(/```/g, '').trim()

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-3 border border-slate-800 rounded-lg overflow-hidden bg-slate-950 shadow-lg max-w-full">
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-900 border-b border-slate-800 text-[10px] font-mono text-slate-400 select-none">
        <span>{lang.toUpperCase()}</span>
        <button
          onClick={handleCopy}
          className="px-2 py-0.5 rounded border border-slate-700 bg-slate-850 hover:bg-slate-800 text-slate-350 hover:text-white transition active:scale-95 text-[9px] font-sans font-semibold cursor-pointer"
        >
          {copied ? 'Copied!' : 'Copy Code'}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[11px] font-mono text-blue-100 bg-slate-950/80 leading-relaxed custom-scrollbar">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function parseInlineElements(text) {
  const regex = /(\*\*.*?\*\*|`.*?`)/g
  const tokens = text.split(regex)
  return tokens.map((token, idx) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={idx} className="font-bold text-slate-100">{token.slice(2, -2)}</strong>
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={idx} className="bg-slate-900 border border-slate-800/80 px-1.5 py-0.5 rounded font-mono text-[10px] text-blue-300 mx-0.5 font-semibold">{token.slice(1, -1)}</code>
    }
    return token
  })
}

function renderPlainTextBlock(blockText) {
  const lines = blockText.split('\n')
  const renderedLines = []
  let currentList = []

  const flushList = () => {
    if (currentList.length > 0) {
      renderedLines.push(
        <ul key={`list-${renderedLines.length}`} className="list-disc pl-5 my-2 space-y-1">
          {currentList}
        </ul>
      )
      currentList = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Headers
    if (trimmedLine.startsWith('#')) {
      flushList()
      const match = trimmedLine.match(/^(#{1,6})\s+(.*)$/)
      if (match) {
        const level = match[1].length
        const title = match[2]
        const headerClasses = 
          level === 1 ? 'text-lg font-bold text-slate-100 mt-4 mb-2 border-b border-slate-800/60 pb-1' :
          level === 2 ? 'text-base font-semibold text-slate-200 mt-3.5 mb-2' :
          'text-xs font-bold text-slate-350 mt-2.5 mb-1.5 uppercase tracking-wider'
        renderedLines.push(
          <div key={`h-${i}`} className={headerClasses}>
            {parseInlineElements(title)}
          </div>
        )
        continue
      }
    }

    // Lists (unordered)
    if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      const itemText = trimmedLine.slice(2)
      currentList.push(
        <li key={`li-${i}`} className="text-slate-300 leading-relaxed text-xs">
          {parseInlineElements(itemText)}
        </li>
      )
      continue
    }

    // Lists (ordered)
    const orderedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/)
    if (orderedMatch) {
      flushList()
      renderedLines.push(
        <div key={`ol-${i}`} className="flex gap-2 pl-1.5 my-1.5 text-slate-300 text-xs">
          <span className="font-mono text-blue-400 font-semibold select-none">{orderedMatch[1]}.</span>
          <span className="flex-1 leading-relaxed">{parseInlineElements(orderedMatch[2])}</span>
        </div>
      )
      continue
    }

    // Blank lines
    if (trimmedLine === '') {
      flushList()
      renderedLines.push(<div key={`br-${i}`} className="h-2" />)
      continue
    }

    // Normal Paragraph
    flushList()
    renderedLines.push(
      <p key={`p-${i}`} className="my-2 text-slate-300 leading-relaxed text-xs">
        {parseInlineElements(line)}
      </p>
    )
  }

  flushList()
  return renderedLines
}

function renderMessageContent(content) {
  if (!content) return null

  // Split by code blocks
  const parts = content.split(/(```[\s\S]*?```)/g)

  return parts.map((part, index) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      return <CodeBlock key={index} rawCode={part} />
    } else {
      return <div key={index}>{renderPlainTextBlock(part)}</div>
    }
  })
}

export default function ThreatHunt() {
  const [sessionId, setSessionId] = useState(getStoredSessionId())
  const [sessions, setSessions] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  
  // Voice transcription states
  const [isRecording, setIsRecording] = useState(false)
  
  // Text-to-Speech states
  const [speakingMsgId, setSpeakingMsgId] = useState(null)
  
  // Sidebar states
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const recognitionRef = useRef(null)

  // Clean up speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  // Load all sessions
  async function loadSessions() {
    setLoadingSessions(true)
    try {
      const response = await api.get('/threat-hunt/sessions')
      setSessions(response.data ?? [])
    } catch (err) {
      // Don't block UI if session list fails
    } finally {
      setLoadingSessions(false)
    }
  }

  // Load messages for a session
  async function loadMessages(activeSessionId) {
    if (!activeSessionId) {
      setMessages([])
      return
    }

    setLoadingMessages(true)
    setError('')
    try {
      const response = await api.get('/threat-hunt/messages', { 
        params: { session_id: activeSessionId, limit: 100 } 
      })
      setMessages(response.data ?? [])
    } catch {
      setError('Could not load threat hunt history.')
    } finally {
      setLoadingMessages(false)
    }
  }

  // Speech recognition is now instantiated dynamically inside toggleRecording to prevent bugs

  // Speech synthesis toggle
  const togglePlaySpeech = (message) => {
    if ('speechSynthesis' in window) {
      if (speakingMsgId === message.id) {
        window.speechSynthesis.cancel()
        setSpeakingMsgId(null)
      } else {
        window.speechSynthesis.cancel()
        
        // Clean markdown syntax or tags before speaking to keep it natural
        const cleanText = message.content
          .replace(/[#*`_-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          
        const utterance = new SpeechSynthesisUtterance(cleanText)
        utterance.onend = () => setSpeakingMsgId(null)
        utterance.onerror = () => setSpeakingMsgId(null)
        
        setSpeakingMsgId(message.id)
        window.speechSynthesis.speak(utterance)
      }
    }
  }

  // Stop speech when changing session or leaving
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [sessionId])

  // Scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, busy])

  // Initial load
  useEffect(() => {
    loadSessions()
    loadMessages(sessionId)
  }, [])

  // Auto-resize input text area
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
    }
  }, [input])

  // Start/Stop recording voice dictation dynamically
  const toggleRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech Recognition is not supported on Firefox by default. To enable it, type "about:config" in the URL bar, search for "media.webspeech.recognition.enable" and set it to true.')
      return
    }

    if (isRecording) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch (err) {
          console.error('Failed to stop speech recognition:', err)
        }
      }
      setIsRecording(false)
    } else {
      const rec = new SpeechRecognition()
      rec.continuous = false
      rec.interimResults = false
      rec.lang = 'en-US'

      rec.onstart = () => {
        setIsRecording(true)
      }

      rec.onresult = (event) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript
          }
        }
        if (transcript) {
          setInput(prev => {
            const trimmed = prev.trim()
            return trimmed ? `${trimmed} ${transcript.trim()}` : transcript.trim()
          })
        }
      }

      rec.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setIsRecording(false)
      }

      rec.onend = () => {
        setIsRecording(false)
        recognitionRef.current = null
      }

      recognitionRef.current = rec
      try {
        setIsRecording(true)
        rec.start()
      } catch (err) {
        console.error('Failed to start speech recognition:', err)
        setIsRecording(false)
        recognitionRef.current = null
      }
    }
  }

  // Send message
  async function handleSend(e) {
    if (e) e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || busy) return

    setBusy(true)
    setError('')
    setInput('')
    
    // Stop voice if recording
    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop()
    }

    const userMsgId = Date.now()
    const tempUserMsg = {
      id: userMsgId,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString()
    }

    const assistantMsgId = userMsgId + 1
    const tempAssistantMsg = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString()
    }

    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg])

    try {
      const token = getAccessToken()
      const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api'
      
      const response = await fetch(`${baseURL}/threat-hunt/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          message: trimmed,
          session_id: sessionId || undefined
        })
      })

      if (!response.ok) {
        throw new Error('Streaming request failed')
      }

      const nextSessionId = response.headers.get('X-Session-ID')
      if (nextSessionId && nextSessionId !== sessionId) {
        localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId)
        setSessionId(nextSessionId)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let streamContent = ''

      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        if (value) {
          const chunk = decoder.decode(value, { stream: !done })
          streamContent += chunk
          setMessages(prev => prev.map(m => {
            if (m.id === assistantMsgId) {
              return { ...m, content: streamContent }
            }
            return m
          }))
        }
      }

      // Reload sessions to update title/timestamps
      await loadSessions()

    } catch (err) {
      console.error(err)
      setError('Threat Hunt AI is unavailable or request failed.')
      // Rollback optimistic messages
      setMessages(prev => prev.filter(m => m.id !== assistantMsgId && m.id !== tempUserMsg.id))
    } finally {
      setBusy(false)
    }
  }

  // Keyboard events inside textarea
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function startNewSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setSessionId('')
    setMessages([])
    setInput('')
    setError('')
  }

  async function handleSelectSession(sId) {
    localStorage.setItem(SESSION_STORAGE_KEY, sId)
    setSessionId(sId)
    await loadMessages(sId)
  }

  async function handleDeleteSession(e, sId) {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this threat hunt session?')) return
    try {
      await api.delete(`/threat-hunt/sessions/${sId}`)
      await loadSessions()
      if (sessionId === sId) {
        startNewSession()
      }
    } catch (err) {
      setError('Failed to delete threat hunt session.')
    }
  }

  const orderedMessages = useMemo(() => {
    return [...messages].sort((a, b) => a.id - b.id)
  }, [messages])

  // Suggested Hunt queries for landing state
  const suggestions = [
    { title: 'Detect Lateral Movement', desc: 'Find suspicious ssh/rdp authentication failures or pivots.' },
    { title: 'Suspicious PowerShell', desc: 'Identify powershell commands downloading or executing remote code.' },
    { title: 'Account Modification', desc: 'List any administrative or user privilege escalations.' }
  ]

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-140px)] w-full overflow-hidden border border-slate-800/60 rounded-xl bg-slate-950/60 backdrop-blur-md text-slate-100 font-sans shadow-2xl relative">
        <style>{`
          .chat-history-sidebar button {
            background-image: none !important;
            box-shadow: none !important;
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 5px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #1e293b;
            border-radius: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #334155;
          }
        `}</style>

        {/* Sidebar: Chat History */}
        <aside className="w-80 border-r border-slate-800/80 bg-slate-950/95 flex flex-col flex-shrink-0 h-full overflow-hidden chat-history-sidebar">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-xs tracking-wider uppercase text-slate-300">Hunt History</span>
            </div>
            <button
              onClick={startNewSession}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-900 border border-blue-700 text-blue-100 hover:bg-blue-800 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              New Session
            </button>
          </div>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 custom-scrollbar">
            {loadingSessions && sessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                Loading sessions...
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-650 flex flex-col items-center gap-1">
                <Clock className="w-5 h-5 opacity-40" />
                <span>No threat hunt sessions yet</span>
              </div>
            ) : (
              sessions.map(s => {
                const isActive = s.session_id === sessionId
                return (
                  <div
                    key={s.session_id}
                    onClick={() => handleSelectSession(s.session_id)}
                    className={`group p-3 rounded-lg text-xs cursor-pointer flex items-center justify-between border transition ${
                      isActive 
                        ? 'bg-slate-900 border-slate-800 text-blue-400' 
                        : 'hover:bg-slate-900/40 border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="font-medium truncate">{s.title || 'Untitled Session'}</span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(s.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(e, s.session_id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all duration-200 flex-shrink-0 ml-2 bg-transparent border-none"
                      title="Delete session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* Main Panel: Conversation */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950/20 relative">
          
          {/* Header */}
          <div className="p-4 border-b border-slate-800/80 bg-slate-950/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-400" />
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">Threat Hunt Copilot</h2>
                <p className="text-[10px] text-slate-500 font-mono">Session ID: {sessionId || 'New'}</p>
              </div>
            </div>
          </div>

          {/* Conversation list / Landing state */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
            {loadingMessages ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span>Loading chat registry...</span>
              </div>
            ) : orderedMessages.length === 0 ? (
              // Landing screen suggestions
              <div className="h-full flex flex-col justify-center items-center max-w-xl mx-auto text-center gap-6">
                <div className="bg-blue-950/30 border border-blue-800/40 p-3.5 rounded-2xl">
                  <Sparkles className="w-10 h-10 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-200">Threat Hunting Chat</h3>
                  <p className="text-xs text-slate-500 mt-2 max-w-sm">
                    Enter any query to search wazuh logs, analyze alert patterns, and correlate potential indicators of compromise.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full mt-4">
                  {suggestions.map((s, idx) => (
                    <div
                      key={idx}
                      onClick={() => setInput(s.desc)}
                      className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-xl text-left cursor-pointer hover:bg-slate-900 hover:border-blue-500/50 transition flex flex-col gap-1 text-xs"
                    >
                      <span className="font-semibold text-slate-200">{s.title}</span>
                      <span className="text-[10px] text-slate-500 leading-relaxed">{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // Message list
              orderedMessages.map(msg => {
                const isUser = msg.role === 'user'
                const isSpeaking = speakingMsgId === msg.id
                return (
                  <div key={msg.id} className={`flex gap-3 max-w-[85%] ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center border flex-shrink-0 text-xs ${
                      isUser 
                        ? 'bg-blue-950 border-blue-800/80 text-blue-300' 
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}>
                      {isUser ? <User className="w-4 h-4" /> : <Shield className="w-4 h-4 text-blue-400" />}
                    </div>

                    {/* Chat Bubble */}
                    <div className="flex flex-col gap-1.5 max-w-full">
                      <div className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                        isUser 
                          ? 'bg-blue-600/90 text-white rounded-tr-none border border-blue-500/30 whitespace-pre-wrap' 
                          : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-slate-850 w-full overflow-hidden'
                      }`}>
                        {isUser ? msg.content : renderMessageContent(msg.content)}
                      </div>
                      
                      {/* Audio Playback Controls for AI replies */}
                      {!isUser && (
                        <div className="flex items-center gap-2 pl-1">
                          <button
                            onClick={() => togglePlaySpeech(msg)}
                            className={`p-1 rounded-md border text-[10px] font-semibold flex items-center gap-1 transition-all ${
                              isSpeaking 
                                ? 'bg-blue-950/80 border-blue-500 text-blue-300' 
                                : 'bg-slate-900/40 border-slate-850 text-slate-500 hover:text-slate-300 hover:bg-slate-900'
                            }`}
                            title={isSpeaking ? "Stop Speaking" : "Read Aloud (TTS)"}
                          >
                            {isSpeaking ? (
                              <>
                                <VolumeX className="w-3 h-3 text-blue-400" />
                                <span>Stop</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3 h-3" />
                                <span>Listen</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            
            {/* Typing Loader Indicator */}
            {busy && (messages.length === 0 || messages[messages.length - 1]?.content === '') && (
              <div className="flex gap-3 max-w-[85%] mr-auto items-center">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center border bg-slate-900 border-slate-800 text-slate-400 flex-shrink-0">
                  <Shield className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex gap-1.5 p-3.5 rounded-2xl rounded-tl-none bg-slate-900/90 border border-slate-850 items-center">
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Floating Footer Input Container */}
          <div className="p-4 border-t border-slate-800/80 bg-slate-950/90">
            <form onSubmit={handleSend} className="relative flex items-end gap-2 max-w-3xl mx-auto border border-slate-800 rounded-xl bg-slate-900/60 p-1.5 pr-2 focus-within:border-blue-500/50 transition">
              
              {/* Textarea multiline input */}
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder={isRecording ? "Listening to voice..." : "Ask investigative query... (Enter to send, Shift+Enter for newline)"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isRecording}
                className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none border-none py-2 px-3 resize-none max-h-40 min-h-[36px]"
              />

              {/* Dictation Voice Record Button */}
              <button
                type="button"
                onClick={toggleRecording}
                className={`p-2 rounded-lg border flex items-center justify-center transition flex-shrink-0 active:scale-95 ${
                  isRecording 
                    ? 'bg-red-950 border-red-700 text-red-400 animate-pulse' 
                    : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title={isRecording ? "Stop voice recording" : "Dictate query"}
              >
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              {/* Send Button */}
              <button
                type="submit"
                disabled={!input.trim() || busy}
                className="p-2 rounded-lg bg-blue-600 border border-blue-500 text-white flex items-center justify-center disabled:opacity-30 disabled:bg-transparent disabled:border-slate-850 disabled:text-slate-600 transition flex-shrink-0 active:scale-95"
                title="Send query"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
            
            {/* Footer Sub-row */}
            <div className="max-w-3xl mx-auto flex items-center justify-between text-[9px] text-slate-600 font-mono mt-2 px-1">
              <span>{isRecording && <span className="text-red-500 animate-pulse">● Recording Voice Dictation</span>}</span>
              <span>History length: {orderedMessages.length} messages</span>
            </div>
          </div>

          {error ? <div className="absolute top-16 left-4 right-4 error-banner z-30">{error}</div> : null}
        </div>
      </div>
    </AppLayout>
  )
}
