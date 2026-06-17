import { useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout'
import api from '../lib/api'
import {
  Plus,
  Trash2,
  Check,
  AlertCircle,
  X,
  RefreshCw,
  Globe,
  Database,
  User,
  Cpu,
  CheckCircle2
} from 'lucide-react'

const connectorTypes = [
  { type: 'virustotal', name: 'VirusTotal Intelligence', icon: Globe, desc: 'Hash validation, IP intelligence, domain lookups' },
  { type: 'entra_id', name: 'Active Directory / Entra', icon: User, desc: 'User lookup, security group checks, account lockouts' },
  { type: 'crowdstrike', name: 'CrowdStrike Falcon EDR', icon: Cpu, desc: 'Endpoint telemetry, network host isolation, logs query' },
  { type: 'custom_api', name: 'Custom REST API Connector', icon: Database, desc: 'Dynamic JSON request mapping to custom systems' }
]

export default function IntegrationHub() {
  const [integrations, setIntegrations] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Guided Wizard modal states
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardSelectedType, setWizardSelectedType] = useState('')
  const [wizardName, setWizardName] = useState('')
  const [wizardConfig, setWizardConfig] = useState({ api_key: '', tenant_id: '', client_id: '', client_secret: '', base_url: '' })
  const [wizardTesting, setWizardTesting] = useState(false)
  const [wizardTestOutput, setWizardTestOutput] = useState(null)

  async function loadIntegrations() {
    try {
      const resp = await api.get('/integrations')
      setIntegrations(resp.data ?? [])
    } catch {
      setError('Could not load integrations.')
    }
  }

  useEffect(() => {
    loadIntegrations()
  }, [])

  const handleOpenWizard = () => {
    setWizardStep(1)
    setWizardSelectedType('')
    setWizardName('')
    setWizardConfig({ api_key: '', tenant_id: '', client_id: '', client_secret: '', base_url: '' })
    setWizardTestOutput(null)
    setWizardTesting(false)
    setIsWizardOpen(true)
  }

  const handleTestWizard = async () => {
    setWizardTesting(true)
    setWizardTestOutput(null)
    try {
      const response = await api.post('/integrations/validate', {
        name: wizardName || `${wizardSelectedType.toUpperCase()} Integration`,
        connector_type: wizardSelectedType,
        config: wizardConfig
      })
      setWizardTestOutput(response.data)
      setWizardStep(3)
    } catch (err) {
      setWizardTestOutput({
        status: 'error',
        message: err.response?.data?.detail || 'Connection test failed. Verify authentication values.'
      })
      setWizardStep(3)
    } finally {
      setWizardTesting(false)
    }
  }

  const handleActivateWizard = async () => {
    try {
      await api.post('/integrations', {
        name: wizardName || `${wizardSelectedType.toUpperCase()} Integration`,
        connector_type: wizardSelectedType,
        config: wizardConfig
      })
      setSuccess('API Integration configured successfully!')
      setIsWizardOpen(false)
      await loadIntegrations()
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('Failed to register integration.')
      setTimeout(() => setError(''), 3000)
    }
  }

  const handleDeleteIntegration = async (id) => {
    if (!confirm('Are you sure you want to terminate this integration? Existing playbook action blocks referencing it may fail.')) return
    try {
      await api.delete(`/integrations/${id}`)
      setSuccess('Integration disconnected.')
      await loadIntegrations()
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('Failed to remove integration.')
    }
  }

  return (
    <AppLayout>
      <header className="panel page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1>Integration Hub</h1>
            <p className="muted">Centralized security connectors and external API integrations.</p>
          </div>
          <button
            onClick={handleOpenWizard}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-900 border border-blue-700 text-blue-100 hover:bg-blue-800 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Integration
          </button>
        </div>
      </header>

      {success && <div className="error-banner bg-green-950 border-green-800 text-green-400 mb-4">{success}</div>}
      {error && <div className="error-banner mb-4">{error}</div>}

      <div className="flex flex-col gap-6">
        <section className="panel">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2>Centralized Connectors</h2>
              <p className="muted text-xs">Expose intelligence lookups and EDR isolations directly into the visual playbook catalog.</p>
            </div>
          </div>

          {integrations.length === 0 && (
            <div className="text-center py-12">
              <Globe className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No integrations configured yet.</p>
              <p className="text-slate-600 text-xs mt-1">Click "Add Integration" to connect your first security tool.</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {integrations.map((int) => {
              const Latency = int.health_status?.latency_ms || 100
              const ErrorRate = int.health_status?.error_rate || 0.0

              return (
                <div
                  key={int.id}
                  className="p-5 rounded-2xl border border-slate-800/80 bg-slate-950/60 backdrop-blur-md flex flex-col justify-between gap-4 shadow-xl relative overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between min-w-0">
                    <div>
                      <h3 className="text-xs font-bold text-slate-100 truncate pr-1">{int.name}</h3>
                      <span className="text-[10px] text-slate-500 font-mono tracking-wider uppercase block mt-0.5">
                        Type: {int.connector_type}
                      </span>
                    </div>
                    
                    {/* Connection pills */}
                    <span className="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider font-mono border bg-green-950/60 text-green-400 border-green-900">
                      Connected
                    </span>
                  </div>

                  {/* Health metrics */}
                  <div className="grid grid-cols-2 gap-2 border-t border-b border-slate-900 py-3 text-[10px]">
                    <div>
                      <span className="text-slate-500 block">Latency</span>
                      <span className="font-mono text-slate-200 font-semibold">{Latency}ms</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Error Rate</span>
                      <span className="font-mono text-slate-200 font-semibold">{ErrorRate * 100}%</span>
                    </div>
                  </div>

                  {/* Actions lists */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">Exposed Action Blocks</span>
                    <div className="flex flex-wrap gap-1">
                      {(int.capabilities || []).map((cap, idx) => (
                        <span key={idx} className="text-[9px] px-2 py-0.5 rounded bg-slate-900 border border-slate-850 text-slate-350" title={cap.description}>
                          {cap.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Footer operations */}
                  <div className="flex justify-between items-center mt-2 pt-1">
                    <div className="flex items-center gap-1.5 text-[9px] text-slate-600 font-mono">
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                      <span>Verified Connection</span>
                    </div>
                    <button
                      onClick={() => handleDeleteIntegration(int.id)}
                      className="p-1 hover:text-red-400 text-slate-650 transition bg-transparent border-none cursor-pointer"
                      title="Disconnect Connector"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {/* Guided Wizard modal popup */}
      {isWizardOpen && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-50 backdrop-blur-sm font-sans text-xs">
          <div className="w-[480px] rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6 flex flex-col gap-5 animate-scale-up">
            
            {/* Wizard Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 text-blue-400">
                <Globe className="w-5 h-5 animate-pulse" />
                <h3 className="text-sm font-bold">Guided Connector Integration Setup</h3>
              </div>
              <button
                onClick={() => setIsWizardOpen(false)}
                className="p-1 hover:text-slate-200 text-slate-500 transition bg-transparent border-none cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Wizard Steps indicator */}
            <div className="flex justify-between items-center px-6">
              {[1, 2, 3].map((step) => (
                <div key={step} className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border transition ${
                    wizardStep === step
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : wizardStep > step
                      ? 'bg-green-600 border-green-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-500'
                  }`}>
                    {wizardStep > step ? <Check className="w-3 h-3" /> : step}
                  </div>
                  <span className={`text-[10px] font-semibold tracking-wide uppercase ${wizardStep === step ? 'text-blue-400' : 'text-slate-500'}`}>
                    {step === 1 ? 'Choice' : step === 2 ? 'Config' : 'Test'}
                  </span>
                </div>
              ))}
            </div>

            {/* Step 1: Connector Choice */}
            {wizardStep === 1 && (
              <div className="flex flex-col gap-3 my-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Select Integration Provider</span>
                <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                  {connectorTypes.map((conn) => {
                    const Icon = conn.icon
                    const isSelected = wizardSelectedType === conn.type
                    return (
                      <div
                        key={conn.type}
                        onClick={() => {
                          setWizardSelectedType(conn.type)
                          setWizardName(`${conn.name} Connector`)
                        }}
                        className={`p-3 rounded-xl border cursor-pointer text-left transition flex items-center gap-3 ${
                          isSelected
                            ? 'bg-blue-950/60 border-blue-500 text-blue-300'
                            : 'bg-slate-950 border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-blue-900 text-blue-300' : 'bg-slate-900 text-slate-500'}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-xs text-slate-100">{conn.name}</span>
                          <span className="text-[10px] text-slate-500 mt-0.5 leading-normal">{conn.desc}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Credentials and config */}
            {wizardStep === 2 && (
              <div className="flex flex-col gap-4 my-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Connector Label</label>
                  <input
                    type="text"
                    value={wizardName}
                    onChange={(e) => setWizardName(e.target.value)}
                    className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition text-xs"
                  />
                </div>

                {/* VirusTotal config form */}
                {wizardSelectedType === 'virustotal' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">VirusTotal API Key</label>
                    <input
                      type="password"
                      value={wizardConfig.api_key}
                      onChange={(e) => setWizardConfig({ ...wizardConfig, api_key: e.target.value })}
                      placeholder="Enter your VirusTotal API key"
                      className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                    />
                  </div>
                )}

                {/* Entra ID config form */}
                {wizardSelectedType === 'entra_id' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Microsoft Tenant ID</label>
                      <input
                        type="text"
                        value={wizardConfig.tenant_id}
                        onChange={(e) => setWizardConfig({ ...wizardConfig, tenant_id: e.target.value })}
                        className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Client Application ID</label>
                      <input
                        type="text"
                        value={wizardConfig.client_id}
                        onChange={(e) => setWizardConfig({ ...wizardConfig, client_id: e.target.value })}
                        className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Client Application Secret</label>
                      <input
                        type="password"
                        value={wizardConfig.client_secret}
                        onChange={(e) => setWizardConfig({ ...wizardConfig, client_secret: e.target.value })}
                        className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* CrowdStrike config form */}
                {wizardSelectedType === 'crowdstrike' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Client ID</label>
                      <input
                        type="text"
                        value={wizardConfig.client_id}
                        onChange={(e) => setWizardConfig({ ...wizardConfig, client_id: e.target.value })}
                        className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Client Secret</label>
                      <input
                        type="password"
                        value={wizardConfig.client_secret}
                        onChange={(e) => setWizardConfig({ ...wizardConfig, client_secret: e.target.value })}
                        className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* Custom REST API */}
                {wizardSelectedType === 'custom_api' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">REST Base URL</label>
                      <input
                        type="text"
                        value={wizardConfig.base_url}
                        onChange={(e) => setWizardConfig({ ...wizardConfig, base_url: e.target.value })}
                        placeholder="https://api.internal-security.net/v1"
                        className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Custom API Token</label>
                      <input
                        type="password"
                        value={wizardConfig.api_key}
                        onChange={(e) => setWizardConfig({ ...wizardConfig, api_key: e.target.value })}
                        className="w-full mt-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 text-slate-200 outline-none focus:border-blue-500 transition font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Test and activate */}
            {wizardStep === 3 && (
              <div className="flex flex-col gap-3 my-2 text-center items-center justify-center min-h-[140px]">
                {wizardTesting ? (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                    <span className="text-slate-400 font-mono text-[10px] tracking-widest uppercase">Testing connection...</span>
                  </div>
                ) : (
                  <div className="w-full">
                    {wizardTestOutput?.status === 'success' ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-3 rounded-full bg-green-950 border border-green-800 text-green-400 animate-bounce">
                          <Check className="w-6 h-6" />
                        </div>
                        <span className="font-semibold text-slate-100 text-xs">{wizardTestOutput.message}</span>
                        <div className="mt-3 p-3 rounded-lg bg-slate-950 border border-slate-850 text-left w-full font-mono text-[10px] text-slate-450 leading-relaxed">
                          Verified permissions: {wizardTestOutput.verified_permissions.join(', ')} <br />
                          Measured latency: {wizardTestOutput.latency_ms}ms
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-3 rounded-full bg-red-950 border border-red-800 text-red-400">
                          <AlertCircle className="w-6 h-6 animate-pulse" />
                        </div>
                        <span className="font-semibold text-slate-100 text-xs">Validation Failure</span>
                        <p className="text-slate-500 text-[10px] mt-1">{wizardTestOutput?.message}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Wizard Footer controls */}
            <div className="flex items-center gap-3 border-t border-slate-800 pt-3 flex-shrink-0">
              {wizardStep > 1 && (
                <button
                  onClick={() => setWizardStep(prev => prev - 1)}
                  disabled={wizardTesting}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                >
                  Back
                </button>
              )}
              
              {wizardStep === 1 && (
                <button
                  onClick={() => setWizardStep(2)}
                  disabled={!wizardSelectedType}
                  className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  Continue Configuration
                </button>
              )}

              {wizardStep === 2 && (
                <button
                  onClick={handleTestWizard}
                  className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition cursor-pointer"
                >
                  Test Connection
                </button>
              )}

              {wizardStep === 3 && (
                <button
                  onClick={handleActivateWizard}
                  disabled={wizardTestOutput?.status !== 'success'}
                  className="flex-1 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold transition disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  Activate Connector
                </button>
              )}
            </div>

          </div>
        </div>
      )}
    </AppLayout>
  )
}
