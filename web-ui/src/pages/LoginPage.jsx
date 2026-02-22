import React, { useState } from 'react'
import { Button, Input, Typography, Alert, Card } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import './LoginPage.css'

const { Title, Text } = Typography

const LoginPage = ({ onLogin }) => {
  const { t } = useTranslation()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('Password123!')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    setLoading(true)
    try {
      await onLogin(username, password)
    } catch (e) {
      setError(e?.message || t('api.requestFailed'))
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="login-page">
      <Card className="login-card" variant="borderless">
        <Title level={3} className="login-title">Nanobot Web</Title>
        <Text className="login-subtitle">{t('layout.chat')}</Text>
        <div className="login-form">
          <Input
            prefix={<UserOutlined />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('auth.username')}
            autoComplete="username"
          />
          <Input.Password
            prefix={<LockOutlined />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('auth.password')}
            autoComplete="current-password"
          />
          {error ? <Alert type="error" message={error} showIcon /> : null}
          <Button type="primary" onClick={submit} loading={loading} block>
            {t('auth.signIn')}
          </Button>
        </div>
      </Card>
    </div>
  )
}

export default LoginPage
