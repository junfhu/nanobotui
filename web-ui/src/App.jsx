import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ChatPage from './pages/ChatPage';
import ConfigPage from './pages/ConfigPage';
import SystemPage from './pages/SystemPage';
import LoginPage from './pages/LoginPage';
import { api, authStorage } from './api';

function App() {
  const [themeMode, setThemeMode] = useState(() => {
    const stored = localStorage.getItem('nanobot-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState(() => authStorage.getToken());
  const [authUser, setAuthUser] = useState(() => authStorage.getUser());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('nanobot-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    const bootstrapAuth = async () => {
      if (!authToken) {
        setAuthReady(true);
        return;
      }
      try {
        const me = await api.me();
        setAuthUser(me?.user || authStorage.getUser());
      } catch {
        authStorage.clearAll();
        setAuthToken('');
        setAuthUser(null);
      } finally {
        setAuthReady(true);
      }
    };
    bootstrapAuth();
  }, []);

  const toggleTheme = () => {
    setThemeMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleLogin = async (username, password) => {
    const data = await api.login(username, password);
    authStorage.setToken(data.token);
    authStorage.setUser(data.user);
    setAuthToken(data.token);
    setAuthUser(data.user);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore logout failure and clear local auth anyway.
    } finally {
      authStorage.clearAll();
      setAuthToken('');
      setAuthUser(null);
    }
  };

  if (!authReady) {
    return null;
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={authToken ? <Navigate to="/chat" replace /> : <LoginPage onLogin={handleLogin} />}
        />
        <Route
          path="/"
          element={
            authToken ? (
              <Layout
                themeMode={themeMode}
                onToggleTheme={toggleTheme}
                onLogout={handleLogout}
                user={authUser}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
        <Route path="*" element={<Navigate to={authToken ? "/chat" : "/login"} replace />} />
      </Routes>
    </Router>
  );
}

export default App;
