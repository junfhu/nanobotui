import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import './SystemPage.css'

const SystemPage = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load system status
  useEffect(() => {
    const loadStatus = async () => {
      setLoading(true)
      try {
        const systemStatus = await api.getStatus()
        setStatus(systemStatus)
        setError(null)
      } catch (err) {
        setError(err.message)
        setStatus(null)
      } finally {
        setLoading(false)
      }
    }

    loadStatus()
    // Refresh status every 30 seconds
    const interval = setInterval(loadStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  const localizedStatus = status?.status === 'healthy'
    ? t('system.healthy')
    : status?.status === 'error'
      ? t('system.error')
      : status?.status

  const localizedMode = status?.mode === 'limited - basic API endpoints available'
    ? t('system.modeLimited')
    : status?.mode === 'offline'
      ? t('system.offline')
      : status?.mode

  return (
    <div className="system-page">
      <h2>{t('system.status')}</h2>

      {loading ? (
        <div className="loading-message">{t('system.loadingStatus')}</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : status ? (
        <div>
          {/* Health Check */}
          <div className="card">
            <h3>{t('system.health')}</h3>
            <div className="grid-container">
              <div className="status-card">
                <p className="status-label">{t('system.status')}</p>
                <p className="status-value">{localizedStatus}</p>
              </div>
              <div className="status-card">
                <p className="status-label">{t('system.mode')}</p>
                <p className="status-value">{localizedMode}</p>
              </div>
            </div>
          </div>

          {/* Services */}
          <div className="card">
            <h3>{t('system.services')}</h3>
            <div className="grid-container">
              {Object.entries(status.services).map(([service, serviceStatus]) => (
                <div key={service} className="status-card">
                  <p className="status-label">{service}</p>
                  <p className={`status-value ${serviceStatus === 'available' ? 'service-available' : 'service-unavailable'}`}>
                    {serviceStatus === 'available'
                      ? t('system.available')
                      : serviceStatus === 'unavailable'
                        ? t('system.unavailable')
                        : serviceStatus}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-message">{t('system.noStatus')}</div>
      )}
    </div>
  )
}

export default SystemPage
