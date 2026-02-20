# Nanobot Web Companion

A lightweight web companion for **Nanobot**.

## What This Project Is

This project is built for **Nanobot users** to reduce configuration complexity and provide a simpler web-based setup/chat workflow. Please check https://github.com/hKUDS/nanobot for Nanobot introduction and installation.

## Important Notes

1. This project is for Nanobot and focuses on solving the "configuration is cumbersome" problem.
2. This project does **not** modify Nanobot core source code.
3. You can update Nanobot independently, but compatibility issues may occur across versions.
4. The actual project code is in:
- `nanobot-web/` (backend, FastAPI)
- `web-ui/` (frontend, React + Vite)

## Quick Start

Prerequisites:
- Python 3.11+
- Node.js 18+

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

Run frontend:
```bash
npm --prefix web-ui run dev
```
Frontend: `http://localhost:5173`

Open in browser:
- `http://localhost:5173`

## Compatibility

- Nanobot can be upgraded independently.
- If Nanobot introduces breaking changes, this web companion may require updates.
