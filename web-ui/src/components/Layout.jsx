import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Layout as AntLayout, Button, Dropdown } from 'antd'
import { GlobalOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import './Layout.css'

const { Sider, Content } = AntLayout

const Layout = ({ themeMode = 'dark', onToggleTheme }) => {
  const { t, i18n } = useTranslation()
  const isDark = themeMode === 'dark'

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

  return (
    <AntLayout className={`layout ${isDark ? 'theme-dark' : 'theme-light'}`}>
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
          <NavLink to="/system" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            📊 {t('layout.system')}
          </NavLink>
        </div>
        <div className="sidebar-footer">
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
        </div>
      </Sider>
      <Content className="main-content">
        <Outlet context={{ themeMode }} />
      </Content>
    </AntLayout>
  )
}

export default Layout
