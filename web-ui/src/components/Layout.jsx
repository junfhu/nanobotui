import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Layout as AntLayout, Button, Dropdown, Modal, Input, message, Typography } from 'antd'
import { GlobalOutlined, MoonOutlined, SunOutlined, LogoutOutlined, KeyOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import './Layout.css'

const { Sider, Content } = AntLayout
const { Text } = Typography

const Layout = ({ themeMode = 'dark', onToggleTheme, onLogout, user }) => {
  const { t, i18n } = useTranslation()
  const isDark = themeMode === 'dark'
  const [openChangePwd, setOpenChangePwd] = React.useState(false)
  const [oldPassword, setOldPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [savingPwd, setSavingPwd] = React.useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  const langMenuItems = [
    {
      key: 'zh-CN',
      label: '中文',
      onClick: () => i18n.changeLanguage('zh-CN'),
    },
    {
      key: 'en',
      label: 'English',
      onClick: () => i18n.changeLanguage('en'),
    },
  ]

  const submitChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      messageApi.error(t('auth.fillOldNewPassword'))
      return
    }
    if (newPassword !== confirmPassword) {
      messageApi.error(t('auth.passwordMismatch'))
      return
    }
    setSavingPwd(true)
    try {
      await api.changePassword(oldPassword, newPassword)
      messageApi.success(t('auth.passwordUpdated'))
      setOpenChangePwd(false)
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      messageApi.error(e?.message || t('auth.changePasswordFailed'))
    } finally {
      setSavingPwd(false)
    }
  }

  return (
    <AntLayout className={`layout ${isDark ? 'theme-dark' : 'theme-light'}`}>
      {contextHolder}
      <Sider width={200} theme={isDark ? 'dark' : 'light'} className="sidebar">
        <div className="sidebar-header">
          <h1>🐈 Nanobot</h1>
        </div>
        <div className="sidebar-nav">
          <NavLink to="/" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            💬 {t('layout.chat')}
          </NavLink>
          <NavLink to="/config" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            ⚙️ {t('layout.config')}
          </NavLink>
          <NavLink to="/skills" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            🧩 {t('layout.skills')}
          </NavLink>
          <NavLink to="/system" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            📊 {t('layout.system')}
          </NavLink>
        </div>
        <div className="sidebar-footer">
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {user?.username ? `@${user.username}` : ''}
          </Text>
          <Button
            type="text"
            onClick={onToggleTheme}
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            className="theme-switcher"
          >
            {isDark ? t('layout.lightMode') : t('layout.darkMode')}
          </Button>
          <Dropdown menu={{ items: langMenuItems }} placement="topRight">
            <Button type="text" icon={<GlobalOutlined />} className="lang-switcher">
              {i18n.language === 'zh-CN' ? '中文' : 'English'}
            </Button>
          </Dropdown>
          <Button
            type="text"
            icon={<KeyOutlined />}
            className="theme-switcher"
            onClick={() => setOpenChangePwd(true)}
          >
            {t('layout.changePassword')}
          </Button>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            className="theme-switcher"
            onClick={onLogout}
          >
            {t('layout.logout')}
          </Button>
        </div>
      </Sider>
      <Content className="main-content">
        <Outlet context={{ themeMode }} />
      </Content>
      <Modal
        title={t('auth.changePasswordTitle')}
        open={openChangePwd}
        onCancel={() => {
          setOpenChangePwd(false);
          setOldPassword('');
          setNewPassword('');
          setConfirmPassword('');
        }}
        onOk={submitChangePassword}
        okButtonProps={{ loading: savingPwd }}
        okText={t('common.ok')}
        cancelText={t('common.cancel')}
      >
        <Input.Password
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          placeholder={t('auth.oldPassword')}
          style={{ marginBottom: 10 }}
          onPressEnter={submitChangePassword}
        />
        <Input.Password
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t('auth.newPassword')}
          style={{ marginBottom: 10 }}
        />
        <Input.Password
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t('auth.confirmNewPassword')}
          onPressEnter={submitChangePassword}
        />
      </Modal>
    </AntLayout>
  )
}

export default Layout
