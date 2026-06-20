import { useEffect, useState, useMemo } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'
import {
  Briefcase,
  AlertCircle,
  Clock,
  User,
  Shield,
  Activity,
  CheckCircle,
  XCircle,
  Eye,
  RefreshCw,
  Plus,
  Check
} from 'lucide-react'

// Simple Markdown component to display the AI Investigation report cleanly
function MarkdownRenderer({ text }) {
  if (!text) return <p className="text-slate-500 italic">No AI Investigation report available for this case.</p>

  const lines = text.split('\n')
  return (
    <div className="space-y-3 font-sans text-slate-350">
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="text-sm font-bold text-slate-100 mt-4 mb-2 border-b border-slate-800/80 pb-1">
              {trimmed.slice(4)}
            </h4>
          )
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={idx} className="text-base font-bold text-blue-400 mt-5 mb-2">
              {trimmed.slice(3)}
            </h3>
          )
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <li key={idx} className="ml-5 list-disc text-xs leading-relaxed text-slate-300">
              {trimmed.slice(2)}
            </li>
          )
        }
        if (trimmed === '') {
          return <div key={idx} className="h-1.5" />
        }
        return (
          <p key={idx} className="text-xs leading-relaxed text-slate-300">
            {trimmed}
          </p>
        )
      })}
    </div>
  )
}

