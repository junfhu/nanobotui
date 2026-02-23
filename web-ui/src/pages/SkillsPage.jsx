import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import './SkillsPage.css'

const SkillsPage = () => {
  const { t } = useTranslation()
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deletingKey, setDeletingKey] = useState('')
  const [filterText, setFilterText] = useState('')

  const loadSkills = async () => {
    setLoading(true)
    try {
      const result = await api.listSkills()
      setSkills(result?.items || [])
      setError(null)
    } catch (err) {
      setError(err.message)
      setSkills([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSkills()
  }, [])

  const handleDelete = async (skill) => {
    const confirmed = window.confirm(
      t('skillsPage.confirmDelete', { name: skill.name, source: skill.source })
    )
    if (!confirmed) return

    const key = `${skill.source}:${skill.name}`
    setDeletingKey(key)
    try {
      await api.deleteSkill(skill.name, skill.source)
      await loadSkills()
    } catch (err) {
      setError(err.message || t('skillsPage.deleteFailed'))
    } finally {
      setDeletingKey('')
    }
  }

  const normalizedFilter = filterText.trim().toLowerCase()
  const filteredSkills = skills.filter((skill) => {
    if (!normalizedFilter) return true
    const name = (skill.name || '').toLowerCase()
    const description = (skill.description || '').toLowerCase()
    return name.includes(normalizedFilter) || description.includes(normalizedFilter)
  })

  return (
    <div className="skills-page">
      <h2>{t('skillsPage.title')}</h2>

      {loading ? (
        <div className="loading-message">{t('skillsPage.loading')}</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : skills.length === 0 ? (
        <div className="empty-message">{t('skillsPage.empty')}</div>
      ) : (
        <div className="card">
          <div className="skills-toolbar">
            <div className="skills-count">{t('skillsPage.total', { count: filteredSkills.length })}</div>
            <input
              className="skills-filter"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={t('skillsPage.filterPlaceholder')}
            />
          </div>
          <div className="skills-list">
            {filteredSkills.map((skill) => {
              const key = `${skill.source}:${skill.name}`
              const deleting = deletingKey === key
              return (
                <div key={key} className="skill-item">
                  <div className="skill-main">
                    <div className="skill-name">{skill.name}</div>
                    <div className="skill-desc">{skill.description || '-'}</div>
                    <div className="skill-meta">
                      <span>{t('skillsPage.path')}: {skill.path}</span>
                    </div>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(skill)}
                    disabled={deleting || skill.deletable === false}
                    title={skill.deletable === false ? t('skillsPage.builtinReadonly') : ''}
                  >
                    {deleting
                      ? t('skillsPage.deleting')
                      : skill.deletable === false
                        ? t('skillsPage.builtinReadonly')
                        : t('skillsPage.delete')}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default SkillsPage
