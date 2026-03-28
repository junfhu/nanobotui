# Nanobot Web Companion

A lightweight web companion for [Nanobot](https://github.com/hKUDS/nanobot) — providing a modern browser-based UI for chat, configuration, and management.

**Bundled Nanobot core: v0.1.4.post6**

## Features

### Chat
- **Real-time streaming** — token-by-token output with a live typing cursor (ChatGPT-style)
- **Markdown rendering** — code highlighting, tables, GFM support with one-click copy
- **File upload** — attach files to messages for the AI to analyze
- **Voice input** — browser speech recognition and audio recording with backend transcription
- **Session management** — create, rename, delete conversations
- **Session search** — filter sessions by title (Ctrl+K)
- **Chat export** — download conversations as Markdown or JSON
- **Virtual scrolling** — smooth performance for long conversations

### Configuration
- **Agent settings** — model, provider, temperature, context window, max tool iterations, reasoning effort, timezone
- **Channel management** — Telegram, WeChat, WeCom, Matrix, etc.
- **MCP servers** — add/remove Model Context Protocol servers
- **Skills** — view and manage agent skills
- **Backup & restore** — save/restore config to/from device
- **Hot restart** — restart the backend from the UI after config changes

### System
- Health monitoring and service status dashboard
- Authentication with login and password management

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| Ctrl+N | New session |
| Ctrl+K | Focus session search |
| Escape | Close modal / clear search |
| Enter | Send message |
| Shift+Enter | New line in message |

## Architecture

```
nanobotui/
  nanobot/         # Nanobot core (v0.1.4.post6) — Anthropic + OpenAI providers
  nanobot-web/     # Backend — FastAPI, SSE streaming, session/config APIs
  web-ui/          # Frontend — React 19, Vite, Ant Design, Zustand, i18n (en/zh-CN)
```

## Quick Start

Prerequisites:
- Python >= 3.11
- Node.js >= 18

Install:
```bash
pip install -r nanobot-web/requirements.txt
npm --prefix web-ui install
```

Run backend:
```bash
python nanobot-web/main.py
```
Backend: `http://localhost:8080`

Run frontend (dev):
```bash
npm --prefix web-ui run dev
```
Frontend: `http://localhost:5173`

Production build:
```bash
npm --prefix web-ui run build
# Serve web-ui/dist/ with any static file server, or let nanobot-web serve it
```

Default login credentials:
- Username: `admin`
- Password: `Password123!`

## Compatibility

- Nanobot core is bundled in the `nanobot/` directory and can be updated independently.
- If Nanobot introduces breaking API changes, the web companion may require corresponding updates.

## License

MIT
