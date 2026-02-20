import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Layout as AntLayout, Button, Dropdown } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import './Layout.css'

const { Sider, Content } = AntLayout

const Layout = ({ children }) => {
  const { t, i18n } = useTranslation()

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
    <AntLayout className="layout">
      <Sider width={200} theme="dark" className="sidebar">
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
          <Dropdown menu={{ items: langMenuItems }} placement="topRight">
            <Button type="text" icon={<GlobalOutlined />} className="lang-switcher">
              {i18n.language === 'zh-CN' ? '中文' : 'English'}
            </Button>
          </Dropdown>
        </div>
      </Sider>
      <Content className="main-content">
        <Outlet />
      </Content>
    </AntLayout>
  )
}

export default Layout
