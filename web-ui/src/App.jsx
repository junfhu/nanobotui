import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ChatPage from './pages/ChatPage';
import ConfigPage from './pages/ConfigPage';
import SystemPage from './pages/SystemPage';

function App() {
  const [themeMode, setThemeMode] = useState(() => {
    const stored = localStorage.getItem('nanobot-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('nanobot-theme', themeMode);
  }, [themeMode]);

  const toggleTheme = () => {
    setThemeMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout themeMode={themeMode} onToggleTheme={toggleTheme} />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