export default function Cases() {
  const [cases, setCases] = useState([])
  const [users, setUsers] = useState([])
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  
  // Custom case creation form states
  const [newTitle, setNewTitle] = useState('')
  const [newSeverity, setNewSeverity] = useState('medium')
  const [isFormOpen, setIsFormOpen] = useState(false)
  
  // Bulk selection tracking
  const [bulkSelectedIds, setBulkSelectedIds] = useState([])
  
  // Execution trace polling
  const [executionDetails, setExecutionDetails] = useState(null)
  const [loadingExecution, setLoadingExecution] = useState(false)
  
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  // Fetch Cases and Users
  async function loadData() {
    try {
      const [caseResp, userResp] = await Promise.all([
        api.get('/cases'),
        api.get('/users')
      ])
      const fetchedCases = caseResp.data ?? []
      setCases(fetchedCases)
      setUsers(userResp.data ?? [])
      
      // Auto-select first case if none is selected
      if (fetchedCases.length > 0 && !selectedCaseId) {
        setSelectedCaseId(fetchedCases[0].id)
      }
    } catch {
      setError('Could not load case data. Confirm permissions.')
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Selected Case Object
  const selectedCase = useMemo(() => {
    return cases.find(c => c.id === selectedCaseId) || null
  }, [cases, selectedCaseId])

  // Unified AI Investigation Report selector (falls back to active playbook execution context if not in DB yet)
  const aiReport = useMemo(() => {
    return selectedCase?.ai_investigation || executionDetails?.execution_log?.context?.ai_investigation || '';
  }, [selectedCase, executionDetails])

  // Unified Alert Info selector
  const alertInfo = useMemo(() => {
    if (selectedCase?.alert_details) {
      const details = selectedCase.alert_details;
      const agentName = details.agent?.name || details.hostname || 'unknown-host';
      const ruleId = details.rule?.id || details.rule_id || '0';
      const severity = details.rule?.level || selectedCase.severity || 0;
      const wazuhId = details.id || details.wazuh_alert_id || (selectedCase.related_alerts?.length ? selectedCase.related_alerts[0] : 'unknown');
      const srcIp = details.data?.srcip || details.srcip || '0.0.0.0';
      const dstIp = details.data?.dstip || details.dstip || '0.0.0.0';
      const timestamp = details['@timestamp'] || details.timestamp || selectedCase.created_at;

      return {
        rule_id: ruleId,
        severity: severity,
        wazuh_alert_id: wazuhId,
        hostname: agentName,
        src_ip: srcIp,
        dst_ip: dstIp,
        timestamp: timestamp
      };
    }
    
    if (executionDetails?.execution_log?.context?.alert) {
      const alert = executionDetails.execution_log.context.alert;
      return {
        rule_id: alert.rule_id,
        severity: alert.severity,
        wazuh_alert_id: alert.wazuh_alert_id,
        hostname: alert.hostname,
        src_ip: alert.src_ip,
        dst_ip: alert.dst_ip,
        timestamp: selectedCase?.created_at
      };
    }

    return null;
  }, [selectedCase, executionDetails]);

  // Poll Playbook Execution Logs if case is linked
  useEffect(() => {
    let interval = null
    
    async function fetchExecution() {
      if (!selectedCase || !selectedCase.playbook_execution_id) {
        setExecutionDetails(null)
        return
      }
      const rawId = String(selectedCase.playbook_execution_id)
      if (!/^\d+$/.test(rawId)) {
        setExecutionDetails(null)
        return
      }
      const safeId = parseInt(rawId, 10)
      try {
        const resp = await api.get(`/playbooks/executions/${safeId}`)
        setExecutionDetails(resp.data)
        
        // Refresh case data from the database once execution finishes or the AI report becomes available
        const hasFinished = resp.data.status === 'completed' || resp.data.status === 'failed';
        const gotAiReport = resp.data.execution_log?.context?.ai_investigation;
        const needsLocalUpdate = gotAiReport && !selectedCase.ai_investigation;
        
        if (hasFinished || needsLocalUpdate) {
          const caseResp = await api.get('/cases')
          const fetchedCases = caseResp.data ?? []
          setCases(fetchedCases)
        }
      } catch (err) {
        console.error('Failed to fetch linked playbook execution status:', err)
      }
    }

    if (selectedCase && selectedCase.playbook_execution_id) {
      fetchExecution()
      interval = setInterval(fetchExecution, 2500)
    } else {
      setExecutionDetails(null)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [selectedCase])

  // Handle Status Update
  async function handleUpdateStatus(caseId, status) {
    const rawId = String(caseId)
    if (!/^\d+$/.test(rawId)) return
    const safeCaseId = parseInt(rawId, 10)
    try {
      const resp = await api.patch(`/cases/${safeCaseId}`, { status })
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, status: resp.data.status } : c))
      setSuccess('Case status updated successfully.')
      setTimeout(() => setSuccess(''), 2500)
    } catch {
      setError('Failed to update case status.')
      setTimeout(() => setError(''), 3000)
    }
  }

  // Handle Assign User
  async function handleAssignUser(caseId, userIdVal) {
    const rawId = String(caseId)
    if (!/^\d+$/.test(rawId)) return
    const safeCaseId = parseInt(rawId, 10)
    const assigned_to = userIdVal === 'unassigned' ? 0 : parseInt(userIdVal)
    try {
      const resp = await api.patch(`/cases/${safeCaseId}`, { assigned_to })
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, assigned_to: resp.data.assigned_to } : c))
      setSuccess('Case assignment updated successfully.')
      setTimeout(() => setSuccess(''), 2500)
    } catch {
      setError('Failed to assign user to case.')
      setTimeout(() => setError(''), 3000)
    }
  }

  // Handle Action Gate approvals (Approve/Reject)
  async function handleApproveGate(executionId, approved) {
    const rawId = String(executionId)
    if (!/^\d+$/.test(rawId)) return
    const safeExecutionId = parseInt(rawId, 10)
    try {
      await api.post(`/playbooks/executions/${safeExecutionId}/approve`, { approved })
      setSuccess(approved ? 'Action approved successfully!' : 'Action rejected successfully.')
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('Failed to submit approval response.')
      setTimeout(() => setError(''), 3000)
    }
  }

  // Create Custom Case Manually
  async function handleCreateCase(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setBusy(true)
    setError('')
    try {
      const resp = await api.post('/cases', {
        title: newTitle.trim(),
        severity: newSeverity,
        related_alerts: []
      })
      setNewTitle('')
      setNewSeverity('medium')
      setIsFormOpen(false)
      setCases(prev => [resp.data, ...prev])
      setSelectedCaseId(resp.data.id)
      setSuccess('Custom case created.')
      setTimeout(() => setSuccess(''), 2500)
    } catch {
      setError('Failed to create manual case. Requires L2 roles.')
      setTimeout(() => setError(''), 3000)
    } finally {
      setBusy(false)
    }
  }

  const toggleSelectCase = (e, caseId) => {
    e.stopPropagation()
    setBulkSelectedIds(prev => 
      prev.includes(caseId) 
        ? prev.filter(id => id !== caseId) 
        : [...prev, caseId]
    )
  }

  const handleBulkClose = async () => {
    if (!bulkSelectedIds.length) return
    try {
      await api.post('/cases/bulk-close', { case_ids: bulkSelectedIds })
      setSuccess(`Successfully closed ${bulkSelectedIds.length} cases.`)
      setBulkSelectedIds([])
      loadData()
      setTimeout(() => setSuccess(''), 2500)
    } catch {
      setError('Failed to bulk close cases.')
      setTimeout(() => setError(''), 3000)
    }
  }

  const handleBulkDelete = async () => {
    if (!bulkSelectedIds.length) return
    if (!window.confirm(`Are you sure you want to permanently delete these ${bulkSelectedIds.length} selected cases?`)) return
    try {
      await api.post('/cases/bulk-delete', { case_ids: bulkSelectedIds })
      setSuccess('Selected cases deleted.')
      const firstRemaining = cases.find(c => !bulkSelectedIds.includes(c.id))
      setSelectedCaseId(firstRemaining ? firstRemaining.id : null)
      setBulkSelectedIds([])
      loadData()
      setTimeout(() => setSuccess(''), 2500)
    } catch {
      setError('Failed to bulk delete cases.')
      setTimeout(() => setError(''), 3000)
    }
  }

  const handleDeleteSingleCase = async (id) => {
    if (!window.confirm('Are you sure you want to permanently delete this case?')) return
    const rawId = String(id)
    if (!/^\d+$/.test(rawId)) return
    const safeId = parseInt(rawId, 10)
    try {
      await api.delete(`/cases/${safeId}`)
      setSuccess('Case deleted successfully.')
      const remaining = cases.filter(c => c.id !== id)
      setSelectedCaseId(remaining.length > 0 ? remaining[0].id : null)
      loadData()
      setTimeout(() => setSuccess(''), 2500)
    } catch {
      setError('Failed to delete case.')
      setTimeout(() => setError(''), 3000)
    }
  }

  // Severity Label styles helper
  function getSeverityColor(sev) {
    const s = String(sev).toLowerCase()
    if (s === 'critical' || s >= '12') return 'bg-red-950/50 text-red-400 border-red-900/60'
    if (s === 'high' || s >= '8') return 'bg-orange-950/50 text-orange-400 border-orange-900/60'
    if (s === 'medium' || s >= '4') return 'bg-yellow-950/50 text-yellow-400 border-yellow-900/60'
    return 'bg-blue-950/50 text-blue-400 border-blue-900/60'
  }

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-64px)] overflow-hidden font-sans bg-slate-950 text-slate-200">
        
        {/* LEFT COLUMN: Cases List Queue */}
        <aside className="w-80 border-r border-slate-900 bg-slate-900/40 flex flex-col flex-shrink-0">
          {bulkSelectedIds.length > 0 ? (
            <div className="p-3 border-b border-slate-900 bg-blue-950/20 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-blue-400 font-mono">
                  {bulkSelectedIds.length} Selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (bulkSelectedIds.length === cases.length) {
                        setBulkSelectedIds([]);
                      } else {
                        setBulkSelectedIds(cases.map(c => c.id));
                      }
                    }}
                    className="text-[9px] font-bold text-slate-400 hover:text-slate-100 uppercase tracking-wider font-mono cursor-pointer"
                    style={{ background: 'transparent' }}
                  >
                    {bulkSelectedIds.length === cases.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <span className="text-slate-800">|</span>
                  <button
                    onClick={() => setBulkSelectedIds([])}
                    className="text-[9px] font-bold text-red-400 hover:text-red-300 uppercase tracking-wider font-mono cursor-pointer"
                    style={{ background: 'transparent' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleBulkClose}
                  className="flex-1 py-1 px-2 rounded border border-slate-850 text-slate-300 text-[10px] font-bold font-mono transition active:scale-95 cursor-pointer"
                  style={{ background: '#1e293b' }}
                >
                  Close
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex-1 py-1 px-2 rounded border border-slate-850 text-slate-300 text-[10px] font-bold font-mono transition active:scale-95 cursor-pointer"
                  style={{ background: '#1e293b' }}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 border-b border-slate-900 flex items-center justify-between">
              <div>
                <h1 className="text-sm font-bold text-slate-100 tracking-wide flex items-center gap-1.5 uppercase font-mono">
                  <Briefcase className="w-4 h-4 text-blue-400" /> Case Queue
                </h1>
                <p className="text-[10px] text-slate-500 mt-0.5">Automated SOAR Detections</p>
              </div>
              <button
                onClick={() => setIsFormOpen(prev => !prev)}
                className="p-1.5 rounded-lg border border-slate-800 text-slate-450 hover:text-slate-100 transition active:scale-95 cursor-pointer"
                style={{ background: '#0f172a' }}
                title="Create Manual Case"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Manual Case Creation Form Drawer */}
          {isFormOpen && (
            <div className="p-4 border-b border-slate-900 bg-slate-950/60">
              <form onSubmit={handleCreateCase} className="flex flex-col gap-2.5">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">New Custom Case</span>
                <input
                  type="text"
                  placeholder="Case Title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-850 text-slate-200 text-xs outline-none focus:border-blue-500 transition"
                  required
                />
                <div className="flex items-center gap-2">
                  <select
                    value={newSeverity}
                    onChange={(e) => setNewSeverity(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-850 text-slate-350 text-xs outline-none focus:border-blue-500 transition cursor-pointer"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1.5 rounded border border-slate-800 text-slate-300 hover:text-white font-semibold text-xs transition active:scale-95 cursor-pointer"
                    style={{ background: '#1e293b' }}
                  >
                    {busy ? 'Saving...' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Cases Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-950 custom-scrollbar p-2 space-y-1">
            {cases.map((c) => {
              const isActive = c.id === selectedCaseId
              const displayDate = c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '-'
              
              let statusLabel = 'New'
              let statusColor = 'text-blue-400 bg-blue-950/30'
              if (c.status === 'in_progress') {
                statusLabel = 'Triage'
                statusColor = 'text-yellow-400 bg-yellow-950/30'
              } else if (c.status === 'closed') {
                statusLabel = 'Closed'
                statusColor = 'text-slate-500 bg-slate-900/50'
              }

              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedCaseId(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedCaseId(c.id)
                    }
                  }}
                  className={`p-3 rounded-lg border transition cursor-pointer flex flex-col gap-2 ${
                    isActive
                      ? 'border-blue-500/50 bg-blue-950/10'
                      : 'border-slate-900/60 bg-slate-900/20 hover:border-slate-800 hover:bg-slate-900/30'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      role="checkbox"
                      aria-checked={bulkSelectedIds.includes(c.id)}
                      tabIndex={0}
                      onClick={(e) => toggleSelectCase(e, c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleSelectCase(e, c.id)
                        }
                      }}
                      className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition flex-shrink-0 ${
                        bulkSelectedIds.includes(c.id)
                          ? 'border-blue-500 text-white'
                          : 'border-slate-800 hover:border-slate-650'
                      }`}
                      style={{ 
                        background: bulkSelectedIds.includes(c.id) ? '#2563eb' : '#0f172a',
                        borderColor: bulkSelectedIds.includes(c.id) ? '#3b82f6' : '#1e293b'
                      }}
                    >
                      {bulkSelectedIds.includes(c.id) && (
                        <Check className="w-2.5 h-2.5 text-white" />
                      )}
                    </span>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-200 line-clamp-2 leading-relaxed flex-1">
                          {c.title}
                        </span>
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span className={`px-2 py-0.5 rounded border text-[9px] font-medium ${getSeverityColor(c.severity)}`}>
                          {isNaN(c.severity) ? c.severity.toUpperCase() : `SEV ${c.severity}`}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-600" />
                          {displayDate}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            )}
            {!cases.length && (
              <div className="text-center py-8 text-slate-600 text-xs italic">No cases created in the system.</div>
            )}
          </div>
        </aside>

        {/* RIGHT COLUMN: Case Triage details and AI Report */}
        <main className="flex-1 overflow-y-auto bg-slate-950 flex flex-col custom-scrollbar">
          {selectedCase ? (
            <div className="p-6 flex flex-col gap-6 max-w-5xl w-full mx-auto">
              
              {/* Case Header Details Banner */}
              <div className="panel p-4 border border-slate-900 bg-slate-900/30 rounded-xl flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Case Overview</span>
                    <h2 className="text-base font-bold text-slate-100 mt-0.5 leading-snug">{selectedCase.title}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Status Select */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[8px] font-bold text-slate-500 uppercase font-mono">Status</span>
                      <select
                        value={selectedCase.status}
                        onChange={(e) => handleUpdateStatus(selectedCase.id, e.target.value)}
                        className="px-2 py-1 rounded bg-slate-950 border border-slate-850 text-xs text-slate-300 outline-none cursor-pointer focus:border-blue-500"
                      >
                        <option value="new">New</option>
                        <option value="in_progress">In Progress</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>

                    {/* Assigned user select */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[8px] font-bold text-slate-500 uppercase font-mono">Assignee</span>
                      <select
                        value={selectedCase.assigned_to || 'unassigned'}
                        onChange={(e) => handleAssignUser(selectedCase.id, e.target.value)}
                        className="px-2 py-1 rounded bg-slate-950 border border-slate-850 text-xs text-slate-300 outline-none cursor-pointer focus:border-blue-500"
                      >
                        <option value="unassigned">Unassigned</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                        ))}
                      </select>
                    </div>

                    {/* Delete Case */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[8px] font-bold text-slate-500 uppercase font-mono">Actions</span>
                      <button
                        onClick={() => handleDeleteSingleCase(selectedCase.id)}
                        className="px-2.5 py-1 rounded border border-slate-850 text-xs text-slate-350 outline-none hover:text-slate-100 hover:border-slate-700 transition active:scale-95 cursor-pointer font-semibold font-mono"
                        style={{ background: '#1e293b' }}
                      >
                        DELETE
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-400 pt-2 border-t border-slate-900/60 mt-1">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <strong>Created:</strong> {selectedCase.created_at ? new Date(selectedCase.created_at).toLocaleString() : '-'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-slate-500" />
                    <strong>Severity:</strong> 
                    <span className={`px-1.5 py-0.5 rounded border text-[8px] font-semibold ml-1 ${getSeverityColor(selectedCase.severity)}`}>
                      {isNaN(selectedCase.severity) ? selectedCase.severity.toUpperCase() : `SEV ${selectedCase.severity}`}
                    </span>
                  </span>
                  {selectedCase.playbook_execution_id && (
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-slate-500" />
                      <strong>Playbook Execution Run:</strong> 
                      <span className="font-mono text-[9px] bg-slate-950 px-1.5 py-0.5 rounded border border-slate-850 text-blue-300 font-semibold">
                        #{selectedCase.playbook_execution_id}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {/* Error/Success Feedbacks */}
              {success && <div className="p-3 bg-green-950/30 border border-green-800 text-green-400 rounded-lg text-xs font-semibold">{success}</div>}
              {error && <div className="p-3 bg-red-950/30 border border-red-800 text-red-400 rounded-lg text-xs font-semibold">{error}</div>}

              {/* 1. FIRST ITEM: AI Automated Investigation Report */}
              <section className="panel p-5 border border-slate-900 bg-slate-900/20 rounded-xl">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-4 h-4 text-purple-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-purple-300">AI Investigation Report</h3>
                </div>
                <div className="p-4 rounded-xl border border-slate-900 bg-slate-950/60 shadow-xl">
                  <MarkdownRenderer text={aiReport} />
                </div>
              </section>

              {/* 2. Interactive SOAR Playbook Execution Status and logs */}
              {selectedCase.playbook_execution_id && executionDetails && (
                <section className="panel p-5 border border-slate-900 bg-slate-900/20 rounded-xl">
                  <div className="flex items-center justify-between mb-4 border-b border-slate-900/60 pb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-green-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-green-300">Playbook Execution Logs</h3>
                    </div>
                    
                    {/* Execution status tag */}
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                      executionDetails.status === 'completed' ? 'bg-green-950/30 text-green-400 border-green-900' :
                      executionDetails.status === 'failed' ? 'bg-red-950/30 text-red-400 border-red-900' :
                      executionDetails.status === 'waiting_approval' ? 'bg-orange-950/30 text-orange-400 border-orange-900 animate-pulse' :
                      'bg-slate-900 text-slate-400 border-slate-800'
                    }`}>
                      {executionDetails.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Analyst Action Gate Approval Control */}
                  {executionDetails.status === 'waiting_approval' && (
                    <div className="mb-4 p-4 rounded-xl border border-orange-500/20 bg-orange-950/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="text-xs text-slate-300">
                        <span className="font-bold text-orange-400 flex items-center gap-1">
                          <AlertCircle className="w-4 h-4 animate-bounce" /> Action Gate Pending Approval
                        </span>
                        <p className="mt-1">The automated playbook has suspended execution on a block requiring analyst authorization.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApproveGate(selectedCase.playbook_execution_id, false)}
                          className="px-3 py-1.5 rounded-lg border border-red-900 text-red-400 text-xs font-bold transition active:scale-95 cursor-pointer"
                          style={{ background: 'rgba(239, 68, 68, 0.15)' }}
                        >
                          Deny Action
                        </button>
                        <button
                          onClick={() => handleApproveGate(selectedCase.playbook_execution_id, true)}
                          className="px-3 py-1.5 rounded-lg border border-green-900 text-green-400 text-xs font-bold transition active:scale-95 cursor-pointer"
                          style={{ background: 'rgba(34, 197, 94, 0.15)' }}
                        >
                          Approve Action
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Playbook live trace log terminal console */}
                  <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-900 font-mono text-[10px] text-slate-400 space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                    {executionDetails.execution_log?.logs?.map((log, idx) => {
                      let textCol = 'text-slate-400'
                      if (log.type === 'success') textCol = 'text-green-400'
                      if (log.type === 'error') textCol = 'text-red-400'
                      if (log.type === 'warning') textCol = 'text-orange-400 font-semibold'
                      
                      return (
                        <div key={idx} className="flex gap-2 items-start leading-relaxed">
                          <span className="text-slate-700">[{log.time ? log.time.split('T')[1].slice(0, 8) : ''}]</span>
                          <span className={textCol}>{log.text}</span>
                        </div>
                      )
                    })}
                    {!executionDetails.execution_log?.logs?.length && (
                      <span className="text-slate-600 italic">No execution logs logged.</span>
                    )}
                  </div>
                </section>
              )}

              {/* 3. Real trigger Alert metadata context information */}
              {alertInfo && (
                <section className="panel p-5 border border-slate-900 bg-slate-900/20 rounded-xl">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="w-4 h-4 text-blue-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-blue-300">Trigger Alert Information</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 rounded-lg border border-slate-900 bg-slate-950/40 flex flex-col gap-1.5">
                      <div className="flex justify-between border-b border-slate-900/80 pb-1">
                        <span className="text-slate-500 font-medium">Wazuh Rule ID</span>
                        <span className="font-mono text-slate-300 font-semibold">{alertInfo.rule_id}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900/80 pb-1">
                        <span className="text-slate-500 font-medium">Alert Severity</span>
                        <span className="font-semibold text-slate-300">{alertInfo.severity}/15</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-medium">Wazuh Alert Unique ID</span>
                        <span className="font-mono text-[10px] text-slate-450 truncate max-w-[120px]" title={alertInfo.wazuh_alert_id}>
                          {alertInfo.wazuh_alert_id}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-900 bg-slate-950/40 flex flex-col gap-1.5">
                      <div className="flex justify-between border-b border-slate-900/80 pb-1">
                        <span className="text-slate-500 font-medium">Monitored Host</span>
                        <span className="text-slate-300 font-semibold">{alertInfo.hostname}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900/80 pb-1">
                        <span className="text-slate-500 font-medium">Source IP</span>
                        <span className="font-mono text-slate-300 font-semibold">{alertInfo.src_ip}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-medium">Destination IP</span>
                        <span className="font-mono text-slate-300 font-semibold">{alertInfo.dst_ip}</span>
                      </div>
                    </div>
                  </div>
                </section>
              )}

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-950">
              <Briefcase className="w-10 h-10 text-slate-800 animate-pulse mb-3" />
              <h3 className="text-sm font-bold text-slate-400">No Case Selected</h3>
              <p className="text-xs text-slate-650 mt-1 max-w-sm">Please select a case from the list on the left side to review triage, automated playbooks, and AI investigation reports.</p>
            </div>
          )}
        </main>

      </div>
    </AppLayout>
  )
}
