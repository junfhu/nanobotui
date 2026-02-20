import React, { useState, useEffect } from 'react';
import api from '../services/api';

const Status = () => {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await api.getStatus();
      setStatus(response);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full w-full bg-gray-900 text-white">
        <div className="border-b border-gray-700 p-4">
          <h2 className="text-xl font-bold">Nanobot Status</h2>
        </div>
        <div className="flex-1 flex justify-center items-center">
          <div className="animate-pulse">
            <p className="text-lg">Loading status...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full w-full bg-gray-900 text-white">
        <div className="border-b border-gray-700 p-4">
          <h2 className="text-xl font-bold">Nanobot Status</h2>
        </div>
        <div className="flex-1 flex justify-center items-center">
          <div className="text-center">
            <p className="text-red-500 mb-4">Error: {error}</p>
            <button
              onClick={fetchStatus}
              className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-gray-900 text-white">
      {/* Status header */}
      <div className="border-b border-gray-700 p-4">
        <h2 className="text-xl font-bold">Nanobot Status</h2>
        <button
          onClick={fetchStatus}
          className="mt-2 px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-sm transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Status content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* General status */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3">General Status</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">Status:</span>
              <span className={`font-medium ${status.status === 'running' ? 'text-green-500' : 'text-red-500'}`}>
                {status.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Mode:</span>
              <span className="font-medium">{status.mode}</span>
            </div>
          </div>
        </div>

        {/* Services status */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3">Services</h3>
          <div className="space-y-2">
            {status.services && Object.entries(status.services).map(([service, status]) => (
              <div key={service} className="flex justify-between">
                <span className="text-gray-400">{service.charAt(0).toUpperCase() + service.slice(1)}:</span>
                <span className={`font-medium ${status === 'available' ? 'text-green-500' : 'text-red-500'}`}>
                  {status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Additional info */}
        {status.config && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-3">Configuration</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Model:</span>
                <span className="font-medium">{status.config.model || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Workspace:</span>
                <span className="font-medium">{status.config.workspace || 'N/A'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {status.error && (
          <div className="bg-red-900 bg-opacity-30 border border-red-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-2 text-red-400">Error</h3>
            <p className="text-red-300">{status.error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Status;
