import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'

const SESSION_STORAGE_KEY = 'octopus_threat_hunt_session_id'

function getStoredSessionId() {
  return localStorage.getItem(SESSION_STORAGE_KEY) || ''
}

export default function ThreatHunt() {
  const [sessionId, setSessionId] = useState(getStoredSessionId())
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadMessages(activeSessionId) {
    if (!activeSessionId) {
      setMessages([])
      return
    }

    try {
      const response = await api.get('/threat-hunt/messages', { params: { session_id: activeSessionId, limit: 100 } })
      setMessages(response.data ?? [])
    } catch {
      setError('Could not load threat hunt history.')
    }
  }

  useEffect(() => {
    loadMessages(sessionId)
  }, [sessionId])

  async function sendMessage(event) {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return

    setBusy(true)
    setError('')
    try {
      const response = await api.post('/threat-hunt/messages', { message: trimmed, session_id: sessionId || undefined })
      const nextSessionId = response.data?.session_id
      if (nextSessionId && nextSessionId !== sessionId) {
        localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId)
        setSessionId(nextSessionId)
      }
      setInput('')
      await loadMessages(nextSessionId || sessionId)
    } catch {
      setError('Threat Hunt AI is unavailable or request failed.')
    } finally {
      setBusy(false)
    }
  }

  function startNewSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setSessionId('')
    setMessages([])
    setInput('')
    setError('')
  }

  const orderedMessages = useMemo(() => [...messages].sort((a, b) => a.id - b.id), [messages])

  return (
    <AppLayout>
      <section className="panel page-header">
        <div className="panel-header">
          <div>
            <h1>Threat Hunt Chat</h1>
            <p className="muted">Ask investigative questions and keep a persistent session history.</p>
          </div>
          <button type="button" onClick={startNewSession} className="secondary-button">
            New session
          </button>
        </div>
      </section>

      <section className="panel threat-chat-wrap">
        <div className="threat-chat-log">
          {orderedMessages.map((message) => (
            <div key={message.id} className={`chat-bubble ${message.role === 'assistant' ? 'assistant' : 'user'}`}>
              <div className="chat-role">{message.role}</div>
              <div>{message.content}</div>
            </div>
          ))}
          {!orderedMessages.length ? <p className="muted">No messages yet. Start by asking a hunt question.</p> : null}
        </div>

        <form className="threat-chat-form" onSubmit={sendMessage}>
          <textarea
            rows={4}
            placeholder="Example: Show me likely lateral movement indicators for the latest brute-force alerts"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="panel-header">
            <span className="muted small">Session: {sessionId || 'new'}</span>
            <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </form>

        {error ? <div className="error-banner">{error}</div> : null}
      </section>
    </AppLayout>
  )
}
