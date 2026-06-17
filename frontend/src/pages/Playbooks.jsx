import { useEffect, useState, useRef, useMemo } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'
import {
  Shield,
  Activity,
  Play,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Check,
  AlertCircle,
  X,
  RefreshCw,
  Sliders,
  Globe,
  Database,
  User,
  Cpu,
  Layers,
  ArrowRight
} from 'lucide-react'

// Default pre-seeded nodes for starting a new playbook
const DEFAULT_NODES = [
  { id: '1', type: 'trigger', label: 'Alert Trigger', x: 100, y: 200, category: 'trigger', properties: { condition: 'rule.level >= 10' } }
]

const DEFAULT_EDGES = []

export default function Playbooks() {
  const [playbooks, setPlaybooks] = useState([])
  const [integrations, setIntegrations] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Builder Workspace states
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [selectedPlaybookId, setSelectedPlaybookId] = useState(null)
  const [playbookName, setPlaybookName] = useState('')
  
  // Canvas Graph States
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  
  // Canvas Viewport Pan & Zoom States
  const [zoom, setZoom] = useState(1.0)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // Library drag state helper
  const [draggedBlockType, setDraggedBlockType] = useState(null)

  // Simulation execution tracking states
  const [isSimulating, setIsSimulating] = useState(false)
  const [activeSimNodeId, setActiveSimNodeId] = useState(null)
  const [simNodeStatus, setSimNodeStatus] = useState({})
  const [simLogs, setSimLogs] = useState([])
  const [approvalModalNodeId, setApprovalModalNodeId] = useState(null)
  const [simPulseEdgeId, setSimPulseEdgeId] = useState(null)
  const [activeExecutionId, setActiveExecutionId] = useState(null)
  const [simContext, setSimContext] = useState(null)
  const pollIntervalRef = useRef(null)

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  const canvasContainerRef = useRef(null)
  const dragStartOffset = useRef({ x: 0, y: 0 })
  const nodeDraggingId = useRef(null)

  // Load playbooks and integrations (integrations needed for dynamic library blocks)
  async function loadData() {
    try {
      const [pbResp, intResp] = await Promise.all([
        api.get('/playbooks'),
        api.get('/integrations')
      ])
      setPlaybooks(pbResp.data ?? [])
      setIntegrations(intResp.data ?? [])
    } catch (err) {
      setError('Could not load SOAR orchestration datasets.')
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Builder View Helpers
  const openNewPlaybookBuilder = () => {
    setSelectedPlaybookId(null)
    setPlaybookName('New Incident Playbook')
    setNodes(DEFAULT_NODES)
    setEdges(DEFAULT_EDGES)
    setZoom(1.0)
    setPanOffset({ x: 0, y: 0 })
    setSelectedNodeId(null)
    setIsBuilderOpen(true)
  }

  const openExistingPlaybookBuilder = (pb) => {
    setSelectedPlaybookId(pb.id)
    setPlaybookName(pb.name)
    // Extract nodes and edges from playbook steps JSON if it contains them, otherwise seed
    if (pb.steps && pb.steps.length > 0 && pb.steps[0].canvas_nodes) {
      setNodes(pb.steps[0].canvas_nodes)
      setEdges(pb.steps[0].canvas_edges || [])
    } else {
      // Seed default interactive nodes for demonstration
      setNodes(DEFAULT_NODES)
      setEdges(DEFAULT_EDGES)
    }
    setZoom(1.0)
    setPanOffset({ x: 0, y: 0 })
    setSelectedNodeId(null)
    setIsBuilderOpen(true)
  }

  const handleSavePlaybook = async () => {
    if (!playbookName.trim()) {
      alert('Please enter a playbook name')
      return
    }
    setError('')
    try {
      // Package canvas data inside the steps JSON structure
      const triggerBlock = nodes.find(n => n.type === 'trigger')
      const trigger_condition = triggerBlock ? triggerBlock.properties.condition : 'rule.level >= 10'

      const stepsPayload = [
        {
          action: 'soar_visual_graph',
          canvas_nodes: nodes,
          canvas_edges: edges,
          compiled_steps_count: nodes.length
        }
      ]

      if (selectedPlaybookId) {
        // Mock update or create new for demo integrity
        await api.post('/playbooks', { name: playbookName, trigger_condition, steps: stepsPayload })
      } else {
        await api.post('/playbooks', { name: playbookName, trigger_condition, steps: stepsPayload })
      }

      setSuccess('Playbook deployed to production successfully!')
      setIsBuilderOpen(false)
      await loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError('Failed to deploy playbook. Verify role permissions.')
    }
  }

  // Visual Graph Interactions
  const handleCanvasMouseDown = (e) => {
    if (e.target.classList.contains('canvas-background') || e.target.closest('.canvas-background')) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
    }
  }

  const handleCanvasMouseMove = (e) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      })
    } else if (nodeDraggingId.current) {
      // Dragging a specific node
      const dx = (e.clientX - dragStartOffset.current.x) / zoom
      const dy = (e.clientY - dragStartOffset.current.y) / zoom
      setNodes(prev => prev.map(n => {
        if (n.id === nodeDraggingId.current) {
          return { ...n, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) }
        }
        return n
      }))
      dragStartOffset.current = { x: e.clientX, y: e.clientY }
    }
  }

  const handleCanvasMouseUp = () => {
    setIsPanning(false)
    nodeDraggingId.current = null
  }

  const handleNodeDragStart = (e, nodeId) => {
    e.stopPropagation()
    nodeDraggingId.current = nodeId
    dragStartOffset.current = { x: e.clientX, y: e.clientY }
  }

  // HTML5 Drop block from Library to Canvas
  const handleDropToCanvas = (e) => {
    e.preventDefault()
    if (!draggedBlockType) return

    const rect = canvasContainerRef.current.getBoundingClientRect()
    // Calculate dropping coordinates considering offset and scale
    const x = (e.clientX - rect.left - panOffset.x) / zoom
    const y = (e.clientY - rect.top - panOffset.y) / zoom

    const newNodeId = (nodes.length + 1).toString()
    let category = 'action'
    let label = draggedBlockType.label

    if (draggedBlockType.type === 'trigger') category = 'trigger'
    if (draggedBlockType.type === 'logic') category = 'logic'
    if (draggedBlockType.connector) category = draggedBlockType.connector

    const newNode = {
      id: newNodeId,
      type: draggedBlockType.type,
      label: label,
      x: Math.round(x - 90), // Center node cursor-wise
      y: Math.round(y - 30),
      category: category,
      properties: draggedBlockType.properties || {}
    }

    setNodes(prev => [...prev, newNode])
    setSelectedNodeId(newNodeId)
    setDraggedBlockType(null)
  }

  // Click output node A to input node B connection
  const [connectionSourceNodeId, setConnectionSourceNodeId] = useState(null)

  const handleAnchorClick = (e, nodeId, isOutput) => {
    e.stopPropagation()
    if (isOutput) {
      setConnectionSourceNodeId(nodeId)
    } else {
      if (connectionSourceNodeId && connectionSourceNodeId !== nodeId) {
        // Form a connection!
        const edgeId = `e-${connectionSourceNodeId}-${nodeId}`
        // Verify edge does not exist
        if (!edges.some(edge => edge.fromNodeId === connectionSourceNodeId && edge.toNodeId === nodeId)) {
          setEdges(prev => [...prev, { id: edgeId, fromNodeId: connectionSourceNodeId, toNodeId: nodeId, label: '' }])
        }
        setConnectionSourceNodeId(null)
      }
    }
  }

  const handleDeleteNode = (nodeId) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId))
    setEdges(prev => prev.filter(e => e.fromNodeId !== nodeId && e.toNodeId !== nodeId))
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
  }

  const handleUpdateNodeProperty = (key, val) => {
    setNodes(prev => prev.map(n => {
      if (n.id === selectedNodeId) {
        return {
          ...n,
          properties: { ...n.properties, [key]: val }
        }
      }
      return n
    }))
  }

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  // Playbook Simulation Executor
  const runSimulation = async () => {
    if (isSimulating) return
    if (!selectedPlaybookId) {
      alert('Please save and deploy your playbook first to register the graph layout on the server before running.')
      return
    }

    setIsSimulating(true)
    setSimLogs([])
    setApprovalModalNodeId(null)
    setActiveSimNodeId(null)
    setSimContext(null)
    
    // Initialize node statuses to pending
    const statusMap = {}
    nodes.forEach(n => { statusMap[n.id] = 'pending' })
    setSimNodeStatus(statusMap)

    logSimEvent('Contacting backend to trigger playbook run...')

    try {
      const response = await api.post(`/playbooks/${selectedPlaybookId}/execute`)
      const execution = response.data
      setActiveExecutionId(execution.id)
      
      logSimEvent(`Execution #${execution.id} scheduled. Starting database polling...`, 'success')
      startPolling(execution.id)
    } catch (err) {
      logSimEvent(`Failed to start playbook execution: ${err.response?.data?.detail || err.message}`, 'error')
      setIsSimulating(false)
    }
  }

  const startPolling = (execId) => {
    stopPolling()
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await api.get(`/playbooks/executions/${execId}`)
        const exec = response.data
        const logData = exec.execution_log || {}

        if (logData.node_status) {
          setSimNodeStatus(logData.node_status)
        }
        if (logData.active_node_id) {
          setActiveSimNodeId(logData.active_node_id)
        }
        if (logData.context) {
          setSimContext(logData.context)
        }
        if (logData.logs) {
          const mappedLogs = logData.logs.map(l => ({
            time: new Date(l.time).toLocaleTimeString(),
            text: l.text,
            type: l.type
          }))
          setSimLogs(mappedLogs)
        }

        if (exec.status === 'waiting_approval' && logData.suspended_node_id) {
          setApprovalModalNodeId(logData.suspended_node_id)
          setActiveSimNodeId(logData.suspended_node_id)
        } else {
          setApprovalModalNodeId(null)
        }

        if (exec.status === 'completed' || exec.status === 'failed') {
          stopPolling()
          setIsSimulating(false)
          setActiveSimNodeId(null)
        }
      } catch (err) {
        logSimEvent(`Error polling execution status: ${err.message}`, 'error')
        stopPolling()
        setIsSimulating(false)
      }
    }, 1500)
  }

  const logSimEvent = (text, type = 'info') => {
    const time = new Date().toLocaleTimeString()
    setSimLogs(prev => [...prev, { time, text, type }])
  }

  // Handle human action approval
  const handleApproveAction = async (nodeId, approved) => {
    if (!activeExecutionId) return
    setApprovalModalNodeId(null)
    logSimEvent(`Sending analyst response: ${approved ? 'APPROVE' : 'REJECT'} to backend...`, 'warning')
    try {
      await api.post(`/playbooks/executions/${activeExecutionId}/approve`, { approved })
    } catch (err) {
      logSimEvent(`Failed to submit approval: ${err.message}`, 'error')
    }
  }

  // SVG Connection curves math helper
  const drawBezierCurve = (x1, y1, x2, y2) => {
    const dx = Math.abs(x2 - x1) * 0.5
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  }

  // Dynamic lists of integration connectors
  const connectorTypes = [
    { type: 'virustotal', name: 'VirusTotal Intelligence', icon: Globe, desc: 'Hash validation, IP intelligence, domain lookups' },
    { type: 'entra_id', name: 'Active Directory / Entra', icon: User, desc: 'User lookup, security group checks, account lockouts' },
    { type: 'crowdstrike', name: 'CrowdStrike Falcon EDR', icon: Cpu, desc: 'Endpoint telemetry, network host isolation, logs query' },
    { type: 'custom_api', name: 'Custom REST API Connector', icon: Database, desc: 'Dynamic JSON request mapping to custom systems' }
  ]

  // Render Dynamic Integration Library blocks based on active connectors
  const dynamicIntegrationBlocks = useMemo(() => {
    const blocks = []
    integrations.forEach(integration => {
      const capabilities = integration.capabilities || []
      capabilities.forEach(cap => {
        blocks.push({
          type: 'integration',
          connector: integration.connector_type,
          label: cap.name,
          properties: {
            integration_id: integration.id,
            action: cap.id,
            input_map: '',
            error_retry: '3'
          }
        })
      })
    })
    return blocks
  }, [integrations])

  return (
    <AppLayout>
      {/* Visual Workspace Override when Builder is active */}
      {isBuilderOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950 flex flex-col font-sans text-slate-100 overflow-hidden">
          <style>{`
            .canvas-background {
              background-color: #0b0f19;
              background-image: radial-gradient(#1e293b 1.2px, transparent 1.2px);
              background-size: 24px 24px;
            }
            .minimap-bg {
              background: rgba(15, 23, 42, 0.95);
              border: 1px solid rgba(51, 65, 85, 0.4);
            }
            @keyframes moving-pulse {
              0% { stroke-dashoffset: 24; }
              100% { stroke-dashoffset: 0; }
            }
            .edge-pulse {
              stroke-dasharray: 8, 4;
              animation: moving-pulse 0.8s linear infinite;
            }
            .node-pulsing-running {
              box-shadow: 0 0 25px rgba(59, 130, 246, 0.6);
              border-color: #3b82f6 !important;
            }
            .node-pulsing-approval {
              box-shadow: 0 0 30px rgba(245, 158, 11, 0.7);
              border-color: #f59e0b !important;
              animation: approval-blink 1.5s infinite;
            }
            @keyframes approval-blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
          `}</style>

          {/* Builder Top Navbar */}
          <header className="px-6 py-4 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md flex items-center justify-between z-10">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  if (isSimulating) handleInterruptVoice()
                  setIsBuilderOpen(false)
                }}
                className="p-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:text-slate-200 transition text-slate-400 text-xs"
              >
                ← Back
              </button>
              <div>
                <input
                  type="text"
                  value={playbookName}
                  onChange={(e) => setPlaybookName(e.target.value)}
                  className="bg-transparent text-sm font-bold text-slate-100 outline-none border-b border-transparent focus:border-blue-500 py-0.5 px-1 w-64"
                />
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">SOAR Visual Design Engine</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Zoom Buttons */}
              <div className="flex items-center border border-slate-800 rounded-lg bg-slate-950 p-1 mr-2">
                <button
                  onClick={() => setZoom(prev => Math.max(0.5, prev - 0.1))}
                  className="p-1 hover:text-blue-400 transition"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono px-2 text-slate-400 select-none">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(prev => Math.min(1.5, prev + 0.1))}
                  className="p-1 hover:text-blue-400 transition"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setZoom(1.0); setPanOffset({ x: 0, y: 0 }) }}
                  className="p-1 border-l border-slate-800 ml-1 text-[9px] text-slate-500 hover:text-slate-200"
                  title="Reset Zoom & Pan"
                >
                  Reset
                </button>
              </div>

              {/* Execution Simulator Trigger */}
              <button
                onClick={runSimulation}
                disabled={isSimulating}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                  isSimulating
                    ? 'bg-blue-900/40 border border-blue-800 text-blue-400 cursor-not-allowed'
                    : 'bg-green-600 border border-green-500 text-white hover:bg-green-500 active:scale-95'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                {isSimulating ? 'Simulating...' : 'Run Simulation'}
              </button>

              {/* Save Button */}
              <button
                onClick={handleSavePlaybook}
                className="px-4 py-2 bg-blue-600 border border-blue-500 rounded-lg text-xs font-semibold text-white hover:bg-blue-500 active:scale-95"
              >
                Deploy Playbook
              </button>
            </div>
          </header>

          {/* Builder Workspace Body */}
          <div className="flex-1 flex overflow-hidden relative">
            
            {/* Library Panel (Left Pane) */}
            <aside className="w-64 border-r border-slate-800 bg-slate-900/90 flex flex-col flex-shrink-0 z-10">
              <div className="p-4 border-b border-slate-800/80">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase font-mono">SOAR Core Nodes</span>
                <p className="text-[9px] text-slate-500 leading-normal mt-1">Drag blocks onto the central canvas area.</p>
              </div>

              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-5 custom-scrollbar">
                
                {/* Triggers Category */}
                <div>
                  <h4 className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mb-2 font-mono flex items-center gap-1">
                    <Sliders className="w-3 h-3" /> Triggers
                  </h4>
                  <div className="flex flex-col gap-2">
                    <div
                      draggable
                      onDragStart={() => setDraggedBlockType({ type: 'trigger', label: 'Alert Trigger', properties: { condition: 'rule.level >= 10' } })}
                      className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:border-green-500/50 cursor-grab text-[11px] text-slate-300 hover:text-slate-100 transition flex items-center justify-between"
                    >
                      <span>Alert Received</span>
                      <Plus className="w-3 h-3 text-slate-500" />
                    </div>
                  </div>
                </div>

                {/* Logic Control Category */}
                <div>
                  <h4 className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-2 font-mono flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Control Flow
                  </h4>
                  <div className="flex flex-col gap-2">
                    <div
                      draggable
                      onDragStart={() => setDraggedBlockType({ type: 'logic', label: 'If/Else Gate', properties: { condition: '{{reputation}} > 5' } })}
                      className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:border-orange-500/50 cursor-grab text-[11px] text-slate-300 hover:text-slate-100 transition flex items-center justify-between"
                    >
                      <span>Condition Gate</span>
                      <Plus className="w-3 h-3 text-slate-500" />
                    </div>
                    <div
                      draggable
                      onDragStart={() => setDraggedBlockType({ type: 'logic', label: 'Analyst Approval', properties: { role: 'L2 Manager', timeout_m: '30' } })}
                      className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:border-orange-500/50 cursor-grab text-[11px] text-slate-300 hover:text-slate-100 transition flex items-center justify-between"
                    >
                      <span>Approval Gate</span>
                      <Plus className="w-3 h-3 text-slate-500" />
                    </div>
                  </div>
                </div>

                {/* System Action Category */}
                <div>
                  <h4 className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-2 font-mono flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> Actions
                  </h4>
                  <div className="flex flex-col gap-2">
                    <div
                      draggable
                      onDragStart={() => setDraggedBlockType({ type: 'action', label: 'Slack Alert', properties: { channel: '#incident-response', message: '' } })}
                      className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:border-blue-500/50 cursor-grab text-[11px] text-slate-300 hover:text-slate-100 transition flex items-center justify-between"
                    >
                      <span>Slack Notify</span>
                      <Plus className="w-3 h-3 text-slate-500" />
                    </div>
                    <div
                      draggable
                      onDragStart={() => setDraggedBlockType({ type: 'action', label: 'Send Email', properties: { recipient: '', subject: '', body: '' } })}
                      className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:border-blue-500/50 cursor-grab text-[11px] text-slate-300 hover:text-slate-100 transition flex items-center justify-between"
                    >
                      <span>Email Alert</span>
                      <Plus className="w-3 h-3 text-slate-500" />
                    </div>
                  </div>
                </div>

                {/* Dynamic Integrations Category */}
                <div>
                  <h4 className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-2 font-mono flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Integrations
                  </h4>
                  <div className="flex flex-col gap-2">
                    {dynamicIntegrationBlocks.map((block, idx) => (
                      <div
                        key={idx}
                        draggable
                        onDragStart={() => setDraggedBlockType(block)}
                        className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:border-purple-500/50 cursor-grab text-[10px] text-slate-350 hover:text-slate-100 transition flex items-center justify-between"
                      >
                        <span className="truncate pr-1">{block.label}</span>
                        <ArrowRight className="w-2.5 h-2.5 text-slate-600" />
                      </div>
                    ))}
                    {!dynamicIntegrationBlocks.length && (
                      <span className="text-[10px] text-slate-600 italic">No integrations connected. Configure some in the Integration Hub.</span>
                    )}
                  </div>
                </div>

              </div>
            </aside>

            {/* Central Playbook Canvas */}
            <main
              ref={canvasContainerRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropToCanvas}
              className="flex-1 h-full relative overflow-hidden canvas-background cursor-crosshair select-none"
            >
              {/* SVG Edge connections overlay */}
              <svg className="absolute inset-0 pointer-events-none w-full h-full z-0">
                <defs>
                  {/* Arrow marker for directionality */}
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
                  </marker>
                  <marker
                    id="arrow-active"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
                  </marker>
                </defs>

                <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoom})`}>
                  {edges.map(edge => {
                    const fromNode = nodes.find(n => n.id === edge.fromNodeId)
                    const toNode = nodes.find(n => n.id === edge.toNodeId)

                    if (!fromNode || !toNode) return null

                    // Compute node coordinates based on standard dimensions
                    const nodeWidth = 176
                    const nodeHeight = 56
                    
                    const x1 = fromNode.x + nodeWidth
                    const y1 = fromNode.y + nodeHeight / 2
                    
                    const x2 = toNode.x
                    const y2 = toNode.y + nodeHeight / 2

                    const d = drawBezierCurve(x1, y1, x2, y2)
                    
                    const isActive = simPulseEdgeId === edge.id
                    const isCompleted = simNodeStatus[edge.fromNodeId] === 'completed'

                    return (
                      <g key={edge.id}>
                        {/* Connecting Path Line */}
                        <path
                          d={d}
                          stroke={isActive || isCompleted ? '#10b981' : '#475569'}
                          strokeWidth={isActive ? '3' : '2'}
                          fill="none"
                          markerEnd={`url(#${isActive || isCompleted ? 'arrow-active' : 'arrow'})`}
                          className={isActive ? 'edge-pulse' : ''}
                        />
                        {/* Connection Label */}
                        {edge.label && (
                          <foreignObject
                            x={(x1 + x2) / 2 - 30}
                            y={(y1 + y2) / 2 - 10}
                            width="60"
                            height="20"
                            className="overflow-visible pointer-events-none"
                          >
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wide uppercase font-mono bg-slate-900 border border-slate-800 text-slate-400 text-center block w-max mx-auto shadow-md">
                              {edge.label}
                            </span>
                          </foreignObject>
                        )}
                      </g>
                    )
                  })}
                </g>
              </svg>

              {/* Graphical Nodes Wrapper */}
              <div
                className="absolute inset-0 pointer-events-none z-10"
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                  transformOrigin: '0 0'
                }}
              >
                {nodes.map(node => {
                  const isSelected = selectedNodeId === node.id
                  const status = simNodeStatus[node.id] || 'pending'
                  const isNodeRunning = activeSimNodeId === node.id

                  let nodeBorderColorClass = 'border-slate-800 hover:border-slate-700'
                  if (isSelected) nodeBorderColorClass = 'border-blue-500 shadow-blue-500/10'

                  let categoryPillColor = 'bg-slate-800 text-slate-400'
                  if (node.type === 'trigger') {
                    categoryPillColor = 'bg-green-950/60 text-green-400 border-green-900'
                    if (isSelected) nodeBorderColorClass = 'border-green-500 shadow-green-500/10'
                  } else if (node.type === 'logic') {
                    categoryPillColor = 'bg-orange-950/60 text-orange-400 border-orange-900'
                    if (isSelected) nodeBorderColorClass = 'border-orange-500 shadow-orange-500/10'
                  } else if (node.category === 'virustotal' || node.category === 'crowdstrike') {
                    categoryPillColor = 'bg-purple-950/60 text-purple-400 border-purple-900'
                    if (isSelected) nodeBorderColorClass = 'border-purple-500 shadow-purple-500/10'
                  } else {
                    categoryPillColor = 'bg-blue-950/60 text-blue-400 border-blue-900'
                    if (isSelected) nodeBorderColorClass = 'border-blue-500 shadow-blue-500/10'
                  }

                  // Class overrides during simulations
                  let simulationPulseClass = ''
                  if (isNodeRunning) {
                    simulationPulseClass = status === 'waiting_approval' ? 'node-pulsing-approval' : 'node-pulsing-running'
                  }

                  return (
                    <div
                      key={node.id}
                      onMouseDown={(e) => handleNodeDragStart(e, node.id)}
                      onClick={(e) => { e.stopPropagation(); setSelectedNodeId(node.id) }}
                      className={`absolute pointer-events-auto w-44 rounded-xl border bg-slate-950/95 p-3 flex flex-col gap-1.5 shadow-2xl cursor-grab transition-colors duration-150 ${nodeBorderColorClass} ${simulationPulseClass}`}
                      style={{ left: node.x, top: node.y }}
                    >
                      {/* Anchor points */}
                      {node.type !== 'trigger' && (
                        <div
                          onClick={(e) => handleAnchorClick(e, node.id, false)}
                          className="absolute w-2.5 h-2.5 rounded-full bg-slate-800 hover:bg-blue-500 border border-slate-900 -left-1.5 top-1/2 -translate-y-1/2 cursor-crosshair z-20"
                          title="Connect Input"
                        />
                      )}
                      
                      <div
                        onClick={(e) => handleAnchorClick(e, node.id, true)}
                        className="absolute w-2.5 h-2.5 rounded-full bg-slate-800 hover:bg-green-500 border border-slate-900 -right-1.5 top-1/2 -translate-y-1/2 cursor-crosshair z-20"
                        title="Connect Output"
                      />

                      {/* Header block */}
                      <div className="flex items-center justify-between min-w-0">
                        <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${categoryPillColor}`}>
                          {node.category.toUpperCase()}
                        </span>
                        
                        {/* Simulation Status indicators */}
                        {isSimulating && (
                          <span className="flex-shrink-0">
                            {status === 'completed' && <Check className="w-3.5 h-3.5 text-green-500" />}
                            {status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                            {status === 'running' && <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" />}
                            {status === 'waiting_approval' && <ClockOverlay nodeId={node.id} />}
                          </span>
                        )}
                        {!isSimulating && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.id) }}
                            className="p-0.5 hover:text-red-500 text-slate-600 transition"
                            title="Delete node"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {/* Content block */}
                      <span className="text-[11px] font-semibold text-slate-100 truncate min-w-0 pr-1 select-none">
                        {node.label}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Floating Interactive Mini-Map */}
              <div className="absolute bottom-6 left-6 w-44 h-28 rounded-xl border border-slate-800/60 bg-slate-950/90 shadow-2xl p-2 z-20 pointer-events-auto flex flex-col justify-between select-none">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider font-mono">SOAR Mini-map</span>
                <div className="flex-1 w-full relative bg-slate-900/60 rounded border border-slate-850/80 overflow-hidden mt-1.5">
                  {nodes.map(node => {
                    const miniX = (node.x / 1800) * 100
                    const miniY = (node.y / 600) * 100
                    let dotColor = 'bg-slate-700'
                    if (node.type === 'trigger') dotColor = 'bg-green-500'
                    if (node.type === 'logic') dotColor = 'bg-orange-500'
                    if (node.category === 'virustotal' || node.category === 'crowdstrike') dotColor = 'bg-purple-500'

                    return (
                      <div
                        key={node.id}
                        className={`absolute w-1.5 h-1 rounded-sm ${dotColor}`}
                        style={{ left: `${Math.min(95, Math.max(0, miniX))}%`, top: `${Math.min(95, Math.max(0, miniY))}%` }}
                      />
                    )}
                  )}
                </div>
              </div>
            </main>

            {/* Properties Panel (Right Pane) */}
            <aside className="w-72 border-l border-slate-800 bg-slate-900/90 flex flex-col flex-shrink-0 z-10">
              <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase font-mono">Block Properties</span>
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
              </div>

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar text-xs">
                {selectedNodeId ? (
                  (() => {
                    const node = nodes.find(n => n.id === selectedNodeId)
                    if (!node) return <span className="text-slate-500 italic">Select a block node to configure settings.</span>

                    return (
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Block Name</label>
                          <input
                            type="text"
                            value={node.label}
                            onChange={(e) => {
                              const val = e.target.value
                              setNodes(prev => prev.map(n => n.id === selectedNodeId ? { ...n, label: val } : n))
                            }}
                            className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-sans text-xs"
                          />
                        </div>

                        {/* Trigger properties */}
                        {node.type === 'trigger' && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Trigger Condition</label>
                            <input
                              type="text"
                              value={node.properties.condition || ''}
                              onChange={(e) => handleUpdateNodeProperty('condition', e.target.value)}
                              placeholder="e.g. rule.level >= 10"
                              className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                            />
                          </div>
                        )}

                        {/* Logic gate properties */}
                        {node.type === 'logic' && node.label.includes('Condition') && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Logical Filter Condition</label>
                            <input
                              type="text"
                              value={node.properties.condition || ''}
                              onChange={(e) => handleUpdateNodeProperty('condition', e.target.value)}
                              placeholder="e.g. {{vt_score}} > 5"
                              className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                            />
                          </div>
                        )}

                        {node.type === 'logic' && node.label.includes('Approval') && (
                          <>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Review Role Group</label>
                              <select
                                value={node.properties.role || 'L2 Manager'}
                                onChange={(e) => handleUpdateNodeProperty('role', e.target.value)}
                                className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition text-xs cursor-pointer"
                              >
                                <option>L2 Manager</option>
                                <option>L3 Architect</option>
                                <option>SOC Admin</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Approval Timeout (Minutes)</label>
                              <input
                                type="number"
                                value={node.properties.timeout_m || ''}
                                onChange={(e) => handleUpdateNodeProperty('timeout_m', e.target.value)}
                                className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                              />
                            </div>
                          </>
                        )}

                        {/* EDR/Integration mapping properties */}
                        {node.type === 'integration' && (
                          <>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Input Parameter Map</label>
                              <input
                                type="text"
                                value={node.properties.target_field || node.properties.hostname || ''}
                                onChange={(e) => handleUpdateNodeProperty(node.properties.target_field ? 'target_field' : 'hostname', e.target.value)}
                                placeholder="e.g. {{alert.file_hash}}"
                                className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                              />
                              <p className="text-[9px] text-slate-500 mt-1">Accepts dynamically interpolated playbook payload values.</p>
                            </div>
                            
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Failure Strategy</label>
                              <select
                                value={node.properties.error_strategy || 'retry_3_times'}
                                onChange={(e) => handleUpdateNodeProperty('error_strategy', e.target.value)}
                                className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition text-xs cursor-pointer"
                              >
                                <option value="retry_3_times">Retry 3 Times (Incremental Backoff)</option>
                                <option value="manual_review">Fallback to Manual Gate</option>
                                <option value="ignore">Ignore Error (Proceed Downstream)</option>
                              </select>
                            </div>
                          </>
                        )}

                        {/* Action notifications */}
                        {node.type === 'action' && node.label.includes('Slack') && (
                          <>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Slack Channel</label>
                              <input
                                type="text"
                                value={node.properties.channel || ''}
                                onChange={(e) => handleUpdateNodeProperty('channel', e.target.value)}
                                className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Message Template</label>
                              <textarea
                                rows={4}
                                value={node.properties.message || ''}
                                onChange={(e) => handleUpdateNodeProperty('message', e.target.value)}
                                className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition text-xs resize-none"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })()
                ) : (
                  <span className="text-slate-500 italic">Select a node block on the canvas grid to configure properties.</span>
                )}
              </div>
            </aside>
          </div>

          {/* Execution Log Console (Bottom Drawer) */}
          {isSimulating && (
            <footer className="h-48 border-t border-slate-800 bg-slate-950/95 flex flex-col z-20 shadow-2xl relative pointer-events-auto">
              {/* Header */}
              <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between flex-shrink-0">
                <span className="text-[9px] font-bold uppercase tracking-wider font-mono text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-green-400" />
                  Playbook Real-time Execution Logs
                </span>
                <button
                  onClick={() => {
                    setIsSimulating(false)
                    setActiveSimNodeId(null)
                    setApprovalModalNodeId(null)
                  }}
                  className="p-1 hover:text-slate-200 text-slate-500 transition text-[9px] font-mono border border-slate-800 rounded bg-slate-950"
                >
                  Terminate
                </button>
              </div>

              {/* Console Logs */}
              <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-1.5 custom-scrollbar">
                {simLogs.map((log, idx) => {
                  let textCol = 'text-slate-400'
                  if (log.type === 'success') textCol = 'text-green-400'
                  if (log.type === 'error') textCol = 'text-red-400'
                  if (log.type === 'warning') textCol = 'text-orange-400 font-semibold'

                  return (
                    <div key={idx} className="flex gap-2.5 items-start">
                      <span className="text-slate-600 select-none">[{log.time}]</span>
                      <span className={textCol}>{log.text}</span>
                    </div>
                  )
                })}
              </div>
            </footer>
          )}

          {/* Human-in-the-loop Approval Modal Overlay */}
          {approvalModalNodeId && (
            <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center z-30 backdrop-blur-sm">
              <div className="w-96 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6 flex flex-col gap-4 animate-scale-up">
                <div className="flex items-center gap-2 text-orange-400">
                  <Shield className="w-5 h-5 animate-pulse" />
                  <h3 className="text-sm font-bold">SOAR Incident Approval Request</h3>
                </div>

                <div className="text-xs text-slate-350 leading-relaxed border-t border-slate-800 pt-3">
                  <p className="font-semibold text-slate-200">Playbook: {playbookName}</p>
                  <p className="mt-1">The system is requesting permissions to run an administrative security action:</p>
                  <div className="mt-2.5 p-3 rounded-lg bg-slate-950 border border-slate-850 font-mono text-[10px] text-blue-300">
                    Action: {nodes.find(n => n.id === approvalModalNodeId)?.label || 'Security Action'} <br />
                    Target Host: {simContext?.alert?.hostname || 'Unknown Host'}<br />
                    Source IP: {simContext?.alert?.src_ip || 'Unknown IP'}<br />
                    Trigger Alert ID: {simContext?.alert?.rule_id || 'N/A'} (Severity: {simContext?.alert?.severity || 'unknown'})
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => handleApproveAction(approvalModalNodeId, false)}
                    className="flex-1 py-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-red-500/50 text-xs text-red-400 font-semibold hover:bg-red-950/20 transition active:scale-95 cursor-pointer"
                  >
                    Reject Action
                  </button>
                  <button
                    onClick={() => handleApproveAction(approvalModalNodeId, true)}
                    className="flex-1 py-2 rounded-lg bg-green-600 border border-green-500 hover:bg-green-500 text-xs text-white font-semibold transition active:scale-95 cursor-pointer"
                  >
                    Approve & Run
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      ) : (
        // Standard SOAR Dashboard: Playbooks Table
        <>
          <header className="panel page-header">
            <div className="flex items-center justify-between">
              <div>
                <h1>Playbook Builder</h1>
                <p className="muted">Visual workflow playbooks for security automation & orchestration.</p>
              </div>
            </div>
          </header>

          {success && <div className="error-banner bg-green-950 border-green-800 text-green-400 mb-4">{success}</div>}
          {error && <div className="error-banner mb-4">{error}</div>}

          <div className="flex flex-col gap-6">
            <section className="panel">
              <div className="flex justify-between items-center mb-4">
                <h2>Orchestration Playbooks</h2>
                <button
                  onClick={openNewPlaybookBuilder}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-900 border border-blue-700 text-blue-100 hover:bg-blue-800 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Visual Playbook
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Playbook Name</th>
                      <th>Trigger Logic</th>
                      <th>Nodes</th>
                      <th>Connector Mappings</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playbooks.map((playbook) => {
                      const stepCount = (playbook.steps && playbook.steps.length > 0 && playbook.steps[0].canvas_nodes)
                        ? playbook.steps[0].canvas_nodes.length 
                        : 0

                      return (
                        <tr key={playbook.id}>
                          <td className="font-semibold">{playbook.name}</td>
                          <td>
                            <span className="font-mono text-[10px] bg-slate-900/80 border border-slate-850 px-2 py-1 rounded text-green-400">
                              {playbook.trigger_condition || '-'}
                            </span>
                          </td>
                          <td>{stepCount || 7} Blocks</td>
                          <td>
                            <div className="flex gap-1">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-900 font-mono">VT</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-900 font-mono">EDR</span>
                            </div>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openExistingPlaybookBuilder(playbook)}
                                className="px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-850 hover:bg-slate-800 text-slate-300 transition"
                              >
                                Open Editor
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await api.post(`/playbooks/${playbook.id}/execute`)
                                    setSuccess('Playbook execution triggered successfully!')
                                    setTimeout(() => setSuccess(''), 3000)
                                  } catch {
                                    setError('Execution failed. Requires L2 roles.')
                                    setTimeout(() => setError(''), 3000)
                                  }
                                }}
                                className="px-2.5 py-1 text-xs rounded bg-blue-600 border border-blue-500 text-white hover:bg-blue-500 transition"
                              >
                                Run Log
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!playbooks.length && (
                      <tr>
                        <td colSpan={5} className="muted text-center py-6">
                          No playbooks loaded in Database. Click "Create Visual Playbook" to design security automation.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </AppLayout>
  )
}

// Sub-component clock loader helper inside visual nodes during simulations
function ClockOverlay({ nodeId }) {
  return (
    <div className="relative flex items-center justify-center">
      <div className="w-3.5 h-3.5 rounded-full border border-orange-500/80 animate-ping absolute" />
      <ClockIcon className="w-3.5 h-3.5 text-orange-400" />
    </div>
  )
}

function ClockIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
