import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../store'
import './ConfigPage.css'

const ConfigPage = () => {
  const { t } = useTranslation()
  const { 
    config, 
    loading, 
    saving, 
    error,
    loadConfig, 
    saveConfig
  } = useConfigStore()
  const [activeTab, setActiveTab] = useState('agents')
  const [localConfig, setLocalConfig] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [])

  // Update local state when config changes
  useEffect(() => {
    if (config) {
      setLocalConfig(JSON.parse(JSON.stringify(config)))
    }
  }, [config])

  // Handle config change
  const handleChange = (section, key, value) => {
    setLocalConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }))
  }

  const handleNestedChange = (section, subsection, key, value) => {
    setLocalConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [subsection]: {
          ...prev[section]?.[subsection],
          [key]: value
        }
      }
    }))
  }

  // Handle save
  const handleSave = async () => {
    try {
      await saveConfig(localConfig)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      console.error(t('configPage.saveErrorLog'), error)
    }
  }

  const renderAgentsTab = () => {
    if (!localConfig?.agents?.defaults) return null
    const agents = localConfig.agents.defaults
    
    return (
      <div className="form-section">
        <h3>{t('configPage.agentSettings')}</h3>
        <div className="form-group">
          <label>{t('configPage.workspace')}</label>
          <input
            type="text"
            value={agents.workspace || ''}
            onChange={(e) => handleChange('agents', 'defaults', { ...agents, workspace: e.target.value })}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label>{t('configPage.model')}</label>
          <input
            type="text"
            value={agents.model || ''}
            onChange={(e) => handleChange('agents', 'defaults', { ...agents, model: e.target.value })}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label>{t('configPage.maxTokens')}</label>
          <input
            type="number"
            value={agents.max_tokens || 8192}
            onChange={(e) => handleChange('agents', 'defaults', { ...agents, max_tokens: parseInt(e.target.value) })}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label>{t('configPage.temperature')}</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={agents.temperature || 0.7}
            onChange={(e) => handleChange('agents', 'defaults', { ...agents, temperature: parseFloat(e.target.value) })}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label>{t('configPage.maxToolIterations')}</label>
          <input
            type="number"
            value={agents.max_tool_iterations || 20}
            onChange={(e) => handleChange('agents', 'defaults', { ...agents, max_tool_iterations: parseInt(e.target.value) })}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label>{t('configPage.memoryWindow')}</label>
          <input
            type="number"
            value={agents.memory_window || 50}
            onChange={(e) => handleChange('agents', 'defaults', { ...agents, memory_window: parseInt(e.target.value) })}
            className="form-input"
          />
        </div>
      </div>
    )
  }

  const renderChannelFields = (channelName, channelConfig) => {
    if (!channelConfig) return null
    
    const fields = []
    for (const [key, value] of Object.entries(channelConfig)) {
      if (key === 'enabled') {
        fields.push(
          <div key={key} className="form-checkbox">
            <input
              type="checkbox"
              checked={value || false}
              onChange={(e) => handleNestedChange('channels', channelName, key, e.target.checked)}
            />
            <label>{t('configPage.enableChannel', { channel: channelName })}</label>
          </div>
        )
      } else if (typeof value === 'boolean') {
        fields.push(
          <div key={key} className="form-group">
            <label>{key}</label>
            <input
              type="checkbox"
              checked={value || false}
              onChange={(e) => handleNestedChange('channels', channelName, key, e.target.checked)}
            />
          </div>
        )
      } else if (typeof value === 'number') {
        fields.push(
          <div key={key} className="form-group">
            <label>{key}</label>
            <input
              type="number"
              value={value || 0}
              onChange={(e) => handleNestedChange('channels', channelName, key, parseInt(e.target.value))}
              className="form-input"
            />
          </div>
        )
      } else if (Array.isArray(value)) {
        fields.push(
          <div key={key} className="form-group">
            <label>{t('configPage.commaSeparated', { key })}</label>
            <input
              type="text"
              value={value.join(', ') || ''}
              onChange={(e) => handleNestedChange('channels', channelName, key, e.target.value.split(',').map(item => item.trim()))}
              className="form-input"
            />
          </div>
        )
      } else if (typeof value === 'object' && value !== null) {
        // Skip nested objects for now
      } else {
        fields.push(
          <div key={key} className="form-group">
            <label>{key}</label>
            <input
              type="text"
              value={value || ''}
              onChange={(e) => handleNestedChange('channels', channelName, key, e.target.value)}
              className="form-input"
            />
          </div>
        )
      }
    }
    return fields
  }

  const renderChannelsTab = () => {
    if (!localConfig?.channels) return null
    
    const channelNames = Object.keys(localConfig.channels)
    
    return (
      <div className="form-section">
        <h3>{t('configPage.channelSettings')}</h3>
        {channelNames.map(channelName => (
          <div key={channelName} className="channel-section">
            <h4>{channelName}</h4>
            {renderChannelFields(channelName, localConfig.channels[channelName])}
          </div>
        ))}
      </div>
    )
  }

  const renderProviderFields = (providerName, providerConfig) => {
    if (!providerConfig) return null
    
    // Handle both snake_case and camelCase
    const inlineFields = ['api_key', 'apiKey', 'api_base', 'apiBase', 'extra_headers', 'extraHeaders']
    const shownInline = ['api_key', 'api_base', 'extra_headers']
    // Helper to normalize keys for comparison (remove underscores and lowercase)
    const normalizeKey = (k) => k.replace(/_/g, '').toLowerCase()
    const otherFields = Object.keys(providerConfig).filter(k => !inlineFields.includes(k))
    
    return (
      <div className="provider-fields">
        {/* Inline fields: api_key, api_base, extra_headers */}
        <div className="provider-inline-fields">
          {shownInline.map(key => {
            // Find the actual key in providerConfig (could be camelCase or snake_case)
            const actualKey = Object.keys(providerConfig).find(k => 
              normalizeKey(k) === normalizeKey(key)
            ) || key
            const displayKey = key.replace(/_/g, ' ')
            return (
              <div key={key} className="form-group inline-field">
                <label>{displayKey}</label>
                <input
                  type="text"
                  value={providerConfig[actualKey] || ''}
                  onChange={(e) => {
                    // Update with the actual key from config
                    const targetKey = Object.keys(providerConfig).find(k => 
                      normalizeKey(k) === normalizeKey(key)
                    ) || key
                    handleNestedChange('providers', providerName, targetKey, e.target.value)
                  }}
                  className="form-input"
                />
              </div>
            )
          })}
        </div>
        
        {/* Other fields */}
        {otherFields.map(key => (
          <div key={key} className="form-group">
            <label>{key}</label>
            <input
              type="text"
              value={providerConfig[key] || ''}
              onChange={(e) => handleNestedChange('providers', providerName, key, e.target.value)}
              className="form-input"
            />
          </div>
        ))}
      </div>
    )
  }

  const renderProvidersTab = () => {
    if (!localConfig?.providers) return null
    
    const providerNames = Object.keys(localConfig.providers)
    
    return (
      <div className="form-section">
        <h3>{t('configPage.providerSettings')}</h3>
        {providerNames.map(providerName => (
          <div key={providerName} className="provider-section">
            <h4 className="provider-name">{providerName}</h4>
            {renderProviderFields(providerName, localConfig.providers[providerName])}
          </div>
        ))}
      </div>
    )
  }

  const renderToolsTab = () => {
    if (!localConfig?.tools) return null
    const tools = localConfig.tools
    const mcpServers = tools.mcp_servers || tools.mcpServers || {}
    
    return (
      <div className="form-section">
        <h3>{t('configPage.toolsSettings')}</h3>
        
        <div className="form-group">
          <label>{t('configPage.restrictToWorkspace')}</label>
          <input
            type="checkbox"
            checked={tools.restrict_to_workspace || false}
            onChange={(e) => setLocalConfig(prev => ({ ...prev, tools: { ...prev.tools, restrict_to_workspace: e.target.checked } }))}
          />
        </div>
        
        {tools.web?.search && (
          <div className="nested-section">
            <h4>{t('configPage.webSearch')}</h4>
            <div className="form-group">
              <label>{t('configPage.apiKey')}</label>
              <input
                type="text"
                value={tools.web.search.api_key || ''}
                onChange={(e) => setLocalConfig(prev => ({ 
                  ...prev, 
                  tools: { 
                    ...prev.tools, 
                    web: { 
                      ...prev.tools.web, 
                      search: { 
                        ...prev.tools.web.search, 
                        api_key: e.target.value 
                      } 
                    } 
                  } 
                }))}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>{t('configPage.maxResults')}</label>
              <input
                type="number"
                value={tools.web.search.max_results || 5}
                onChange={(e) => setLocalConfig(prev => ({ 
                  ...prev, 
                  tools: { 
                    ...prev.tools, 
                    web: { 
                      ...prev.tools.web, 
                      search: { 
                        ...prev.tools.web.search, 
                        max_results: parseInt(e.target.value) 
                      } 
                    } 
                  } 
                }))}
                className="form-input"
              />
            </div>
          </div>
        )}
        
        {tools.exec && (
          <div className="nested-section">
            <h4>{t('configPage.exec')}</h4>
            <div className="form-group">
              <label>{t('configPage.timeoutSeconds')}</label>
              <input
                type="number"
                value={tools.exec.timeout || 60}
                onChange={(e) => setLocalConfig(prev => ({ 
                  ...prev, 
                  tools: { 
                    ...prev.tools, 
                    exec: { 
                      ...prev.tools.exec, 
                      timeout: parseInt(e.target.value) 
                    } 
                  } 
                }))}
                className="form-input"
              />
            </div>
          </div>
        )}
        
        {(mcpServers || true) && (
          <div className="nested-section">
            <h4>{t('configPage.mcpServers')}</h4>
            {Object.keys(mcpServers).map(serverName => (
              <div key={serverName} className="mcp-server-section">
                <h5>{serverName}</h5>
                <div className="form-group">
                  <label>{t('configPage.command')}</label>
                  <input
                    type="text"
                    value={mcpServers[serverName]?.command || ''}
                    onChange={(e) => setLocalConfig(prev => ({ 
                      ...prev, 
                      tools: { 
                        ...prev.tools, 
                        mcp_servers: {
                          ...(prev.tools.mcp_servers || prev.tools.mcpServers || {}),
                          [serverName]: {
                            ...(prev.tools.mcp_servers || prev.tools.mcpServers || {})[serverName],
                            command: e.target.value
                          }
                        }
                      } 
                    }))}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>{t('configPage.argsCommaSeparated')}</label>
                  <input
                    type="text"
                    value={(mcpServers[serverName]?.args || []).join(', ')}
                    onChange={(e) => setLocalConfig(prev => ({ 
                      ...prev, 
                      tools: { 
                        ...prev.tools, 
                        mcp_servers: {
                          ...(prev.tools.mcp_servers || prev.tools.mcpServers || {}),
                          [serverName]: {
                            ...(prev.tools.mcp_servers || prev.tools.mcpServers || {})[serverName],
                            args: e.target.value.split(',').map(a => a.trim()).filter(a => a)
                          }
                        }
                      } 
                    }))}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>{t('configPage.envJson')}</label>
                  <input
                    type="text"
                    value={JSON.stringify(mcpServers[serverName]?.env || {})}
                    onChange={(e) => {
                      try {
                        const env = JSON.parse(e.target.value)
                        setLocalConfig(prev => ({ 
                          ...prev, 
                          tools: { 
                            ...prev.tools, 
                            mcp_servers: {
                              ...(prev.tools.mcp_servers || prev.tools.mcpServers || {}),
                              [serverName]: {
                                ...(prev.tools.mcp_servers || prev.tools.mcpServers || {})[serverName],
                                env
                              }
                            }
                          } 
                        }))
                      } catch {}
                    }}
                    className="form-input"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const name = prompt(t('configPage.enterMcpServerName'))
                if (name) {
                  setLocalConfig(prev => ({ 
                    ...prev, 
                    tools: { 
                      ...prev.tools, 
                      mcp_servers: {
                        ...(prev.tools.mcp_servers || prev.tools.mcpServers || {}),
                        [name]: { command: '', args: [], env: {} }
                      }
                    } 
                  }))
                }
              }}
              className="add-button"
            >
              {t('configPage.addMcpServer')}
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'agents':
        return renderAgentsTab()
      case 'channels':
        return renderChannelsTab()
      case 'providers':
        return renderProvidersTab()
      case 'tools':
        return renderToolsTab()
      default:
        return null
    }
  }

  if (!localConfig) {
    return <div className="loading-message">{t('configPage.loadingConfig')}</div>
  }

  return (
    <div className="config-page">
      <div className="tabs-container">
        <button
          onClick={() => setActiveTab('agents')}
          className={`tab-button ${activeTab === 'agents' ? 'active' : ''}`}
        >
          {t('config.agents')}
        </button>
        <button
          onClick={() => setActiveTab('channels')}
          className={`tab-button ${activeTab === 'channels' ? 'active' : ''}`}
        >
          {t('config.channels')}
        </button>
        <button
          onClick={() => setActiveTab('providers')}
          className={`tab-button ${activeTab === 'providers' ? 'active' : ''}`}
        >
          {t('config.providers')}
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`tab-button ${activeTab === 'tools' ? 'active' : ''}`}
        >
          {t('configPage.tools')}
        </button>
      </div>

      {loading ? (
        <div className="loading-message">{t('configPage.loadingConfig')}</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : (
        <div>
          {saveSuccess && (
            <div className="success-message">
              {t('config.saveSuccess')}
            </div>
          )}
          {renderTabContent()}
          <div className="button-container">
            <button
              onClick={handleSave}
              disabled={saving}
              className="save-button"
            >
              {saving ? t('configPage.saving') : t('configPage.saveConfig')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConfigPage
