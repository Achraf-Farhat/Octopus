import React, { useEffect, useState, useMemo } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'
import {
  Laptop,
  Activity,
  Cpu,
  Layers,
  Network,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  HardDrive
} from 'lucide-react'

export default function Endpoints() {
  const [endpoints, setEndpoints] = useState([])
  const [selectedEndpoint, setSelectedEndpoint] = useState(null)
  const [selectedDetails, setSelectedDetails] = useState(null)
  
  // Tab states: 'overview', 'network', 'processes', 'packages'
  const [activeTab, setActiveTab] = useState('overview')
  
  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'active', 'disconnected', 'never_connected'
  
  // Loading and error states
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [error, setError] = useState('')
  
  // Processes sub-tab pagination/filter
  const [processesList, setProcessesList] = useState([])
  const [processesTotal, setProcessesTotal] = useState(0)
  const [processesPage, setProcessesPage] = useState(1)
  const [processesSearch, setProcessesSearch] = useState('')
  const [loadingProcesses, setLoadingProcesses] = useState(false)
  
  // Packages sub-tab pagination/filter
  const [packagesList, setPackagesList] = useState([])
  const [packagesTotal, setPackagesTotal] = useState(0)
  const [packagesPage, setPackagesPage] = useState(1)
  const [packagesSearch, setPackagesSearch] = useState('')
  const [loadingPackages, setLoadingPackages] = useState(false)

  // Network interface state
  const [netinterfaces, setNetinterfaces] = useState([])
  const [loadingNet, setLoadingNet] = useState(false)

  // Fetch endpoints list
  async function loadEndpoints() {
    setLoadingList(true)
    setError('')
    try {
      const response = await api.get('/endpoints')
      const items = response.data ?? []
      setEndpoints(items)
      
      // Select first endpoint by default if nothing selected yet
      if (items.length > 0 && !selectedEndpoint) {
        handleSelectEndpoint(items[0])
      }
    } catch (err) {
      setError('Failed to fetch endpoints list.')
    } finally {
      setLoadingList(false)
    }
  }

  // Select Endpoint
  async function handleSelectEndpoint(endpoint) {
    setSelectedEndpoint(endpoint)
    setLoadingDetails(true)
    setActiveTab('overview')
    
    // Reset secondary tabs pagination
    setProcessesPage(1)
    setProcessesSearch('')
    setPackagesPage(1)
    setPackagesSearch('')
    
    try {
      const detailsResp = await api.get(`/endpoints/${endpoint.id}`)
      setSelectedDetails(detailsResp.data)
    } catch (err) {
      setError(`Failed to load details for endpoint ${endpoint.name}.`)
    } finally {
      setLoadingDetails(false)
    }
  }

  // Fetch interfaces when Network tab is selected
  async function loadNetworkInterfaces(endpointId) {
    setLoadingNet(true)
    try {
      const resp = await api.get(`/endpoints/${endpointId}/netiface`)
      setNetinterfaces(resp.data ?? [])
    } catch (err) {
      setNetinterfaces([])
    } finally {
      setLoadingNet(false)
    }
  }

  // Fetch processes
  async function loadProcesses(endpointId, pageNum = 1, searchVal = '') {
    setLoadingProcesses(true)
    const limit = 50
    const offset = (pageNum - 1) * limit
    try {
      // Wazuh agent syscollector endpoint
      const resp = await api.get(`/endpoints/${endpointId}/processes`, {
        params: { limit, offset }
      })
      setProcessesList(resp.data?.items ?? [])
      setProcessesTotal(resp.data?.total ?? 0)
      setProcessesPage(pageNum)
    } catch (err) {
      setProcessesList([])
      setProcessesTotal(0)
    } finally {
      setLoadingProcesses(false)
    }
  }

  // Fetch packages
  async function loadPackages(endpointId, pageNum = 1, searchVal = '') {
    setLoadingPackages(true)
    const limit = 50
    const offset = (pageNum - 1) * limit
    try {
      const resp = await api.get(`/endpoints/${endpointId}/packages`, {
        params: { limit, offset }
      })
      setPackagesList(resp.data?.items ?? [])
      setPackagesTotal(resp.data?.total ?? 0)
      setPackagesPage(pageNum)
    } catch (err) {
      setPackagesList([])
      setPackagesTotal(0)
    } finally {
      setLoadingPackages(false)
    }
  }

  // Trigger loading tab details
  useEffect(() => {
    if (!selectedEndpoint) return
    
    if (activeTab === 'network') {
      loadNetworkInterfaces(selectedEndpoint.id)
    } else if (activeTab === 'processes') {
      loadProcesses(selectedEndpoint.id, 1, processesSearch)
    } else if (activeTab === 'packages') {
      loadPackages(selectedEndpoint.id, 1, packagesSearch)
    }
  }, [activeTab, selectedEndpoint])

  // Load list on mount
  useEffect(() => {
    loadEndpoints()
  }, [])

  // Filter and sort endpoints list
  const filteredEndpoints = useMemo(() => {
    return endpoints.filter(ep => {
      const matchesSearch = 
        ep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.id.includes(searchQuery) ||
        (ep.ip && ep.ip.includes(searchQuery))
        
      const matchesStatus = 
        statusFilter === 'all' || 
        ep.status === statusFilter
        
      return matchesSearch && matchesStatus
    })
  }, [endpoints, searchQuery, statusFilter])

  // Helpers for formatting
  const formatRAM = (kb) => {
    if (!kb) return '—'
    const gb = kb / (1024 * 1024)
    return `${gb.toFixed(1)} GB`
  }

  const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return '—'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let val = bytes
    let unitIdx = 0
    while (val >= 1024 && unitIdx < units.length - 1) {
      val /= 1024
      unitIdx++
    }
    return `${val.toFixed(1)} ${units[unitIdx]}`
  }

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-140px)] w-full overflow-hidden border border-slate-800/60 rounded-xl bg-slate-950/60 backdrop-blur-md text-slate-100 font-sans shadow-2xl relative">
        <style>{`
          .endpoints-tab-btn {
            background-color: transparent !important;
            border-bottom: 2px solid transparent !important;
            border-radius: 0px !important;
            box-shadow: none !important;
            color: #94a3b8 !important;
          }
          .endpoints-tab-btn.active {
            border-bottom-color: #3b82f6 !important;
            color: #3b82f6 !important;
          }
          .endpoints-tab-btn:hover {
            color: #f1f5f9 !important;
            background-color: transparent !important;
          }
        `}</style>

        {/* Sidebar Left: Endpoints List */}
        <aside className="w-80 border-r border-slate-800/80 bg-slate-950/90 flex flex-col flex-shrink-0 h-full overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Laptop className="w-5 h-5 text-slate-400" />
              <span className="font-semibold text-sm tracking-wide uppercase text-slate-300">Endpoints</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 border border-slate-800 text-slate-400">
                {filteredEndpoints.length}
              </span>
            </div>
            <button 
              onClick={loadEndpoints} 
              className="p-1 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-850 hover:text-white"
              title="Refresh endpoints"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Search */}
          <div className="p-3 border-b border-slate-800/40 flex flex-col gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search name, IP, ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900/80 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
              />
            </div>

            {/* Filter status */}
            <div className="flex items-center gap-1.5 text-slate-400 select-none overflow-x-auto no-scrollbar">
              {['all', 'active', 'disconnected'].map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-2.5 py-1 text-[9px] font-bold uppercase rounded-md border tracking-wider transition ${
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

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/30">
            {loadingList ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                Loading endpoints inventory...
              </div>
            ) : filteredEndpoints.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
                <HelpCircle className="w-5 h-5 text-slate-600" />
                No endpoints found.
              </div>
            ) : (
              filteredEndpoints.map(ep => {
                const isSelected = selectedEndpoint?.id === ep.id
                return (
                  <div
                    key={ep.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectEndpoint(ep)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelectEndpoint(ep)
                      }
                    }}
                    className={`p-3.5 text-xs flex flex-col gap-1.5 cursor-pointer transition select-none ${
                      isSelected 
                        ? 'bg-blue-950/40 border-l-2 border-blue-500 text-blue-100' 
                        : 'hover:bg-slate-900/50 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 truncate pr-2">{ep.name}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full border ${
                        ep.status === 'active' 
                          ? 'bg-green-950/80 border-green-800 text-green-400' 
                          : 'bg-red-950/80 border-red-800 text-red-400'
                      }`}>
                        {ep.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-500">
                      <span>ID: {ep.id} • {ep.ip || '127.0.0.1'}</span>
                      <span className="truncate max-w-[90px]">{ep.os?.name || 'Linux'}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* Detail Pane Right */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950/40">
          {selectedEndpoint ? (
            <>
              {/* Header Details */}
              <div className="p-4 border-b border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950/80">
                <div className="flex items-center gap-3">
                  <Laptop className="w-8 h-8 text-blue-400 bg-blue-950/50 border border-blue-800/50 p-1.5 rounded-lg flex-shrink-0" />
                  <div>
                    <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                      {selectedEndpoint.name}
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        selectedEndpoint.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                      }`} />
                    </h2>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      Agent ID: {selectedEndpoint.id} • IP Address: {selectedEndpoint.ip || '127.0.0.1'}
                    </p>
                  </div>
                </div>

                {/* Sub-Tabs Selector */}
                <div className="flex border-b border-slate-800/40 md:border-b-0 self-stretch md:self-auto">
                  {([
                    { id: 'overview', label: 'Overview', icon: Laptop },
                    { id: 'network', label: 'Network', icon: Network },
                    { id: 'processes', label: 'Processes', icon: Activity },
                    { id: 'packages', label: 'Packages', icon: Layers }
                  ]).map(tab => {
                    const IconComp = tab.icon
                    const isActive = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`endpoints-tab-btn flex items-center gap-1.5 px-4 py-2 text-xs font-semibold tracking-wide border-b-2 active:scale-95 transition ${
                          isActive ? 'active' : ''
                        }`}
                      >
                        <IconComp className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 overflow-y-auto p-5">
                {loadingDetails ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                    <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                    <span>Fetching endpoint specs...</span>
                  </div>
                ) : (
                  <>
                    {/* Tab 1: Overview */}
                    {activeTab === 'overview' && selectedDetails && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        {/* OS / System Details */}
                        <div className="border border-slate-800/50 bg-slate-900/40 p-4 rounded-xl flex flex-col gap-4">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Laptop className="w-4 h-4 text-blue-400" /> System Specs
                          </h3>
                          <div className="grid grid-cols-2 gap-y-3.5 gap-x-2 text-xs">
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">OS Name</div>
                              <div className="text-slate-200 mt-0.5">{selectedDetails.os?.name || selectedDetails.general?.os?.name || 'Linux'}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">OS Version</div>
                              <div className="text-slate-200 mt-0.5">{selectedDetails.os?.version || selectedDetails.general?.os?.version || 'n/a'}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">Kernel Release</div>
                              <div className="text-slate-200 font-mono mt-0.5">{selectedDetails.os?.release || selectedDetails.general?.os?.uname?.split(' ')[2] || 'n/a'}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">Architecture</div>
                              <div className="text-slate-200 font-mono mt-0.5">{selectedDetails.os?.architecture || selectedDetails.general?.os?.arch || 'n/a'}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">Wazuh Version</div>
                              <div className="text-slate-200 mt-0.5">{selectedDetails.general?.version || 'n/a'}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">Manager Node</div>
                              <div className="text-slate-200 mt-0.5">{selectedDetails.general?.manager || 'n/a'}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">Registered On</div>
                              <div className="text-slate-200 mt-0.5">
                                {selectedDetails.general?.dateAdd ? new Date(selectedDetails.general.dateAdd).toLocaleString() : 'n/a'}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-[10px] font-semibold uppercase">Last Keep Alive</div>
                              <div className="text-slate-200 mt-0.5">
                                {selectedDetails.general?.lastKeepAlive && !selectedDetails.general.lastKeepAlive.startsWith('9999') 
                                  ? new Date(selectedDetails.general.lastKeepAlive).toLocaleString() 
                                  : 'Wazuh Manager (Always Active)'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Hardware Metrics Details */}
                        <div className="border border-slate-800/50 bg-slate-900/40 p-4 rounded-xl flex flex-col gap-4">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Cpu className="w-4 h-4 text-blue-400" /> Hardware Resources
                          </h3>
                          {selectedDetails.hardware ? (
                            <div className="flex flex-col gap-4 text-xs">
                              {/* CPU info */}
                              <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-900">
                                <div className="text-slate-500 text-[10px] font-semibold uppercase">Processor (CPU)</div>
                                <div className="text-slate-200 font-semibold mt-1">{selectedDetails.hardware.cpu?.name || 'Generic CPU'}</div>
                                <div className="flex gap-4 mt-2 text-slate-400 text-[10px]">
                                  <span>Cores: <strong>{selectedDetails.hardware.cpu?.cores || '—'}</strong></span>
                                  <span>Clock Speed: <strong>{selectedDetails.hardware.cpu?.mhz ? `${selectedDetails.hardware.cpu.mhz} MHz` : '—'}</strong></span>
                                </div>
                              </div>
                              
                              {/* Memory details */}
                              <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-900 flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                  <div className="text-slate-500 text-[10px] font-semibold uppercase">Physical Memory (RAM)</div>
                                  <span className="font-mono text-[10px] font-bold text-blue-400">
                                    {selectedDetails.hardware.ram?.usage ?? 0}% USED
                                  </span>
                                </div>
                                <div className="w-full bg-slate-800 rounded-full h-2">
                                  <div 
                                    className="bg-blue-500 h-2 rounded-full transition-all duration-500" 
                                    style={{ width: `${selectedDetails.hardware.ram?.usage ?? 0}%` }}
                                  />
                                </div>
                                <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                                  <span>Free: <strong>{formatRAM(selectedDetails.hardware.ram?.free)}</strong></span>
                                  <span>Total: <strong>{formatRAM(selectedDetails.hardware.ram?.total)}</strong></span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-10 gap-1">
                              <HelpCircle className="w-5 h-5 text-slate-650" />
                              <span>Syscollector hardware inventory not available.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tab 2: Network */}
                    {activeTab === 'network' && (
                      <div className="border border-slate-800/50 bg-slate-900/40 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-slate-850 flex items-center gap-2">
                          <Network className="w-4 h-4 text-blue-400" />
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Network Adapters</h3>
                        </div>
                        {loadingNet ? (
                          <div className="p-10 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                            Loading adapters list...
                          </div>
                        ) : netinterfaces.length === 0 ? (
                          <div className="p-10 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
                            <HelpCircle className="w-5 h-5 text-slate-600" />
                            No network interfaces inventory found.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left">
                              <thead className="bg-slate-950/60 border-b border-slate-850 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                                <tr>
                                  <th className="p-3">Interface Name</th>
                                  <th className="p-3">State</th>
                                  <th className="p-3">MAC Address</th>
                                  <th className="p-3">MTU</th>
                                  <th className="p-3">Received (RX)</th>
                                  <th className="p-3">Transmitted (TX)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-850">
                                {netinterfaces.map((net, i) => (
                                  <tr key={i} className="hover:bg-slate-900/30">
                                    <td className="p-3 font-semibold text-slate-200">{net.name}</td>
                                    <td className="p-3">
                                      <span className={`px-1.5 py-0.2 text-[9px] font-bold rounded border ${
                                        net.state === 'up' 
                                          ? 'bg-green-950 border-green-800 text-green-400' 
                                          : 'bg-slate-900 border-slate-800 text-slate-400'
                                      }`}>
                                        {net.state?.toUpperCase() || 'DOWN'}
                                      </span>
                                    </td>
                                    <td className="p-3 font-mono text-slate-300">{net.mac || '—'}</td>
                                    <td className="p-3 text-slate-300">{net.mtu || '—'}</td>
                                    <td className="p-3 text-slate-300">
                                      {net.rx?.bytes ? `${formatBytes(net.rx.bytes)} (${net.rx.packets} pkts)` : '—'}
                                    </td>
                                    <td className="p-3 text-slate-300">
                                      {net.tx?.bytes ? `${formatBytes(net.tx.bytes)} (${net.tx.packets} pkts)` : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 3: Processes */}
                    {activeTab === 'processes' && (
                      <div className="border border-slate-800/50 bg-slate-900/40 rounded-xl overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-850 flex items-center justify-between gap-4 bg-slate-950/20">
                          <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-blue-400" />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Running Processes</h3>
                          </div>
                          
                          {/* Search Processes */}
                          <div className="relative w-56">
                            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                            <input
                              type="text"
                              placeholder="Search processes..."
                              value={processesSearch}
                              onChange={e => {
                                setProcessesSearch(e.target.value)
                                setProcessesPage(1)
                                loadProcesses(selectedEndpoint.id, 1, e.target.value)
                              }}
                              className="w-full bg-slate-900 border border-slate-800 rounded-md pl-8 pr-3 py-1 text-[11px] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        {loadingProcesses ? (
                          <div className="p-10 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                            Loading processes...
                          </div>
                        ) : processesList.length === 0 ? (
                          <div className="p-10 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
                            <HelpCircle className="w-5 h-5 text-slate-600" />
                            No running processes found.
                          </div>
                        ) : (
                          <>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs text-left">
                                <thead className="bg-slate-950/60 border-b border-slate-850 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                                  <tr>
                                    <th className="p-3 w-16">PID</th>
                                    <th className="p-3 w-40">Process Name</th>
                                    <th className="p-3 w-20">State</th>
                                    <th className="p-3">Command / Execution Path</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-850">
                                  {processesList
                                    .filter(p => p.name?.toLowerCase().includes(processesSearch.toLowerCase()))
                                    .map((proc, i) => (
                                      <tr key={i} className="hover:bg-slate-900/30">
                                        <td className="p-3 font-mono text-slate-400">{proc.pid}</td>
                                        <td className="p-3 font-semibold text-slate-200">{proc.name}</td>
                                        <td className="p-3">
                                          <span className="text-[10px] text-slate-400 font-mono">{proc.state || 'running'}</span>
                                        </td>
                                        <td className="p-3 text-slate-400 truncate max-w-sm font-mono text-[11px]" title={proc.cmd || proc.path}>
                                          {proc.cmd || proc.path || '—'}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Pagination */}
                            <div className="p-3 border-t border-slate-850 flex items-center justify-between text-slate-400 text-xs bg-slate-950/40">
                              <span>Showing {processesList.length} of {processesTotal} processes</span>
                              <div className="flex gap-2">
                                <button
                                  disabled={processesPage === 1}
                                  onClick={() => loadProcesses(selectedEndpoint.id, processesPage - 1, processesSearch)}
                                  className="px-2 py-1 bg-slate-900 border border-slate-800 rounded disabled:opacity-50 hover:text-white"
                                >
                                  Previous
                                </button>
                                <button
                                  disabled={processesPage * 50 >= processesTotal}
                                  onClick={() => loadProcesses(selectedEndpoint.id, processesPage + 1, processesSearch)}
                                  className="px-2 py-1 bg-slate-900 border border-slate-800 rounded disabled:opacity-50 hover:text-white"
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Tab 4: Packages */}
                    {activeTab === 'packages' && (
                      <div className="border border-slate-800/50 bg-slate-900/40 rounded-xl overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-850 flex items-center justify-between gap-4 bg-slate-950/20">
                          <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-blue-400" />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Installed Packages</h3>
                          </div>
                          
                          {/* Search Packages */}
                          <div className="relative w-56">
                            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                            <input
                              type="text"
                              placeholder="Search packages..."
                              value={packagesSearch}
                              onChange={e => {
                                setPackagesSearch(e.target.value)
                                setPackagesPage(1)
                                loadPackages(selectedEndpoint.id, 1, e.target.value)
                              }}
                              className="w-full bg-slate-900 border border-slate-800 rounded-md pl-8 pr-3 py-1 text-[11px] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        {loadingPackages ? (
                          <div className="p-10 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                            Loading software registry...
                          </div>
                        ) : packagesList.length === 0 ? (
                          <div className="p-10 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
                            <HelpCircle className="w-5 h-5 text-slate-600" />
                            No packages found.
                          </div>
                        ) : (
                          <>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs text-left">
                                <thead className="bg-slate-950/60 border-b border-slate-850 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                                  <tr>
                                    <th className="p-3">Package Name</th>
                                    <th className="p-3">Version</th>
                                    <th className="p-3">Architecture</th>
                                    <th className="p-3">Vendor / Source</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-850">
                                  {packagesList
                                    .filter(p => p.name?.toLowerCase().includes(packagesSearch.toLowerCase()))
                                    .map((pkg, i) => (
                                      <tr key={i} className="hover:bg-slate-900/30">
                                        <td className="p-3 font-semibold text-slate-200">{pkg.name}</td>
                                        <td className="p-3 font-mono text-slate-300">{pkg.version}</td>
                                        <td className="p-3 text-slate-400">{pkg.architecture || '—'}</td>
                                        <td className="p-3 text-slate-400">{pkg.vendor || pkg.format || '—'}</td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Pagination */}
                            <div className="p-3 border-t border-slate-850 flex items-center justify-between text-slate-400 text-xs bg-slate-950/40">
                              <span>Showing {packagesList.length} of {packagesTotal} packages</span>
                              <div className="flex gap-2">
                                <button
                                  disabled={packagesPage === 1}
                                  onClick={() => loadPackages(selectedEndpoint.id, packagesPage - 1, packagesSearch)}
                                  className="px-2 py-1 bg-slate-900 border border-slate-800 rounded disabled:opacity-50 hover:text-white"
                                >
                                  Previous
                                </button>
                                <button
                                  disabled={packagesPage * 50 >= packagesTotal}
                                  onClick={() => loadPackages(selectedEndpoint.id, packagesPage + 1, packagesSearch)}
                                  className="px-2 py-1 bg-slate-900 border border-slate-800 rounded disabled:opacity-50 hover:text-white"
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-1.5 p-8">
              <Laptop className="w-12 h-12 text-slate-700 animate-pulse" />
              <span className="font-semibold text-sm">Select an Endpoint</span>
              <p className="text-xs text-slate-600">Choose a device from the left sidebar to view its specifications.</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
