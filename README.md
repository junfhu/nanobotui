# Nanobot Web Companion

A lightweight web companion for **Nanobot**.

## What This Project Is

This project is for **Nanobot users**. Its core goal is to reduce configuration complexity and provide a more intuitive web entry for configuration and chat. For Nanobot introduction and installation, please refer to https://github.com/hKUDS/nanobot. This repository mainly keeps and adapts the original code.

## Important Notes

1. This project is for Nanobot and focuses on solving the "configuration is cumbersome" problem.
2. This project does **not** modify Nanobot core source code.
3. You can update Nanobot independently, but compatibility issues may occur across versions.
4. The actual project code is in:
- `nanobot-web/` (backend, FastAPI)
- `web-ui/` (frontend, React + Vite)

## Quick Start

Prerequisites:
- Python 3.12
- Node.js 22

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

Default login credentials:
- Username: `admin`
- Password: `Password123!`

## Compatibility

- Nanobot can be upgraded independently.
- If Nanobot introduces breaking changes, this web companion may require updates.
