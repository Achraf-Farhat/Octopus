import React, { useEffect, useState, useRef, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import { 
  Play, 
  Save, 
  Trash2, 
  Copy, 
  Download, 
  CheckCircle2, 
  Search, 
  Sparkles, 
  ChevronRight, 
  ChevronLeft,
  X, 
  AlertTriangle, 
  Plus, 
  HelpCircle, 
  FileCode, 
  ListFilter, 
  ArrowUpDown,
  BookOpen,
  Check,
  RefreshCw,
  Edit2
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'

// --- TypeScript Interfaces ---

interface Rule {
  id: number | null;
  rule_id: string;
  name: string;
  level: number;
  description: string;
  groups: string[];
  status: 'draft' | 'deployed' | 'default';
  deployed_at: string | null;
  filename: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export default function Rules() {
  // --- States ---
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null)
  const [xmlContent, setXmlContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [isEditingId, setIsEditingId] = useState(false)
  const [editingIdVal, setEditingIdVal] = useState('')
  
  // Navigation / Drawer toggles for responsive design
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileAssistantOpen, setMobileAssistantOpen] = useState(false)
  
  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'default' | 'custom' | 'draft' | 'deployed'>('all')
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [groupFilter, setGroupFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'id' | 'name' | 'level'>('id')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  
  // Modals
  const [newRuleModalOpen, setNewRuleModalOpen] = useState(false)
  const [newRuleType, setNewRuleType] = useState<'manual' | 'ai' | null>(null)
  
  // Forms & AI States
  const [manualForm, setManualForm] = useState({
    rule_id: '',
    name: '',
    level: '5',
    groups: 'local',
    description: '',
    if_sid: '',
    decoder: '',
    match: '',
    regex: ''
  })
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState('')
  
  // Right Assistant Panel States
  const [assistantTab, setAssistantTab] = useState<'assistant' | 'validation'>('assistant')
  const [aiChatResponse, setAiChatResponse] = useState<string>('')
  const [aiAssistantLoading, setAiAssistantLoading] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult>({ valid: true, errors: [], warnings: [] })
  const [validating, setValidating] = useState(false)
  
  // Toasts
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' }[]>([])
  
  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null)
  const originalXmlRef = useRef<string>('')
  
  // Unique IDs list for quick group filter
  const allGroups = useMemo(() => {
    const groups = new Set<string>()
    rules.forEach(r => r.groups.forEach(g => groups.add(g)))
    return Array.from(groups).sort((a, b) => a.localeCompare(b))
  }, [rules])

  // --- Load Data ---
  async function loadRules() {
    setLoading(true)
    try {
      const response = await api.get('/rules')
      setRules(response.data ?? [])
    } catch (err) {
      showToast('Failed to load rules from server.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRules()
  }, [])

  // --- Show Toast Helper ---
  let toastId = 0
  function showToast(message: any, type: 'success' | 'error' | 'info' = 'success') {
    const id = toastId++
    let msgStr = 'An error occurred'
    if (typeof message === 'string') {
      msgStr = message
    } else if (message && typeof message === 'object') {
      if (Array.isArray(message)) {
        msgStr = message.map((d: any) => {
          if (d && typeof d === 'object' && d.msg) {
            const field = d.loc ? d.loc.join('.') : ''
            return field ? `${field}: ${d.msg}` : d.msg
          }
          return JSON.stringify(d)
        }).join(', ')
      } else if (message.detail) {
        msgStr = typeof message.detail === 'string' ? message.detail : JSON.stringify(message.detail)
      } else {
        msgStr = JSON.stringify(message)
      }
    } else if (message) {
      msgStr = String(message)
    }

    setToasts(prev => [...prev, { id, message: msgStr, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }

  // --- Select Rule ---
  async function handleSelectRule(rule: Rule) {
    if (isDirty) {
      if (!confirm('You have unsaved edits in the active rule XML. Discard changes?')) {
        return
      }
    }
    
    setLoading(true)
    setMobileSidebarOpen(false)
    try {
      const response = await api.get(`/rules/${rule.rule_id}`)
      const fullRule = response.data
      setSelectedRule(fullRule)
      setXmlContent(fullRule.xml_content || '')
      originalXmlRef.current = fullRule.xml_content || ''
      setIsDirty(false)
      
      // Auto-validate XML on load
      setValidationResult({ valid: true, errors: [], warnings: [] })
    } catch (err) {
      showToast(`Could not load rule details for ID ${rule.rule_id}.`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // --- Handle Code Change ---
  function handleCodeChange(value: string | undefined) {
    const val = value || ''
    setXmlContent(val)
    setIsDirty(val !== originalXmlRef.current)
  }

  // --- Commit Rule ID Change ---
  function handleCommitIdChange() {
    setIsEditingId(false)
    if (!selectedRule) return
    const cleanVal = editingIdVal.trim()
    if (!cleanVal || cleanVal === selectedRule.rule_id) return

    if (!/^\d+$/.test(cleanVal)) {
      showToast('Wazuh rule IDs must be numeric.', 'error')
      return
    }

    const idNum = parseInt(cleanVal)
    if (idNum < 100000 || idNum > 119999) {
      showToast('Custom Wazuh rule IDs should be between 100000 and 119999.', 'info')
    }

    const exists = rules.some(r => r.rule_id === cleanVal && r.id !== selectedRule.id)
    if (exists) {
      showToast(`Rule ID ${cleanVal} is already in use by another rule.`, 'error')
      return
    }

    let updatedXml = xmlContent
    const regex = /(<rule\s+[^>]*?id=['"])[^'"]*(['"])/
    if (regex.test(updatedXml)) {
      updatedXml = updatedXml.replace(regex, `$1${cleanVal}$2`)
    }

    setSelectedRule(prev => prev ? { ...prev, rule_id: cleanVal, xml_content: updatedXml } : null)
    setXmlContent(updatedXml)
    setIsDirty(updatedXml !== originalXmlRef.current)
    showToast(`Rule ID updated to ${cleanVal} (unsaved)`, 'info')
  }

  // --- Save Rule ---
  async function handleSave() {
    if (!selectedRule) return null
    if ((selectedRule.status || 'draft') === 'default') {
      showToast('Default Wazuh rules are read-only.', 'error')
      return null
    }

    try {
      let response
      if (selectedRule.id === null) {
        // Create new custom rule
        response = await api.post('/rules', {
          rule_id: selectedRule.rule_id,
          name: selectedRule.name,
          xml_content: xmlContent
        })
        showToast('Rule created successfully as draft.', 'success')
      } else {
        // Update existing custom rule
        response = await api.put(`/rules/${selectedRule.id}`, {
          rule_id: selectedRule.rule_id,
          name: selectedRule.name,
          xml_content: xmlContent
        })
        showToast('Rule saved successfully as draft.', 'success')
      }
      
      originalXmlRef.current = xmlContent
      setIsDirty(false)
      
      // Refresh local rule info
      setSelectedRule(response.data)
      
      // Reload lists
      await loadRules()
      return response.data
    } catch (err: any) {
      showToast(err?.response?.data?.detail ?? 'Failed to save rule.', 'error')
      throw err
    }
  }

  // --- Save & Reload Rules (Deploy) ---
  async function handleDeploy() {
    if (!selectedRule) return
    if ((selectedRule.status || 'draft') === 'default') {
      showToast('Default Wazuh rules are read-only.', 'error')
      return
    }

    let activeRule = selectedRule
    if (isDirty || selectedRule.id === null) {
      try {
        const savedRule = await handleSave()
        if (!savedRule) return
        activeRule = savedRule
      } catch (err) {
        // Stop deployment if saving fails
        return
      }
    }

    showToast('Starting deployment and validation on Wazuh manager...', 'info')
    
    try {
      const response = await api.post(`/rules/${activeRule.id}/deploy`)
      showToast('Rules compiled, validated, and Wazuh manager service restarted!', 'success')
      setIsDirty(false)
      
      // Reload all
      setSelectedRule(response.data)
      await loadRules()
    } catch (err: any) {
      showToast(err?.response?.data?.detail ?? 'Deployment failed. Check validation logs.', 'error')
      setAssistantTab('validation')
      // Refresh validation
      handleValidate()
    }
  }

  // --- Validate XML Syntax ---
  async function handleValidate() {
    if (!xmlContent) return
    setValidating(true)
    try {
      const response = await api.post('/rules/validate', { xml_content: xmlContent })
      setValidationResult(response.data)
      if (response.data.valid) {
        showToast('XML structure matches Wazuh rule syntax specifications.', 'success')
      } else {
        showToast('XML ruleset contains formatting errors or warnings.', 'error')
      }
    } catch (err) {
      showToast('System syntax validator is currently unavailable.', 'error')
    } finally {
      setValidating(false)
    }
  }

  // --- Delete Rule ---
  async function handleDelete() {
    if (!selectedRule || selectedRule.id === null) return
    
    if (confirm(`Are you sure you want to permanently delete custom rule "${selectedRule.name}" (ID ${selectedRule.rule_id})?`)) {
      try {
        await api.delete(`/rules/${selectedRule.id}`)
        showToast('Rule deleted successfully.', 'success')
        setSelectedRule(null)
        setXmlContent('')
        originalXmlRef.current = ''
        setIsDirty(false)
        await loadRules()
      } catch (err: any) {
        showToast(err?.response?.data?.detail ?? 'Failed to delete rule.', 'error')
      }
    }
  }

  // --- Duplicate Rule ---
  function handleDuplicate() {
    if (!selectedRule) return
    
    // Auto-generate a new ID by finding max custom ID + 1
    const customIDs = rules.map(r => parseInt(r.rule_id)).filter(id => !isNaN(id) && id >= 100000)
    const nextID = customIDs.length > 0 ? Math.max(...customIDs) + 1 : 100001
    
    // Modify XML content block with new ID
    let duplicatedXml = xmlContent
    duplicatedXml = duplicatedXml.replace(/id="[^"]*"/, `id="${nextID}"`)
    
    setManualForm({
      rule_id: nextID.toString(),
      name: `Copy of ${selectedRule.name}`,
      level: selectedRule.level.toString(),
      groups: selectedRule.groups.join(','),
      description: `Duplicate clone of rule ${selectedRule.rule_id}: ${selectedRule.description}`,
      if_sid: '',
      decoder: '',
      match: '',
      regex: ''
    })
    
    setNewRuleType('manual')
    setNewRuleModalOpen(true)
  }

  // --- Export XML file ---
  function handleExport() {
    if (!selectedRule) return
    const blob = new Blob([xmlContent], { type: 'text/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedRule.rule_id}_wazuh_rule.xml`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('Rule XML exported successfully.', 'success')
  }

  // --- AI Rule Prompt Submission ---
  async function handleAIGenerateRule(e: React.FormEvent) {
    e.preventDefault()
    if (!aiPrompt.trim()) return
    
    setAiGenerating(true)
    setAiError('')
    
    try {
      const response = await api.post('/rules/generate', { prompt: aiPrompt })
      const data = response.data
      
      // Close modal and set up generated rule in editor
      setNewRuleModalOpen(false)
      setNewRuleType(null)
      
      const newDummyRule: Rule = {
        id: null, // Draft not saved in db yet
        rule_id: data.rule_id,
        name: data.name,
        level: data.level,
        description: data.description,
        groups: data.groups,
        status: 'draft',
        deployed_at: null,
        filename: 'octopus_rules.xml'
      }
      
      setSelectedRule(newDummyRule)
      setXmlContent(data.xml_content)
      originalXmlRef.current = ''
      setIsDirty(true)
      setAiPrompt('')
      
      showToast('AI rule draft generated. Review and click Save!', 'success')
    } catch (err: any) {
      setAiError(err?.response?.data?.detail ?? 'Failed to communicate with local Ollama service.')
    } finally {
      setAiGenerating(false)
    }
  }

  // --- Manual Wizard XML Compilation ---
  const compiledManualXml = useMemo(() => {
    const rid = manualForm.rule_id || '100500'
    const lvl = manualForm.level || '5'
    const desc = manualForm.description || 'Custom detection rule'
    const groups = manualForm.groups ? ` groups="${manualForm.groups.split(',').map(s => s.trim()).join(',')}"` : ''
    
    let content = `<rule id="${rid}" level="${lvl}"${groups}>\n`
    if (manualForm.if_sid) content += `  <if_sid>${manualForm.if_sid.trim()}</if_sid>\n`
    if (manualForm.decoder) content += `  <decoded_as>${manualForm.decoder.trim()}</decoded_as>\n`
    if (manualForm.match) content += `  <match>${manualForm.match.trim()}</match>\n`
    if (manualForm.regex) content += `  <regex>${manualForm.regex.trim()}</regex>\n`
    content += `  <description>${desc.trim()}</description>\n`
    content += `</rule>`
    
    return content
  }, [manualForm])

  // --- Manual Creation Submit ---
  async function handleCreateRuleManual(e: React.FormEvent) {
    e.preventDefault()
    if (!manualForm.rule_id || !manualForm.name) {
      showToast('Rule ID and Name are required.', 'error')
      return
    }

    try {
      // Save directly to backend
      const response = await api.post('/rules', {
        rule_id: manualForm.rule_id,
        name: manualForm.name,
        xml_content: compiledManualXml
      })

      showToast('Custom rule created as draft!', 'success')
      setNewRuleModalOpen(false)
      setNewRuleType(null)
      
      const newRule = response.data
      setSelectedRule(newRule)
      setXmlContent(newRule.xml_content)
      originalXmlRef.current = newRule.xml_content
      setIsDirty(false)
      
      // Reload list
      await loadRules()
    } catch (err: any) {
      showToast(err?.response?.data?.detail ?? 'Failed to create rule.', 'error')
    }
  }

  // --- AI Right Pane Chat Helper ---
  async function triggerAIAssistant(action: string) {
    if (!xmlContent) return
    setAiAssistantLoading(true)
    setAssistantTab('assistant')
    setAiChatResponse('Consulting local AI assistant...')

    try {
      const response = await api.post('/rules/assistant', {
        action,
        xml_content: xmlContent,
        prompt: action === 'improve' ? 'Suggest optimization and format cleaning.' : undefined
      })
      setAiChatResponse(response.data.response)
    } catch (err: any) {
      setAiChatResponse(`Ollama AI Service Error: ${err?.response?.data?.detail ?? 'Connection timed out.'}`)
    } finally {
      setAiAssistantLoading(false)
    }
  }

  // --- Live Filters & Search ---
  const filteredAndSortedRules = useMemo(() => {
    let list = [...rules]

    // Status Filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'custom') {
        list = list.filter(r => r.status !== 'default')
      } else {
        list = list.filter(r => r.status === statusFilter)
      }
    }

    // Level Filter
    if (levelFilter) {
      list = list.filter(r => r.level.toString() === levelFilter)
    }

    // Group Filter
    if (groupFilter) {
      list = list.filter(r => r.groups.map(g => g.toLowerCase()).includes(groupFilter.toLowerCase()))
    }

    // Search Query (ID, Name, Description)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      list = list.filter(r => 
        r.rule_id.includes(query) ||
        r.name.toLowerCase().includes(query) ||
        r.description.toLowerCase().includes(query)
      )
    }

    // Sort
    list.sort((a, b) => {
      let aVal: any = a[sortBy]
      let bVal: any = b[sortBy]

      if (sortBy === 'id') {
        // Sort as numbers if numerical
        aVal = parseInt(a.rule_id) || a.rule_id
        bVal = parseInt(b.rule_id) || b.rule_id
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [rules, statusFilter, levelFilter, groupFilter, searchQuery, sortBy, sortOrder])

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        handleDuplicate()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRule, xmlContent, isDirty, rules])

  // --- Warn on Unsaved Changes ---
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  return (
    <AppLayout>
      {/* Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div 
            key={t.id} 
            className={`flex items-start gap-3 p-3 rounded-lg shadow-xl border backdrop-blur-md transition-all duration-300 transform translate-y-0 ${
              t.type === 'success' 
                ? 'bg-green-950/80 border-green-700/50 text-green-200' 
                : t.type === 'error'
                ? 'bg-red-950/80 border-red-700/50 text-red-200'
                : 'bg-blue-950/80 border-blue-700/50 text-blue-200'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-green-400" />}
            {t.type === 'error' && <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400" />}
            {t.type === 'info' && <RefreshCw className="w-5 h-5 flex-shrink-0 text-blue-400 animate-spin" />}
            <span className="text-sm font-medium">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Drawer Overlay for Mobile viewports */}
      {(mobileSidebarOpen || mobileAssistantOpen) && (
        <div 
          aria-hidden="true"
          onClick={() => {
            setMobileSidebarOpen(false)
            setMobileAssistantOpen(false)
          }}
          className="xl:hidden fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 transition-opacity duration-300"
        />
      )}

      <div className="rules-page-container flex h-[calc(100vh-140px)] w-full overflow-hidden border border-slate-800/60 rounded-xl bg-slate-950/60 backdrop-blur-md text-slate-100 font-sans shadow-2xl relative">
        <style>{`
          .rules-page-container button {
            background-image: none !important;
            background-color: rgba(15, 23, 42, 0.75) !important;
            border-color: rgba(148, 163, 184, 0.16) !important;
            color: #cbd5e1 !important;
            box-shadow: none !important;
          }
          .rules-page-container button:hover:not(:disabled) {
            background-color: rgba(30, 41, 59, 0.9) !important;
            color: #f8fafc !important;
            border-color: rgba(148, 163, 184, 0.35) !important;
          }
          .rules-page-container button:disabled {
            opacity: 0.35 !important;
            cursor: not-allowed !important;
            background-color: rgba(15, 23, 42, 0.3) !important;
            border-color: rgba(148, 163, 184, 0.08) !important;
            color: #64748b !important;
          }
        `}</style>
        
        {/* Left Explorer Sidebar */}
        <aside 
          className={`
            flex flex-col border-r border-slate-800/80 bg-slate-950/95 xl:bg-slate-950/90 transition-all duration-300 ease-in-out absolute xl:relative left-0 top-0 bottom-0 z-50 xl:z-10 flex-shrink-0 h-full overflow-hidden
            ${sidebarCollapsed ? 'xl:w-0 xl:border-r-0 xl:opacity-0 xl:pointer-events-none' : 'xl:w-80 2xl:w-96'} 
            ${mobileSidebarOpen ? 'translate-x-0 w-80' : '-translate-x-full xl:translate-x-0'}
          `}
        >
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode className="w-5 h-5 text-slate-400" />
              <span className="font-semibold text-sm tracking-wide uppercase text-slate-300">Rules</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 border border-slate-800 text-slate-400" title="Total rules">
                {filteredAndSortedRules.length === rules.length ? rules.length : `${filteredAndSortedRules.length}/${rules.length}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setNewRuleModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-slate-100 shadow-md active:scale-95 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
              {/* Collapse Left Sidebar button (desktop only) */}
              <button 
                onClick={() => setSidebarCollapsed(true)}
                className="hidden xl:flex p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800 rounded-lg transition"
                title="Collapse Sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setMobileSidebarOpen(false)}
                className="xl:hidden p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="p-3 border-b border-slate-800/40 flex flex-col gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search rule ID, description... (Ctrl+F)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900/80 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
              />
            </div>

            {/* Filter Pill Row */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-slate-400 select-none no-scrollbar">
              <div className="flex gap-1.5">
                {(['all', 'default', 'custom', 'draft', 'deployed'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md border tracking-wider transition ${
                      statusFilter === f 
                        ? 'bg-blue-950 border-blue-500 text-blue-300' 
                        : 'bg-slate-900 border-slate-800 hover:bg-slate-850 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Complex filters */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
                <ListFilter className="w-3 h-3 text-slate-400" />
                <select 
                  value={levelFilter} 
                  onChange={e => setLevelFilter(e.target.value)}
                  className="bg-transparent text-[11px] text-slate-300 w-full focus:outline-none cursor-pointer"
                >
                  <option value="" className="bg-slate-900">All Levels</option>
                  {Array.from({ length: 17 }, (_, i) => (
                    <option key={i} value={i} className="bg-slate-900">Lvl {i}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
                <ArrowUpDown className="w-3 h-3 text-slate-400" />
                <select 
                  value={sortBy} 
                  onChange={e => setSortBy(e.target.value as any)}
                  className="bg-transparent text-[11px] text-slate-300 w-full focus:outline-none cursor-pointer"
                >
                  <option value="id" className="bg-slate-900">Sort: ID</option>
                  <option value="name" className="bg-slate-900">Sort: Name</option>
                  <option value="level" className="bg-slate-900">Sort: Level</option>
                </select>
              </div>
            </div>
          </div>

          {/* Rules List Grid */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
            {loading && rules.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                Loading rules registry...
              </div>
            ) : filteredAndSortedRules.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
                <HelpCircle className="w-5 h-5 text-slate-600" />
                No matching rules found.
              </div>
            ) : (
              filteredAndSortedRules.map(rule => {
                const isSelected = selectedRule?.rule_id === rule.rule_id
                return (
                  <div
                    key={rule.rule_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectRule(rule)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelectRule(rule)
                      }
                    }}
                    className={`p-3 text-xs flex flex-col gap-2 cursor-pointer transition select-none ${
                      isSelected 
                        ? 'bg-blue-950/40 border-l-2 border-blue-500 text-blue-100' 
                        : 'hover:bg-slate-900/50 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-mono">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          rule.status === 'default'
                            ? 'bg-slate-850 text-slate-400 border border-slate-700'
                            : rule.status === 'deployed'
                            ? 'bg-green-950 text-green-400 border border-green-800/50'
                            : 'bg-amber-950 text-amber-400 border border-amber-800/50'
                        }`}>
                          {rule.rule_id}
                        </span>
                        <span className="font-semibold text-slate-400">Lvl {rule.level}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 tracking-wider">
                        {rule.status === 'default' ? 'Wazuh Default' : rule.status.toUpperCase()}
                      </span>
                    </div>

                    <p className="text-slate-300 font-medium line-clamp-2 leading-relaxed">
                      {rule.description || rule.name}
                    </p>

                    <div className="flex flex-wrap gap-1 mt-1">
                      {rule.groups.map(g => (
                        <span key={g} className="px-1.5 py-0.5 rounded-full text-[9px] bg-slate-900 border border-slate-800/80 text-slate-400 uppercase tracking-wide">
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* Center Main Editor Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-900/20 h-full z-10">
          {selectedRule ? (
            <>
              {/* Editor Header / Toolbars */}
              <div className="px-3 md:px-4 py-3 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                  {/* Expand Sidebar button (desktop only) */}
                  {sidebarCollapsed && (
                    <button 
                      onClick={() => setSidebarCollapsed(false)} 
                      className="hidden xl:flex p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800 rounded-lg transition"
                      title="Expand Rules Explorer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                  {/* Mobile Explorer Toggle */}
                  <button 
                    onClick={() => setMobileSidebarOpen(true)} 
                    className="xl:hidden p-2 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-850 text-slate-300 active:scale-95 transition flex-shrink-0"
                    title="Open Rules Explorer"
                  >
                    <ListFilter className="w-4 h-4" />
                  </button>

                  <FileCode className="hidden md:block w-5 h-5 text-blue-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
                      {isEditingId ? (
                        <input
                          type="text"
                          value={editingIdVal}
                          onChange={e => setEditingIdVal(e.target.value)}
                          onBlur={handleCommitIdChange}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleCommitIdChange()
                            if (e.key === 'Escape') setIsEditingId(false)
                          }}
                          className="font-mono font-bold text-xs md:text-sm text-slate-200 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          autoFocus
                        />
                      ) : (
                        <div 
                          role={(selectedRule.status || 'draft') !== 'default' ? 'button' : undefined}
                          tabIndex={(selectedRule.status || 'draft') !== 'default' ? 0 : -1}
                          onClick={() => {
                            if ((selectedRule.status || 'draft') !== 'default') {
                              setIsEditingId(true)
                              setEditingIdVal(selectedRule.rule_id)
                            }
                          }}
                          onKeyDown={(e) => {
                            if ((selectedRule.status || 'draft') !== 'default' && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault()
                              setIsEditingId(true)
                              setEditingIdVal(selectedRule.rule_id)
                            }
                          }}
                          className={`flex items-center gap-1 font-mono font-bold text-xs md:text-sm text-slate-200 ${
                            (selectedRule.status || 'draft') !== 'default' 
                              ? 'cursor-pointer hover:underline decoration-dashed decoration-blue-400/60 hover:text-blue-300 transition-colors' 
                              : ''
                          }`}
                          title={(selectedRule.status || 'draft') !== 'default' ? "Click to edit Rule ID" : undefined}
                        >
                          <span>{selectedRule.rule_id}</span>
                          {(selectedRule.status || 'draft') !== 'default' && (
                            <Edit2 className="w-3 h-3 text-slate-500 hover:text-slate-300 opacity-60" />
                          )}
                        </div>
                      )}
                      <span className={`text-[9px] md:text-[10px] font-bold px-1.5 py-0.2 rounded-full border ${
                        (selectedRule.status || 'draft') === 'default'
                          ? 'bg-slate-900 border-slate-800 text-slate-500'
                          : (selectedRule.status || 'draft') === 'deployed'
                          ? 'bg-green-950/80 border-green-800 text-green-400'
                          : 'bg-amber-950/80 border-amber-800 text-amber-400'
                      }`}>
                        {(selectedRule.status || 'draft').toUpperCase()}
                      </span>
                      {isDirty && (
                        <span className="text-[9px] md:text-[10px] font-bold text-amber-500 flex items-center gap-1 animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span className="hidden sm:inline">Unsaved edits (Ctrl+S)</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] md:text-xs text-slate-500 truncate mt-0.5">
                      {selectedRule.filename || 'octopus_rules.xml'} — {selectedRule.name}
                    </p>
                  </div>
                </div>

                {/* Editor Action Buttons */}
                <div className="flex items-center gap-1.5 md:gap-2">
                  <button
                    onClick={handleValidate}
                    disabled={validating}
                    title="Validate XML structure"
                    className="hidden sm:flex p-1.5 md:p-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-slate-200 active:scale-95 transition items-center gap-1.5 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5 text-slate-400" />
                    <span className="hidden md:inline">Validate</span>
                  </button>

                  <button
                    onClick={handleExport}
                    title="Download XML file"
                    className="hidden sm:flex p-1.5 md:p-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-slate-200 active:scale-95 transition items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <span className="hidden md:inline">Export</span>
                  </button>

                  <button
                    onClick={handleDuplicate}
                    title="Clone this rule (Ctrl+D)"
                    className="hidden sm:flex p-1.5 md:p-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-slate-200 active:scale-95 transition items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span className="hidden md:inline">Duplicate</span>
                  </button>

                  {((selectedRule?.status || 'draft') !== 'default') && (
                    <>
                      <button
                        onClick={handleDelete}
                        title="Delete rule"
                        className="p-1.5 md:p-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-slate-200 active:scale-95 transition flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                        <span className="hidden md:inline">Delete</span>
                      </button>

                      <button
                        onClick={handleSave}
                        disabled={!isDirty}
                        title="Save to database as draft"
                        className={`p-1.5 md:p-2 text-xs font-semibold rounded-lg border active:scale-95 transition flex items-center gap-1.5 ${
                          isDirty 
                            ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white' 
                            : 'bg-slate-950/20 border-slate-900 text-slate-600 cursor-not-allowed'
                        }`}
                      >
                        <Save className="w-3.5 h-3.5 text-slate-400" />
                        <span className="hidden md:inline">Save</span>
                      </button>

                      <button
                        onClick={handleDeploy}
                        title="Compile, validate, and restart Wazuh manager"
                        className="p-1.5 md:p-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white active:scale-95 transition flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5 text-slate-400 fill-slate-400" />
                        <span className="hidden md:inline">Deploy</span>
                      </button>
                    </>
                  )}

                  {/* Expand Assistant button (desktop only) */}
                  {!assistantOpen && (
                    <button
                      onClick={() => setAssistantOpen(true)}
                      className="hidden xl:flex p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800 rounded-lg transition items-center gap-1 flex-shrink-0"
                      title="Expand AI Assistant"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}

                  {/* Mobile Assistant Toggle */}
                  <button 
                    onClick={() => setMobileAssistantOpen(true)} 
                    className="xl:hidden p-2 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-850 text-slate-300 active:scale-95 transition flex items-center gap-1 flex-shrink-0"
                    title="Open AI Assistant"
                  >
                    <Sparkles className="w-4 h-4 text-slate-400 animate-pulse" />
                    <span className="text-xs font-semibold text-slate-400">AI</span>
                  </button>
                </div>
              </div>

              {/* Editor Workspace Layout */}
              <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden relative">
                
                {/* Center Pane: Editor */}
                <div className="flex-1 min-w-0 h-full relative border-r border-slate-800/40 bg-slate-950">
                  <Editor
                    height="100%"
                    defaultLanguage="xml"
                    theme={theme === 'dark' ? 'vs-dark' : 'light'}
                    value={xmlContent}
                    onChange={handleCodeChange}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      automaticLayout: true,
                      wordWrap: 'on',
                      lineNumbers: 'on',
                      folding: true,
                      readOnly: (selectedRule?.status || 'draft') === 'default',
                      scrollbar: {
                        verticalScrollbarSize: 8,
                        horizontalScrollbarSize: 8,
                      }
                    }}
                  />
                  
                  {/* Theme Switcher Toggle */}
                  <button 
                    onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                    className="absolute right-4 bottom-4 z-10 px-2.5 py-1 text-[10px] font-semibold tracking-wide border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded"
                  >
                    THEME: {theme.toUpperCase()}
                  </button>
                </div>

                {/* Right Pane: AI Assistant & Validation */}
                <aside 
                  className={`
                    flex flex-col bg-slate-950 border-l border-slate-800/80 transition-all duration-300 ease-in-out absolute xl:relative right-0 top-0 bottom-0 z-50 xl:z-10 flex-shrink-0 h-full overflow-hidden
                    ${assistantOpen ? 'xl:w-80 2xl:w-96' : 'xl:w-0 xl:border-l-0 xl:opacity-0 xl:pointer-events-none'} 
                    ${mobileAssistantOpen ? 'translate-x-0 w-80' : 'translate-x-full xl:translate-x-0'}
                  `}
                >
                  {/* Assistant Tabs */}
                  <div className="flex border-b border-slate-800/80 bg-slate-950 items-center justify-between">
                    <div className="flex flex-1">
                      <button
                        onClick={() => setAssistantTab('assistant')}
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 text-center transition ${
                          assistantTab === 'assistant' 
                            ? 'border-blue-500 text-blue-400 bg-slate-900/40' 
                            : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20'
                        }`}
                      >
                        <span className="flex items-center justify-center gap-1.5 text-[10px] sm:text-xs">
                          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                          Assistant
                        </span>
                      </button>
                      <button
                        onClick={() => setAssistantTab('validation')}
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 text-center transition ${
                          assistantTab === 'validation' 
                            ? 'border-blue-500 text-blue-400 bg-slate-900/40' 
                            : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20'
                        }`}
                      >
                        <span className="flex items-center justify-center gap-1.5 text-[10px] sm:text-xs">
                          <Check className="w-3.5 h-3.5 text-green-400" />
                          Validation
                        </span>
                      </button>
                    </div>
                    {/* Collapse Assistant button (desktop only) */}
                    <button
                      onClick={() => setAssistantOpen(false)}
                      className="hidden xl:flex p-1.5 text-slate-400 hover:text-slate-200 mr-2 rounded-lg hover:bg-slate-900 border border-slate-800 transition"
                      title="Collapse Assistant"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setMobileAssistantOpen(false)}
                      className="xl:hidden p-2 text-slate-400 hover:text-slate-200 mr-2 rounded-lg hover:bg-slate-900 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Panel Tab Content */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {assistantTab === 'assistant' ? (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-400">Quick AI Actions:</span>
                        </div>

                        {/* Quick Prompts grid */}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => triggerAIAssistant('explain')}
                            disabled={aiAssistantLoading}
                            className="p-2 text-left bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-[11px] font-medium text-slate-300 transition flex items-center gap-2 active:scale-95 disabled:opacity-50"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                            Explain Rule
                          </button>
                          <button
                            onClick={() => triggerAIAssistant('improve')}
                            disabled={aiAssistantLoading}
                            className="p-2 text-left bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-[11px] font-medium text-slate-300 transition flex items-center gap-2 active:scale-95 disabled:opacity-50"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                            Optimize Logic
                          </button>
                          <button
                            onClick={() => triggerAIAssistant('analyze')}
                            disabled={aiAssistantLoading}
                            className="p-2 text-left bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-[11px] font-medium text-slate-300 transition flex items-center gap-2 active:scale-95 disabled:opacity-50"
                          >
                            <HelpCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            Missing Fields
                          </button>
                          <button
                            onClick={() => triggerAIAssistant('convert')}
                            disabled={aiAssistantLoading}
                            className="p-2 text-left bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-[11px] font-medium text-slate-300 transition flex items-center gap-2 active:scale-95 disabled:opacity-50"
                          >
                            <FileCode className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                            Severity Levels
                          </button>
                        </div>

                        {/* AI response box */}
                        <div className="flex-1 mt-2">
                          <span className="text-xs font-semibold text-slate-400 block mb-2">AI Assistant Output:</span>
                          <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg text-xs font-medium leading-relaxed font-sans text-slate-300 min-h-[200px] max-h-[400px] overflow-y-auto whitespace-pre-wrap select-text">
                            {aiAssistantLoading ? (
                              <div className="flex items-center gap-2 text-slate-500 py-8 justify-center">
                                <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                                Processing ruleset analysis...
                              </div>
                            ) : aiChatResponse ? (
                              aiChatResponse
                            ) : (
                              <p className="text-slate-500 italic text-center py-8">Select a quick AI action above to get ruleset guidance, optimization suggestions, and compliance explanations from local Ollama model.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Validation Panel Content
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Syntax Validation Logs</span>
                          <button 
                            onClick={handleValidate} 
                            disabled={validating}
                            className="p-1 text-slate-400 hover:text-slate-200 transition"
                          >
                            <RefreshCw className={`w-4 h-4 ${validating ? 'animate-spin' : ''}`} />
                          </button>
                        </div>

                        {/* Successful validation */}
                        {validationResult.valid && validationResult.errors.length === 0 && (
                          <div className="p-3 rounded-lg bg-green-950/40 border border-green-800/60 text-green-300 flex items-start gap-2 text-xs font-medium">
                            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <strong className="block mb-0.5 text-green-200">XML Syntax Valid</strong>
                              Passed basic document checks.
                            </div>
                          </div>
                        )}

                        {/* Warnings list */}
                        {validationResult.warnings.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wide flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Warnings ({validationResult.warnings.length})
                            </span>
                            <div className="flex flex-col gap-1.5">
                              {validationResult.warnings.map((warn, i) => (
                                <div key={i} className="p-2.5 rounded bg-amber-950/30 border border-amber-800/30 text-amber-300 text-xs font-medium">
                                  {warn}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Errors list */}
                        {validationResult.errors.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <span className="text-[11px] font-bold text-red-500 uppercase tracking-wide flex items-center gap-1.5">
                              <X className="w-3.5 h-3.5" />
                              Errors ({validationResult.errors.length})
                            </span>
                            <div className="flex flex-col gap-1.5">
                              {validationResult.errors.map((err, i) => (
                                <div key={i} className="p-2.5 rounded bg-red-950/30 border border-red-800/30 text-red-300 text-xs font-medium">
                                  {err}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center select-none">
              <FileCode className="w-12 h-12 text-slate-700 mb-3" />
              <h3 className="text-slate-300 font-semibold mb-1 text-sm uppercase tracking-wide">No Rule Selected</h3>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                Select an existing rule to begin editing.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Slide-over / Modal for creating a new rule */}
      {newRuleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden transform transition-all">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-200 flex items-center gap-2 uppercase tracking-wide">
                <Plus className="w-5 h-5 text-blue-500" />
                Initialize New Wazuh Rule
              </h3>
              <button 
                onClick={() => {
                  setNewRuleModalOpen(false)
                  setNewRuleType(null)
                  setAiPrompt('')
                  setAiError('')
                }}
                className="text-slate-400 hover:text-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selection step (Manual vs AI) */}
            {newRuleType === null && (
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => setNewRuleType('manual')}
                  className="p-5 text-left rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-slate-700/60 transition group flex flex-col gap-2"
                >
                  <FileCode className="w-8 h-8 text-blue-400 group-hover:scale-110 transition" />
                  <strong className="text-slate-200 block text-sm font-bold mt-1">Manual Rule Form</strong>
                  <span className="text-xs text-slate-400 leading-relaxed">
                    Build ruleset fields step-by-step using an interactive wizard with live XML output compilation.
                  </span>
                </button>

                <button
                  onClick={() => setNewRuleType('ai')}
                  className="p-5 text-left rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-slate-700/60 transition group flex flex-col gap-2"
                >
                  <Sparkles className="w-8 h-8 text-purple-400 group-hover:scale-110 transition" />
                  <strong className="text-slate-200 block text-sm font-bold mt-1">AI-Assisted Generation</strong>
                  <span className="text-xs text-slate-400 leading-relaxed">
                    Describe detection logic in plain English and compile rules using local Ollama LLM capabilities.
                  </span>
                </button>
              </div>
            )}

            {/* Option 1: Manual Rule Form */}
            {newRuleType === 'manual' && (
              <form onSubmit={handleCreateRuleManual} className="flex flex-col min-h-0">
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto">
                  <div className="flex flex-col gap-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Rule Parameters</span>
                    
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400">Rule ID (100000 - 120000)</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. 100501"
                        value={manualForm.rule_id}
                        onChange={e => setManualForm(prev => ({ ...prev, rule_id: e.target.value }))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400">Rule Name / Short Label</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Suspicious PowerShell executed"
                        value={manualForm.name}
                        onChange={e => setManualForm(prev => ({ ...prev, name: e.target.value }))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-semibold text-slate-400">Severity Level (0 - 16)</label>
                        <input 
                          type="number" 
                          min="0"
                          max="16"
                          value={manualForm.level}
                          onChange={e => setManualForm(prev => ({ ...prev, level: e.target.value }))}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-semibold text-slate-400">Groups (comma-separated)</label>
                        <input 
                          type="text" 
                          placeholder="e.g. syslog,powershell"
                          value={manualForm.groups}
                          onChange={e => setManualForm(prev => ({ ...prev, groups: e.target.value }))}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400">If Parent Rule SID (if_sid)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 5715 (matches parent rule ID)"
                        value={manualForm.if_sid}
                        onChange={e => setManualForm(prev => ({ ...prev, if_sid: e.target.value }))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400">Decoded As (decoded_as)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. json, sshd"
                        value={manualForm.decoder}
                        onChange={e => setManualForm(prev => ({ ...prev, decoder: e.target.value }))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400">Exact String Match (match)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. failed login"
                        value={manualForm.match}
                        onChange={e => setManualForm(prev => ({ ...prev, match: e.target.value }))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400">Regex Expression (regex)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. (wget|curl) http"
                        value={manualForm.regex}
                        onChange={e => setManualForm(prev => ({ ...prev, regex: e.target.value }))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400">Description Message</label>
                      <textarea 
                        required
                        placeholder="e.g. Alert triggers on suspicious script exfiltration"
                        rows={2}
                        value={manualForm.description}
                        onChange={e => setManualForm(prev => ({ ...prev, description: e.target.value }))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none"
                      />
                    </div>
                  </div>

                  {/* XML Live Preview */}
                  <div className="flex flex-col gap-3 h-full">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">XML Live Compiler Preview</span>
                    <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-[11px] text-emerald-400 whitespace-pre overflow-x-auto min-h-[300px] leading-relaxed shadow-inner">
                      {compiledManualXml}
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setNewRuleType(null)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold active:scale-95 transition"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white text-xs font-semibold shadow-md active:scale-95 transition"
                  >
                    Create Rule
                  </button>
                </div>
              </form>
            )}

            {/* Option 2: AI Rule Generation (Ollama) */}
            {newRuleType === 'ai' && (
              <form onSubmit={handleAIGenerateRule} className="flex flex-col">
                <div className="p-6 flex flex-col gap-4">
                  <span className="text-xs font-bold text-slate-455 uppercase tracking-wide">AI Rule Assistant Prompt</span>
                  
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-slate-400">Describe the detection logic you want to build</label>
                    <textarea 
                      required
                      rows={5}
                      placeholder="Describe in plain English: 'Detect data exfiltration through curl, wget, or scp when compressed files are transferred externally.'"
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                      className="w-full bg-slate-955 border border-slate-800 rounded-lg p-3 text-xs text-slate-100 placeholder-slate-655 focus:outline-none focus:border-purple-500 transition resize-none"
                    />
                  </div>

                  {aiError && (
                    <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-400 text-xs font-medium flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      {aiError}
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-slate-855 bg-slate-955/40 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setNewRuleType(null)
                      setAiError('')
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold active:scale-95 transition"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={aiGenerating}
                    className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white text-xs font-semibold shadow-md active:scale-95 transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {aiGenerating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Generating ruleset...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Generate with Ollama
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  )
}
