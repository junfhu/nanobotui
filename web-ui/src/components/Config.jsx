import React, { useState, useEffect } from 'react';
import api from '../services/api';

const Config = () => {
  const [config, setConfig] = useState(null);
  const [editingConfig, setEditingConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setIsLoading(true);
    setError(null);
    setMessage(null);
    
    try {
      const response = await api.getConfig();
      setConfig(response);
      setEditingConfig(JSON.parse(JSON.stringify(response)));
    } catch (err) {
      setError(err.message);
      console.error('Error fetching config:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setMessage(null);
    
    try {
      // Extract the actual config object if it's nested
      const configToSave = editingConfig.config || editingConfig;
      const response = await api.saveConfig(configToSave);
      
      if (response.status === 'success') {
        setMessage('Config saved successfully!');
        setIsEditing(false);
        // Refresh the config to show the saved version
        await fetchConfig();
      } else {
        setError(response.message || 'Failed to save config');
      }
    } catch (err) {
      setError(`Error saving config: ${err.message}`);
      console.error('Error saving config:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditingConfig(JSON.parse(JSON.stringify(config)));
    setError(null);
    setMessage(null);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full w-full bg-gray-900 text-white">
        <div className="border-b border-gray-700 p-4">
          <h2 className="text-xl font-bold">Nanobot Configuration</h2>
        </div>
        <div className="flex-1 flex justify-center items-center">
          <div className="animate-pulse">
            <p className="text-lg">Loading configuration...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full w-full bg-gray-900 text-white">
        <div className="border-b border-gray-700 p-4">
          <h2 className="text-xl font-bold">Nanobot Configuration</h2>
        </div>
        <div className="flex-1 flex justify-center items-center">
          <div className="text-center">
            <p className="text-red-500 mb-4">Error: {error}</p>
            <button
              onClick={fetchConfig}
              className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Get the actual config data (handle nested config object)
  const configData = config.config || config;
  const editingData = editingConfig.config || editingConfig;

  return (
    <div className="flex flex-col h-full w-full bg-gray-900 text-white">
      {/* Config header */}
      <div className="border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Nanobot Configuration</h2>
          <div className="flex space-x-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-sm transition-colors"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-sm transition-colors"
              >
                Edit
              </button>
            )}
            <button
              onClick={fetchConfig}
              className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
        {message && (
          <div className="mt-2 px-3 py-1 rounded bg-green-900 bg-opacity-50 text-green-300 text-sm">
            {message}
          </div>
        )}
        {error && (
          <div className="mt-2 px-3 py-1 rounded bg-red-900 bg-opacity-50 text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Config content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Agents configuration */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3">Agents</h3>
          {configData.agents && configData.agents.defaults && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400">Default Model:</span>
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingData.agents.defaults.model || ''}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(editingData));
                      newConfig.agents.defaults.model = e.target.value;
                      setEditingConfig({ ...editingConfig, config: newConfig });
                    }}
                    className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <span className="font-medium">{configData.agents.defaults.model || 'N/A'}</span>
                )}
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400">Temperature:</span>
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={editingData.agents.defaults.temperature || 0.7}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(editingData));
                      newConfig.agents.defaults.temperature = parseFloat(e.target.value);
                      setEditingConfig({ ...editingConfig, config: newConfig });
                    }}
                    className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <span className="font-medium">{configData.agents.defaults.temperature || 'N/A'}</span>
                )}
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400">Max Tokens:</span>
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    value={editingData.agents.defaults.max_tokens || 4096}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(editingData));
                      newConfig.agents.defaults.max_tokens = parseInt(e.target.value);
                      setEditingConfig({ ...editingConfig, config: newConfig });
                    }}
                    className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <span className="font-medium">{configData.agents.defaults.max_tokens || 'N/A'}</span>
                )}
              </div>
              {configData.agents.defaults.max_tool_iterations !== undefined && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">Max Tool Iterations:</span>
                  </div>
                  {isEditing ? (
                    <input
                      type="number"
                      value={editingData.agents.defaults.max_tool_iterations || 20}
                      onChange={(e) => {
                        const newConfig = JSON.parse(JSON.stringify(editingData));
                        newConfig.agents.defaults.max_tool_iterations = parseInt(e.target.value);
                        setEditingConfig({ ...editingConfig, config: newConfig });
                      }}
                      className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  ) : (
                    <span className="font-medium">{configData.agents.defaults.max_tool_iterations}</span>
                  )}
                </div>
              )}
              {configData.agents.defaults.context_window_tokens !== undefined && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">Context Window Tokens:</span>
                  </div>
                  {isEditing ? (
                    <input
                      type="number"
                      value={editingData.agents.defaults.context_window_tokens || 65536}
                      onChange={(e) => {
                        const newConfig = JSON.parse(JSON.stringify(editingData));
                        newConfig.agents.defaults.context_window_tokens = parseInt(e.target.value);
                        setEditingConfig({ ...editingConfig, config: newConfig });
                      }}
                      className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  ) : (
                    <span className="font-medium">{configData.agents.defaults.context_window_tokens}</span>
                  )}
                </div>
              )}
              {configData.agents.defaults.timezone !== undefined && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">Timezone:</span>
                  </div>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingData.agents.defaults.timezone || 'UTC'}
                      onChange={(e) => {
                        const newConfig = JSON.parse(JSON.stringify(editingData));
                        newConfig.agents.defaults.timezone = e.target.value;
                        setEditingConfig({ ...editingConfig, config: newConfig });
                      }}
                      className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  ) : (
                    <span className="font-medium">{configData.agents.defaults.timezone}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Gateway configuration */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3">Gateway</h3>
          {configData.gateway && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400">Host:</span>
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingData.gateway.host || 'localhost'}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(editingData));
                      newConfig.gateway.host = e.target.value;
                      setEditingConfig({ ...editingConfig, config: newConfig });
                    }}
                    className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <span className="font-medium">{configData.gateway.host || 'N/A'}</span>
                )}
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400">Port:</span>
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    value={editingData.gateway.port || 18790}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(editingData));
                      newConfig.gateway.port = parseInt(e.target.value);
                      setEditingConfig({ ...editingConfig, config: newConfig });
                    }}
                    className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <span className="font-medium">{configData.gateway.port || 'N/A'}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tools configuration */}
        {configData.tools && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-3">Tools</h3>
            <div className="space-y-4">
              {configData.tools.web && configData.tools.web.search && (
                <div className="space-y-3">
                  <div className="text-gray-400 font-medium">Web Search:</div>
                  <div className="pl-4">
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-400">Max Results:</span>
                    </div>
                    {isEditing ? (
                      <input
                        type="number"
                        value={editingData.tools.web.search.max_results || 5}
                        onChange={(e) => {
                          const newConfig = JSON.parse(JSON.stringify(editingData));
                          newConfig.tools.web.search.max_results = parseInt(e.target.value);
                          setEditingConfig({ ...editingConfig, config: newConfig });
                        }}
                        className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    ) : (
                      <span className="font-medium">{configData.tools.web.search.max_results || 'N/A'}</span>
                    )}
                  </div>
                  <div className="pl-4">
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-400">API Key:</span>
                    </div>
                    {isEditing ? (
                      <input
                        type="password"
                        value={editingData.tools.web.search.api_key || ''}
                        onChange={(e) => {
                          const newConfig = JSON.parse(JSON.stringify(editingData));
                          newConfig.tools.web.search.api_key = e.target.value;
                          setEditingConfig({ ...editingConfig, config: newConfig });
                        }}
                        className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    ) : (
                      <span className="font-medium">{configData.tools.web.search.api_key ? 'Set' : 'Not set'}</span>
                    )}
                  </div>
                </div>
              )}
              {configData.tools.exec && (
                <div className="space-y-3">
                  <div className="text-gray-400 font-medium">Exec:</div>
                  <div className="pl-4">
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-400">Timeout:</span>
                    </div>
                    {isEditing ? (
                      <input
                        type="number"
                        value={editingData.tools.exec.timeout || 60}
                        onChange={(e) => {
                          const newConfig = JSON.parse(JSON.stringify(editingData));
                          newConfig.tools.exec.timeout = parseInt(e.target.value);
                          setEditingConfig({ ...editingConfig, config: newConfig });
                        }}
                        className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    ) : (
                      <span className="font-medium">{configData.tools.exec.timeout || 'N/A'} seconds</span>
                    )}
                  </div>
                </div>
              )}
              {configData.tools.restrict_to_workspace !== undefined && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">Restrict to Workspace:</span>
                  </div>
                  {isEditing ? (
                    <select
                      value={editingData.tools.restrict_to_workspace ? 'true' : 'false'}
                      onChange={(e) => {
                        const newConfig = JSON.parse(JSON.stringify(editingData));
                        newConfig.tools.restrict_to_workspace = e.target.value === 'true';
                        setEditingConfig({ ...editingConfig, config: newConfig });
                      }}
                      className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <span className={`font-medium ${configData.tools.restrict_to_workspace ? 'text-green-500' : 'text-red-500'}`}>
                      {configData.tools.restrict_to_workspace ? 'Yes' : 'No'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error message */}
        {config.error && (
          <div className="bg-red-900 bg-opacity-30 border border-red-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-2 text-red-400">Error</h3>
            <p className="text-red-300">{config.error}</p>
          </div>
        )}

        {/* Note */}
        {config.note && (
          <div className="bg-blue-900 bg-opacity-30 border border-blue-700 rounded-lg p-4">
            <p className="text-blue-300">{config.note}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Config;
