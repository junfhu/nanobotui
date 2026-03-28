"""FastAPI backend for nanobot web interface."""

import sys
import os
import socket
import subprocess
import asyncio
import re
import sqlite3
import shutil
import hashlib
import hmac
import secrets
import base64
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Body, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import json
import uuid
from datetime import datetime
from loguru import logger
from collections import defaultdict

# Resolve nanobot project path dynamically (override with NANOBOT_PATH env if needed)
DEFAULT_NANOBOT_PATH = Path(__file__).resolve().parent.parent
NANOBOT_PATH = Path(os.environ.get("NANOBOT_PATH", str(DEFAULT_NANOBOT_PATH))).expanduser().resolve()
if str(NANOBOT_PATH) not in sys.path:
    sys.path.insert(0, str(NANOBOT_PATH))



# Import nanobot components
from nanobot.bus.queue import MessageBus
from nanobot.agent.loop import AgentLoop
from nanobot.session.manager import SessionManager
from nanobot.config.loader import load_config
from nanobot.config.paths import get_data_dir
from nanobot.providers.base import GenerationSettings
from nanobot.providers.registry import find_by_name as find_provider_by_name
from nanobot.providers.transcription import GroqTranscriptionProvider
from nanobot.cron.service import CronService
from nanobot.cron.types import CronJob, CronSchedule
from nanobot.agent.skills import SkillsLoader, BUILTIN_SKILLS_DIR

# Global variables
NANOBOT_AVAILABLE = False
agent_loop = None
message_bus = None
gateway_process: subprocess.Popen | None = None
cron_service: CronService | None = None
WEB_BACKEND_REVISION = "reminder-fix-v3-2026-02-22"
session_event_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "Password123!"
EMPTY_FINAL_RESPONSE = "I've completed processing but have no response to give."


def _env_enabled(name: str, default: str = "false") -> bool:
    """Parse a boolean-like environment variable."""
    value = os.environ.get(name, default).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _is_port_open(host: str, port: int, timeout: float = 0.3) -> bool:
    """Return True if a TCP port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def _start_gateway_if_needed() -> None:
    """
    Start `nanobot gateway` as a background subprocess when enabled.

    Controlled by:
    - NANOBOT_AUTO_START_GATEWAY=true|false (default: true)
    - NANOBOT_GATEWAY_PORT=18790
    """
    global gateway_process

    if not _env_enabled("NANOBOT_AUTO_START_GATEWAY", "true"):
        return

    port = int(os.environ.get("NANOBOT_GATEWAY_PORT", "18790"))
    if _is_port_open("127.0.0.1", port):
        logger.info("Gateway already running on port {}", port)
        return

    cmd = [sys.executable, "-m", "nanobot", "gateway", "--port", str(port)]
    try:
        popen_kwargs = {
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
        }
        if NANOBOT_PATH.exists():
            popen_kwargs["cwd"] = str(NANOBOT_PATH)
        gateway_process = subprocess.Popen(cmd, **popen_kwargs)
        logger.info("Auto-started nanobot gateway (pid={}, port={})", gateway_process.pid, port)
    except Exception as e:
        logger.error("Failed to auto-start nanobot gateway: {}", e)


def _stop_gateway_if_started() -> None:
    """Stop auto-started gateway process on web backend shutdown."""
    global gateway_process

    if not gateway_process or gateway_process.poll() is not None:
        return

    try:
        gateway_process.terminate()
        gateway_process.wait(timeout=5)
        logger.info("Stopped auto-started gateway (pid={})", gateway_process.pid)
    except Exception:
        try:
            gateway_process.kill()
        except Exception:
            pass
    finally:
        gateway_process = None


def _make_provider(config):
    """Create the appropriate LLM provider from config.

    Routing is driven by ``ProviderSpec.backend`` in the registry.
    """
    model = config.agents.defaults.model
    provider_name = config.get_provider_name(model)
    p = config.get_provider(model)
    spec = find_provider_by_name(provider_name) if provider_name else None
    backend = spec.backend if spec else "openai_compat"

    # --- instantiation by backend ---
    if backend == "openai_codex":
        from nanobot.providers.openai_codex_provider import OpenAICodexProvider
        provider = OpenAICodexProvider(default_model=model)
    elif backend == "azure_openai":
        from nanobot.providers.azure_openai_provider import AzureOpenAIProvider
        provider = AzureOpenAIProvider(
            api_key=p.api_key,
            api_base=p.api_base,
            default_model=model,
        )
    elif backend == "anthropic":
        from nanobot.providers.anthropic_provider import AnthropicProvider
        provider = AnthropicProvider(
            api_key=p.api_key if p else None,
            api_base=config.get_api_base(model),
            default_model=model,
            extra_headers=p.extra_headers if p else None,
        )
    else:
        from nanobot.providers.openai_compat_provider import OpenAICompatProvider
        provider = OpenAICompatProvider(
            api_key=p.api_key if p else None,
            api_base=config.get_api_base(model),
            default_model=model,
            extra_headers=p.extra_headers if p else None,
            spec=spec,
        )

    defaults = config.agents.defaults
    provider.generation = GenerationSettings(
        temperature=defaults.temperature,
        max_tokens=defaults.max_tokens,
        reasoning_effort=defaults.reasoning_effort,
    )
    return provider


async def init_nanobot():
    """Initialize nanobot components."""
    global NANOBOT_AVAILABLE, agent_loop, message_bus, cron_service
    
    try:
        logger.info("Initializing nanobot...")
        
        # Load config
        config = load_config()
        
        # Create message bus
        message_bus = MessageBus()
        
        # Create session manager
        session_manager = SessionManager(config.workspace_path)
        
        # Create cron service first; callback can run even when agent is unavailable.
        cron_store_path = get_data_dir() / "cron" / "jobs.json"
        cron_service = CronService(cron_store_path)

        async def on_cron_job(job: CronJob) -> str | None:
            """Execute scheduled jobs via agent and persist result for web sessions."""
            # Simple web reminders should be delivered directly without LLM round-trip.
            if (
                job.payload.channel == "web"
                and job.payload.to
                and (
                    job.name.startswith("web-reminder-")
                    or (job.payload.message or "").startswith("提醒时间到：")
                )
            ):
                add_message(job.payload.to, job.payload.message, "assistant")
                logger.info("Cron web reminder delivered directly (no LLM): {}", job.id)
                return job.payload.message

            response = ""
            if agent_loop is not None:
                try:
                    result = await agent_loop.process_direct(
                        content=job.payload.message,
                        session_key=f"cron:{job.id}",
                        channel=job.payload.channel or "web",
                        chat_id=job.payload.to or "web:default",
                    )
                    response = result.content if result and hasattr(result, 'content') else (str(result) if result else "")
                except Exception as e:
                    logger.warning("Cron agent execution failed for job {}: {}", job.id, e)

            # Web UI has no channel dispatcher; always persist a visible message.
            if job.payload.channel == "web" and job.payload.to:
                add_message(job.payload.to, response or job.payload.message, "assistant")
            return response or job.payload.message

        cron_service.on_job = on_cron_job
        await cron_service.start()

        # Create provider using registry-based approach
        model = config.agents.defaults.model
        provider = _make_provider(config)

        # Create agent loop
        logger.info(f"Initializing AgentLoop with max_iterations: {config.agents.defaults.max_tool_iterations}")
        agent_loop = AgentLoop(
            bus=message_bus,
            provider=provider,
            workspace=config.workspace_path,
            model=config.agents.defaults.model,
            max_iterations=config.agents.defaults.max_tool_iterations,
            context_window_tokens=config.agents.defaults.context_window_tokens,
            web_search_config=config.tools.web.search,
            web_proxy=config.tools.web.proxy or None,
            exec_config=config.tools.exec,
            cron_service=cron_service,
            restrict_to_workspace=config.tools.restrict_to_workspace,
            session_manager=session_manager,
            mcp_servers=config.tools.mcp_servers,
            channels_config=config.channels,
            timezone=config.agents.defaults.timezone,
        )
        
        # process_direct() handles web requests directly, no bus dispatcher required
        
        NANOBOT_AVAILABLE = True
        logger.info("Nanobot initialized successfully!")
        
    except Exception as e:
        logger.error(f"Failed to initialize nanobot: {e}")
        import traceback
        traceback.print_exc()
        NANOBOT_AVAILABLE = False


# Data storage
DATA_DIR = Path.home() / ".nanobot" / "web"
SESSIONS_DIR = DATA_DIR / "sessions"
CONFIG_DIR = Path.home() / ".nanobot"
CONFIG_PATH = CONFIG_DIR / "config.json"
CONFIG_BACKUP_DIR = CONFIG_DIR / "config_backups"
AUTH_DB_PATH = DATA_DIR / "auth.db"


def _auth_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _hash_password(password: str, salt_b64: str | None = None) -> tuple[str, str]:
    salt = base64.b64decode(salt_b64) if salt_b64 else secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240000)
    return base64.b64encode(salt).decode("utf-8"), base64.b64encode(dk).decode("utf-8")


def _verify_password(password: str, salt_b64: str, pw_hash_b64: str) -> bool:
    _, calc_hash = _hash_password(password, salt_b64)
    return hmac.compare_digest(calc_hash, pw_hash_b64)


def init_auth_db() -> None:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now().isoformat()
    with _auth_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        row = conn.execute(
            "SELECT id FROM users WHERE username = ?",
            (DEFAULT_ADMIN_USERNAME,),
        ).fetchone()
        if row is None:
            salt_b64, pw_hash_b64 = _hash_password(DEFAULT_ADMIN_PASSWORD)
            conn.execute(
                """
                INSERT INTO users(username, salt, password_hash, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?)
                """,
                (DEFAULT_ADMIN_USERNAME, salt_b64, pw_hash_b64, now, now),
            )
            logger.info("Initialized default admin user in auth database")


def _create_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with _auth_conn() as conn:
        conn.execute(
            "INSERT INTO auth_tokens(token, user_id, created_at) VALUES(?, ?, ?)",
            (token, user_id, datetime.now().isoformat()),
        )
    return token


def _resolve_user_from_token(token: str | None) -> dict | None:
    if not token:
        return None
    with _auth_conn() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.username
            FROM auth_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token = ?
            """,
            (token,),
        ).fetchone()
    if not row:
        return None
    return {"id": row["id"], "username": row["username"], "token": token}


def _extract_token_from_request(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    # EventSource does not support custom headers, allow query token as fallback.
    token_q = request.query_params.get("token", "").strip()
    return token_q or None


def _normalize_backup_filename(name: str) -> str:
    """
    Validate and normalize backup file name.

    Only allow letters/numbers/._- and append .json when omitted.
    """
    trimmed = (name or "").strip()
    if not trimmed:
        raise ValueError("Backup filename is required")
    if "/" in trimmed or "\\" in trimmed:
        raise ValueError("Backup filename must not include path separators")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", trimmed):
        raise ValueError("Backup filename contains invalid characters")
    if not trimmed.endswith(".json"):
        trimmed = f"{trimmed}.json"
    return trimmed


def _resolve_skill_delete_dir(name: str, source: str | None) -> Path:
    """Resolve and validate a deletable skill directory."""
    skill_name = (name or "").strip()
    if not skill_name:
        raise ValueError("Skill name is required")
    if "/" in skill_name or "\\" in skill_name or skill_name in {".", ".."}:
        raise ValueError("Invalid skill name")

    src = (source or "").strip().lower()
    if src == "workspace":
        base_dir = Path(load_config().workspace_path) / "skills"
    elif src == "builtin":
        base_dir = BUILTIN_SKILLS_DIR
    else:
        raise ValueError("Skill source must be workspace or builtin")

    target = (base_dir / skill_name).resolve()
    base = base_dir.resolve()
    if not str(target).startswith(f"{base}{os.sep}"):
        raise ValueError("Invalid skill path")
    if not target.exists() or not target.is_dir():
        raise FileNotFoundError(f"Skill not found: {skill_name}")
    if not (target / "SKILL.md").exists():
        raise ValueError("Invalid skill directory")
    return target


_CN_NUM = {
    "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
}


def _parse_zh_number(text: str) -> int | None:
    text = (text or "").strip().replace("０", "0").replace("１", "1").replace("２", "2").replace("３", "3").replace("４", "4").replace("５", "5").replace("６", "6").replace("７", "7").replace("８", "8").replace("９", "9")
    if not text:
        return None
    if text.isdigit():
        return int(text)
    if text in _CN_NUM:
        return _CN_NUM[text]
    if "百" in text:
        left, _, right = text.partition("百")
        hundreds = _CN_NUM.get(left, 1) if left else 1
        tail = _parse_zh_number(right) if right else 0
        if tail is None:
            tail = 0
        return hundreds * 100 + tail
    if "十" in text:
        left, _, right = text.partition("十")
        tens = _CN_NUM.get(left, 1) if left else 1
        ones = _CN_NUM.get(right, 0) if right else 0
        return tens * 10 + ones
    return None


def _parse_relative_reminder_seconds(content: str) -> int | None:
    """Parse simple reminder intents like '1分钟后提醒我' / '一分钟以后给我发消息'."""
    text = (content or "").strip()
    if not text:
        return None

    # Accept broad phrasing; only require "X分钟/秒" + "后/以后/之后".
    if not re.search(r"(后|以后|之后)", text):
        return None

    m = re.search(r"([0-9０-９一二两三四五六七八九十百]+)\s*个?\s*(分钟|分|秒钟|秒)", text)
    if not m:
        return None

    value = _parse_zh_number(m.group(1))
    if value is None or value <= 0:
        return None

    unit = m.group(2)
    if unit in {"分钟", "分"}:
        return value * 60
    if unit in {"秒钟", "秒"}:
        return value
    return None


def _schedule_web_relative_reminder(session_id: str, content: str) -> str | None:
    """Create a one-shot web reminder directly, returning assistant confirmation text."""
    if cron_service is None:
        return None

    seconds = _parse_relative_reminder_seconds(content)
    if not seconds:
        return None

    now_ms = int(datetime.now().timestamp() * 1000)
    at_ms = now_ms + seconds * 1000
    minutes = seconds // 60
    if seconds % 60 == 0:
        delay_text = f"{minutes} 分钟"
    else:
        delay_text = f"{seconds} 秒"

    reminder_text = f"提醒时间到：这是你 {delay_text} 前设置的提醒。"
    job = cron_service.add_job(
        name=f"web-reminder-{seconds}s",
        schedule=CronSchedule(kind="at", at_ms=at_ms),
        message=reminder_text,
        deliver=True,
        channel="web",
        to=session_id,
        delete_after_run=True,
    )
    logger.info("Web reminder created: session={}, seconds={}, job={}", session_id, seconds, job.id)
    run_at = _ms_to_iso(at_ms) or str(at_ms)
    return f"[{WEB_BACKEND_REVISION}] 已设置提醒：我会在 {delay_text} 后给你发消息（job: {job.id}, at: {run_at}）。"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    print("Starting nanobot web backend...")
    _start_gateway_if_needed()
    # Create data directories if they don't exist
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    init_auth_db()
    # Initialize nanobot
    await init_nanobot()
    if NANOBOT_AVAILABLE:
        print("Nanobot integration enabled!")
    else:
        print("Backend started in limited mode (nanobot integration pending)")
    
    yield
    
    # Shutdown
    if cron_service:
        cron_service.stop()
    _stop_gateway_if_started()


app = FastAPI(
    title="Nanobot Web API",
    description="Web API for nanobot",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


AUTH_EXEMPT_PATHS = {
    "/api/v1/auth/login",
}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/v1") and path not in AUTH_EXEMPT_PATHS:
        token = _extract_token_from_request(request)
        user = _resolve_user_from_token(token)
        if not user:
            return JSONResponse(
                status_code=401,
                content={
                    "success": False,
                    "data": None,
                    "error": {"code": "UNAUTHORIZED", "message": "Authentication required"},
                },
            )
        request.state.user = user
    return await call_next(request)


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "Nanobot Web API", "version": "0.1.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "nanobot_available": NANOBOT_AVAILABLE,
        "mode": "limited - basic API endpoints available",
        "revision": WEB_BACKEND_REVISION,
    }


@app.post("/api/v1/auth/login")
async def login(payload: dict = Body(...)):
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    if not username or not password:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "data": None,
                "error": {"code": "BAD_REQUEST", "message": "username and password are required"},
            },
        )

    with _auth_conn() as conn:
        row = conn.execute(
            "SELECT id, username, salt, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    if not row or not _verify_password(password, row["salt"], row["password_hash"]):
        return JSONResponse(
            status_code=401,
            content={
                "success": False,
                "data": None,
                "error": {"code": "INVALID_CREDENTIALS", "message": "Invalid username or password"},
            },
        )

    token = _create_token(row["id"])
    return {
        "success": True,
        "data": {
            "token": token,
            "user": {"id": row["id"], "username": row["username"]},
        },
        "error": None,
    }


@app.get("/api/v1/auth/me")
async def auth_me(request: Request):
    user = getattr(request.state, "user", None)
    return {
        "success": True,
        "data": {"user": {"id": user["id"], "username": user["username"]}},
        "error": None,
    }


@app.post("/api/v1/auth/logout")
async def auth_logout(request: Request):
    user = getattr(request.state, "user", None)
    token = user.get("token") if user else None
    if token:
        with _auth_conn() as conn:
            conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
    return {"success": True, "data": {"message": "Logged out"}, "error": None}


@app.post("/api/v1/auth/change-password")
async def change_password(request: Request, payload: dict = Body(...)):
    user = getattr(request.state, "user", None)
    old_password = payload.get("oldPassword") or ""
    new_password = payload.get("newPassword") or ""
    if not old_password or not new_password:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "data": None,
                "error": {"code": "BAD_REQUEST", "message": "oldPassword and newPassword are required"},
            },
        )
    if len(new_password) < 8:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "data": None,
                "error": {"code": "WEAK_PASSWORD", "message": "newPassword must be at least 8 characters"},
            },
        )

    with _auth_conn() as conn:
        row = conn.execute(
            "SELECT id, salt, password_hash FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()
        if not row or not _verify_password(old_password, row["salt"], row["password_hash"]):
            return JSONResponse(
                status_code=401,
                content={
                    "success": False,
                    "data": None,
                    "error": {"code": "INVALID_CREDENTIALS", "message": "Old password is incorrect"},
                },
            )

        salt_b64, pw_hash_b64 = _hash_password(new_password)
        conn.execute(
            "UPDATE users SET salt = ?, password_hash = ?, updated_at = ? WHERE id = ?",
            (salt_b64, pw_hash_b64, datetime.now().isoformat(), user["id"]),
        )

    return {
        "success": True,
        "data": {"message": "Password updated"},
        "error": None,
    }


# Helper functions

def get_session_path(session_id: str) -> Path:
    """Get session file path."""
    return SESSIONS_DIR / f"{session_id}.json"

def get_sessions() -> list:
    """Get all sessions."""
    sessions = []
    for session_file in SESSIONS_DIR.glob("*.json"):
        try:
            with open(session_file, 'r', encoding='utf-8') as f:
                session_data = json.load(f)
            sessions.append(session_data)
        except Exception:
            pass
    # Sort by updatedAt desc
    sessions.sort(key=lambda x: x.get('updatedAt', ''), reverse=True)
    return sessions

def create_session(title: str = None) -> dict:
    """Create a new session."""
    session_id = f"web:{str(uuid.uuid4())[:8]}"
    now = datetime.now().isoformat()
    session_data = {
        "id": session_id,
        "title": title or f"Session {now[:10]}",
        "createdAt": now,
        "updatedAt": now,
        "lastMessageAt": now,
        "messageCount": 0,
        "status": "active",
        "messages": []
    }
    # Save session
    session_path = get_session_path(session_id)
    with open(session_path, 'w', encoding='utf-8') as f:
        json.dump(session_data, f, indent=2, ensure_ascii=False)
    return session_data

def get_session(session_id: str) -> dict:
    """Get session by id."""
    session_path = get_session_path(session_id)
    if not session_path.exists():
        return None
    try:
        with open(session_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None

def save_session(session_data: dict) -> None:
    """Save session to disk."""
    session_id = session_data.get("id")
    session_path = get_session_path(session_id)
    with open(session_path, 'w', encoding='utf-8') as f:
        json.dump(session_data, f, indent=2, ensure_ascii=False)

def delete_session(session_id: str) -> bool:
    """Delete a session."""
    session_path = get_session_path(session_id)
    if session_path.exists():
        session_path.unlink()
        return True
    return False

def add_message(session_id: str, content: str, role: str = "user", files: list = None) -> dict:
    """Add a message to a session."""
    session_data = get_session(session_id)
    if not session_data:
        return None
    
    message_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    message = {
        "id": message_id,
        "sessionId": session_id,
        "role": role,
        "content": content,
        "createdAt": now,
        "sequence": len(session_data['messages']),
        "toolSteps": [],
        "tokenUsage": None,
        "files": files or []  # Add files to message if provided
    }
    session_data['messages'].append(message)
    session_data['messageCount'] = len(session_data['messages'])
    session_data['updatedAt'] = now
    session_data['lastMessageAt'] = now
    save_session(session_data)
    _publish_session_event(session_id, {"type": "message", "message": message})
    return message

async def generate_ai_response(content: str, session_id: str = "web:default", files: list = None) -> str:
    """Generate AI response using nanobot agent."""
    if not NANOBOT_AVAILABLE or agent_loop is None:
        return f"This is a placeholder response for: {content}"
    
    try:
        # If files are provided, include them in the message context
        if files:
            # Add file information to the content
            file_info = "\n\nFiles uploaded:\n"
            for file in files:
                file_info += f"- {file.get('name', 'Unknown')} ({file.get('size', 'Unknown')} bytes, {file.get('type', 'Unknown type')})\n"
            content_with_files = content + file_info
        else:
            content_with_files = content

        response = await agent_loop.process_direct(
            content=content_with_files,
            session_key=session_id,
            channel="web",
            chat_id=session_id,
        )
        return _normalize_agent_response(response, session_id)
            
    except Exception as e:
        logger.error(f"Error generating AI response: {e}")
        import traceback
        traceback.print_exc()
        return f"Error: {str(e)}"


def _sse_event(data: dict) -> str:
    """Build one SSE data frame."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _publish_session_event(session_id: str, payload: dict) -> None:
    """Push one event payload to SSE subscribers of a session."""
    subscribers = session_event_subscribers.get(session_id)
    if not subscribers:
        return
    dead: list[asyncio.Queue] = []
    for q in list(subscribers):
        try:
            q.put_nowait(payload)
        except Exception:
            dead.append(q)
    for q in dead:
        subscribers.discard(q)
    if not subscribers:
        session_event_subscribers.pop(session_id, None)


def _ms_to_iso(ms: int | None) -> str | None:
    """Convert milliseconds timestamp to ISO datetime string."""
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000).isoformat()
    except Exception:
        return None


def _get_last_tools_used_count(session_id: str) -> int:
    """Read latest assistant tools_used count from workspace session jsonl."""
    try:
        workspace = Path(load_config().workspace_path).expanduser()
        session_file = workspace / "sessions" / f"{session_id.replace(':', '_')}.jsonl"
        if not session_file.exists():
            return 0
        lines = session_file.read_text(encoding="utf-8").splitlines()
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if obj.get("role") == "assistant":
                tools_used = obj.get("tools_used")
                if isinstance(tools_used, list):
                    return len(tools_used)
                return 0
    except Exception:
        return 0
    return 0


def _normalize_agent_response(resp, session_id: str | None = None) -> str:
    """Convert agent response (OutboundMessage or str) into UI text."""
    if resp is None:
        text = ""
    elif hasattr(resp, 'content'):
        # OutboundMessage object
        text = (resp.content or "").strip()
    else:
        text = (str(resp) or "").strip()

    if text == EMPTY_FINAL_RESPONSE:
        tool_count = _get_last_tools_used_count(session_id) if session_id else 0
        return f"__NB_I18N_EMPTY_FINAL__:{tool_count}"
    return text


# Session endpoints
@app.get("/api/v1/chat/sessions")
async def get_sessions_endpoint(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100)
):
    """Get session list."""
    try:
        sessions = get_sessions()
        # Pagination
        start_idx = (page - 1) * pageSize
        end_idx = start_idx + pageSize
        paginated_sessions = sessions[start_idx:end_idx]
        return {
            "success": True,
            "data": {
                "items": paginated_sessions,
                "page": page,
                "pageSize": pageSize,
                "total": len(sessions)
            },
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.post("/api/v1/chat/sessions")
async def create_session_endpoint(title: str = None):
    """Create a new session."""
    try:
        session = create_session(title)
        return {
            "success": True,
            "data": session,
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.delete("/api/v1/chat/sessions/{session_id}")
async def delete_session_endpoint(session_id: str):
    """Delete a session."""
    try:
        success = delete_session(session_id)
        if success:
            return {
                "success": True,
                "data": {"message": "Session deleted"},
                "error": None
            }
        else:
            return {
                "success": False,
                "data": None,
                "error": {
                    "code": "NOT_FOUND",
                    "message": "Session not found"
                }
            }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.patch("/api/v1/chat/sessions/{session_id}")
async def rename_session_endpoint(session_id: str, title: str):
    """Rename a session."""
    try:
        session_data = get_session(session_id)
        if not session_data:
            return {
                "success": False,
                "data": None,
                "error": {
                    "code": "NOT_FOUND",
                    "message": "Session not found"
                }
            }
        
        now = datetime.now().isoformat()
        session_data['title'] = title
        session_data['updatedAt'] = now
        save_session(session_data)
        
        return {
            "success": True,
            "data": session_data,
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.get("/api/v1/chat/sessions/{session_id}/messages")
async def get_messages_endpoint(
    session_id: str,
    limit: int = Query(50, ge=1, le=200),
    before: str = None
):
    """Get messages for a session."""
    try:
        session_data = get_session(session_id)
        if not session_data:
            return {
                "success": False,
                "data": None,
                "error": {
                    "code": "NOT_FOUND",
                    "message": "Session not found"
                }
            }
        
        messages = session_data.get('messages', [])
        
        # Apply limit
        if limit:
            messages = messages[-limit:]
        
        return {
            "success": True,
            "data": messages,
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.get("/api/v1/chat/sessions/{session_id}/events/stream")
async def stream_session_events(session_id: str):
    """SSE stream for real-time messages in a session."""
    if not get_session(session_id):
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "data": None,
                "error": {"code": "NOT_FOUND", "message": "Session not found"},
            },
        )

    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
    session_event_subscribers[session_id].add(queue)

    async def event_stream():
        try:
            yield _sse_event({"type": "connected", "sessionId": session_id})
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=20.0)
                    yield _sse_event(item)
                except asyncio.TimeoutError:
                    yield _sse_event({"type": "heartbeat"})
        finally:
            subscribers = session_event_subscribers.get(session_id)
            if subscribers:
                subscribers.discard(queue)
                if not subscribers:
                    session_event_subscribers.pop(session_id, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/v1/chat/sessions/{session_id}/messages")
async def send_message_endpoint(session_id: str, body: dict = Body(...)):
    """Send message to session."""
    try:
        content = body.get("content", "")
        files = body.get("files", [])  # Extract file information if present
        # Add user message
        user_message = add_message(session_id, content, "user", files=files)
        reminder_confirmation = _schedule_web_relative_reminder(session_id, content)
        if reminder_confirmation:
            ai_message = add_message(session_id, reminder_confirmation, "assistant")
            return {
                "success": True,
                "data": {
                    "content": reminder_confirmation,
                    "assistantMessage": ai_message
                },
                "error": None
            }
        # Generate AI response
        ai_response = await generate_ai_response(content, session_id, files=files)
        # Add AI message
        ai_message = add_message(session_id, ai_response, "assistant")
        return {
            "success": True,
            "data": {
                "content": ai_response,
                "assistantMessage": ai_message
            },
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.post("/api/v1/chat/sessions/{session_id}/messages/stream")
async def send_message_stream_endpoint(session_id: str, request: Request):
    """Send message and stream progress updates via SSE."""
    content = ""
    files = []
    uploaded_file = None

    # Check content type to determine how to parse the request
    content_type = request.headers.get("content-type", "")
    
    if content_type.startswith("multipart/form-data"):
        # Parse multipart form data (when file is uploaded)
        form = await request.form()
        content = (form.get("content") or "").strip()
        files_json = form.get("files")
        if files_json:
            try:
                files = json.loads(files_json)
            except Exception:
                files = []
        # Get the actual uploaded file if present
        uploaded_file = form.get("file")
    else:
        # Parse JSON body (when no file is uploaded)
        body = await request.json()
        content = (body.get("content") or "").strip()
        files = body.get("files", [])

    if not content:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "data": None,
                "error": {"code": "BAD_REQUEST", "message": "content is required"},
            },
        )

    # If there's an uploaded file, save it temporarily and add file info to content
    if uploaded_file:
        # Process the uploaded file
        import tempfile
        import os
        from pathlib import Path

        # Create temporary file
        temp_dir = Path(get_data_dir()) / "temp_uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_file_path = temp_dir / f"temp_{uuid.uuid4()}_{uploaded_file.filename}"
        
        # Save uploaded file content
        content_data = await uploaded_file.read()
        with open(temp_file_path, "wb") as f:
            f.write(content_data)
        
        # Add file information to the content for the AI to process
        file_info = f"\n\n用户上传了文件: {uploaded_file.filename} (大小: {len(content_data)} 字节, 类型: {uploaded_file.content_type})\n文件已保存至: {temp_file_path}"
        content_with_file = content + file_info

        # Add user message with file info
        user_message = add_message(session_id, content, "user", files=files)
    else:
        # Add user message without file
        user_message = add_message(session_id, content, "user", files=files)

    # Deterministic fallback for simple relative reminders in Web UI.
    reminder_confirmation = _schedule_web_relative_reminder(session_id, content)
    if reminder_confirmation:
        ai_message = add_message(session_id, reminder_confirmation, "assistant")

        async def quick_stream():
            yield _sse_event({"type": "ack", "userMessage": user_message})
            yield _sse_event(
                {
                    "type": "final",
                    "content": reminder_confirmation,
                    "assistantMessage": ai_message,
                }
            )

        return StreamingResponse(
            quick_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()
        last_progress = ""

        async def on_progress(update: str) -> None:
            nonlocal last_progress
            update = (update or "").strip()
            # Skip empty or duplicate updates to reduce noise/flicker.
            if not update or update == last_progress:
                return
            last_progress = update
            await queue.put({"type": "progress", "content": update})

        async def run_agent():
            try:
                if not NANOBOT_AVAILABLE or agent_loop is None:
                    ai_response = f"This is a placeholder response for: {content}"
                else:
                    # Use content with file info if file was uploaded
                    content_to_send = content_with_file if uploaded_file else content
                    ai_response = await agent_loop.process_direct(
                        content=content_to_send,
                        session_key=session_id,
                        channel="web",
                        chat_id=session_id,
                        on_progress=on_progress,
                    )
                    ai_response = _normalize_agent_response(ai_response, session_id)

                ai_message = add_message(session_id, ai_response, "assistant")
                await queue.put(
                    {
                        "type": "final",
                        "content": ai_response,
                        "assistantMessage": ai_message,
                    }
                )
            except Exception as e:
                logger.error("Error in streaming message endpoint: {}", e)
                await queue.put({"type": "error", "message": str(e)})
            finally:
                await queue.put(None)

        task = asyncio.create_task(run_agent())

        try:
            # Initial ack lets frontend replace temp user message with persisted one if needed.
            yield _sse_event({"type": "ack", "userMessage": user_message})
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield _sse_event(item)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# Config endpoints
@app.get("/api/v1/skills")
async def get_skills():
    """List all skills from workspace and built-in directories."""
    try:
        config = load_config()
        loader = SkillsLoader(Path(config.workspace_path))
        skills = []
        for s in loader.list_skills(filter_unavailable=False):
            metadata = loader.get_skill_metadata(s["name"]) or {}
            skills.append({
                "name": s["name"],
                "source": s["source"],
                "path": s["path"],
                "description": metadata.get("description") or s["name"],
                "deletable": s["source"] == "workspace",
            })
        return {
            "success": True,
            "data": {
                "items": skills,
                "total": len(skills),
            },
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.delete("/api/v1/skills/{name}")
async def delete_skill(name: str, source: str = Query(..., pattern="^(workspace|builtin)$")):
    """Delete a skill directory by name and source."""
    try:
        if source == "builtin":
            return JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "data": None,
                    "error": {"code": "FORBIDDEN", "message": "Built-in skills cannot be deleted"},
                },
            )
        target = _resolve_skill_delete_dir(name, source)
        shutil.rmtree(target)
        return {
            "success": True,
            "data": {
                "message": "Skill deleted",
                "name": name,
                "source": source,
            },
            "error": None
        }
    except FileNotFoundError as e:
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "data": None,
                "error": {"code": "NOT_FOUND", "message": str(e)},
            },
        )
    except ValueError as e:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "data": None,
                "error": {"code": "BAD_REQUEST", "message": str(e)},
            },
        )
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.get("/api/v1/config")
async def get_config():
    """Get configuration."""
    try:
        config = load_config()
        return {
            "success": True,
            "data": config.model_dump(by_alias=True),
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.post("/api/v1/config")
async def save_config(config: dict):
    """Save full configuration."""
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
        
        return {
            "success": True,
            "data": {"message": "Config saved successfully"},
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "SAVE_ERROR",
                "message": str(e)
            }
        }


@app.post("/api/v1/config/backup")
async def backup_config(payload: dict = Body(default={})):
    """Backup config to a named JSON file under ~/.nanobot/config_backups."""
    try:
        filename = _normalize_backup_filename(payload.get("filename", ""))
        config_data = payload.get("config")
        if config_data is None:
            if CONFIG_PATH.exists():
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    config_data = json.load(f)
            else:
                config_data = load_config().model_dump(by_alias=True)

        CONFIG_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = CONFIG_BACKUP_DIR / filename
        with open(backup_path, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "data": {
                "message": "Config backup saved",
                "filename": filename,
                "path": str(backup_path),
            },
            "error": None
        }
    except ValueError as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INVALID_FILENAME",
                "message": str(e)
            }
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "BACKUP_ERROR",
                "message": str(e)
            }
        }


@app.post("/api/v1/config/restore")
async def restore_config(payload: dict = Body(default={})):
    """Restore config from a named JSON backup file."""
    try:
        filename = _normalize_backup_filename(payload.get("filename", ""))
        backup_path = CONFIG_BACKUP_DIR / filename
        if not backup_path.exists():
            return {
                "success": False,
                "data": None,
                "error": {
                    "code": "BACKUP_NOT_FOUND",
                    "message": f"Backup file not found: {filename}"
                }
            }

        with open(backup_path, 'r', encoding='utf-8') as f:
            restored = json.load(f)

        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(restored, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "data": {
                "message": "Config restored",
                "filename": filename,
                "config": restored,
            },
            "error": None
        }
    except ValueError as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INVALID_FILENAME",
                "message": str(e)
            }
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "RESTORE_ERROR",
                "message": str(e)
            }
        }


@app.put("/api/v1/config/agent")
async def update_agent_config(agent: dict):
    """Update agent configuration."""
    try:
        # Common config locations
        config_paths = [
            CONFIG_PATH,
            Path(".") / "config.json",
            Path("~") / ".nanobot" / "config.json"
        ]
        
        config_path = None
        for path in config_paths:
            if path.exists():
                config_path = path
                break
        
        if not config_path:
            config_path = CONFIG_PATH
        
        # Load existing config
        if config_path.exists():
            with open(config_path, 'r') as f:
                config_data = json.load(f)
        else:
            config_data = {}
        
        # Update agents section
        if 'agents' not in config_data:
            config_data['agents'] = {}
        if 'defaults' not in config_data['agents']:
            config_data['agents']['defaults'] = {}
        
        for key, value in agent.items():
            config_data['agents']['defaults'][key] = value
        
        # Save
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, 'w') as f:
            json.dump(config_data, f, indent=2)
        
        return {
            "success": True,
            "data": {"message": "Agent config updated"},
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


# Channel endpoints
@app.get("/api/v1/channels")
async def get_channels():
    """Get channel configuration."""
    try:
        config = load_config()
        return {
            "success": True,
            "data": config.channels.model_dump(by_alias=True) if hasattr(config, 'channels') else {},
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


@app.put("/api/v1/channels")
async def update_channels(channels: dict):
    """Update channel configuration."""
    try:
        config_path = CONFIG_PATH
        
        # Load existing config
        if config_path.exists():
            with open(config_path, 'r') as f:
                config_data = json.load(f)
        else:
            config_data = {}
        
        # Update channels section
        config_data['channels'] = channels
        
        # Save
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, 'w') as f:
            json.dump(config_data, f, indent=2)
        
        return {
            "success": True,
            "data": {"message": "Channels updated"},
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        }


# Status endpoints
@app.get("/api/v1/build-info")
async def get_build_info():
    """Return backend build marker for debugging deployment/version mismatch."""
    return {
        "success": True,
        "data": {
            "service": "nanobot-web",
            "revision": WEB_BACKEND_REVISION,
        },
        "error": None,
    }


@app.get("/api/v1/cron/jobs")
async def get_cron_jobs(
    include_disabled: bool = Query(True),
    channel: str | None = Query(None),
    to: str | None = Query(None),
):
    """List cron jobs for debugging reminders and schedules."""
    try:
        if cron_service is None:
            return {
                "success": True,
                "data": {
                    "enabled": False,
                    "jobs": [],
                    "count": 0,
                },
                "error": None,
            }

        status = cron_service.status()
        jobs = cron_service.list_jobs(include_disabled=include_disabled)

        if channel:
            jobs = [j for j in jobs if (j.payload.channel or "") == channel]
        if to:
            jobs = [j for j in jobs if (j.payload.to or "") == to]

        items = [
            {
                "id": j.id,
                "name": j.name,
                "enabled": j.enabled,
                "deleteAfterRun": j.delete_after_run,
                "schedule": {
                    "kind": j.schedule.kind,
                    "atMs": j.schedule.at_ms,
                    "at": _ms_to_iso(j.schedule.at_ms),
                    "everyMs": j.schedule.every_ms,
                    "expr": j.schedule.expr,
                    "tz": j.schedule.tz,
                },
                "payload": {
                    "kind": j.payload.kind,
                    "message": j.payload.message,
                    "deliver": j.payload.deliver,
                    "channel": j.payload.channel,
                    "to": j.payload.to,
                },
                "state": {
                    "nextRunAtMs": j.state.next_run_at_ms,
                    "nextRunAt": _ms_to_iso(j.state.next_run_at_ms),
                    "lastRunAtMs": j.state.last_run_at_ms,
                    "lastRunAt": _ms_to_iso(j.state.last_run_at_ms),
                    "lastStatus": j.state.last_status,
                    "lastError": j.state.last_error,
                },
                "createdAtMs": j.created_at_ms,
                "createdAt": _ms_to_iso(j.created_at_ms),
                "updatedAtMs": j.updated_at_ms,
                "updatedAt": _ms_to_iso(j.updated_at_ms),
            }
            for j in jobs
        ]

        return {
            "success": True,
            "data": {
                "enabled": status.get("enabled", False),
                "nextWakeAtMs": status.get("next_wake_at_ms"),
                "nextWakeAt": _ms_to_iso(status.get("next_wake_at_ms")),
                "count": len(items),
                "jobs": items,
            },
            "error": None,
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": str(e),
            },
        }


@app.get("/api/v1/status")
async def get_status_v1():
    """Status endpoint v1."""
    return {
        "success": True,
        "data": {
            "status": "running",
            "mode": "limited",
            "nanobot_available": NANOBOT_AVAILABLE,
            "revision": WEB_BACKEND_REVISION,
            "services": {
                "chat": "available",
                "config": "available",
                "status": "available"
            }
        },
        "error": None
    }


@app.post("/api/v1/system/restart-web")
async def restart_web_backend():
    """Restart current nanobot-web/main.py process."""
    script_path = str(Path(__file__).resolve())

    async def _restart_later() -> None:
        await asyncio.sleep(0.8)
        try:
            os.chdir(str(Path(script_path).parent))
        except Exception:
            pass
        logger.warning("Restarting nanobot-web via {}", script_path)
        os.execv(sys.executable, [sys.executable, script_path])

    asyncio.create_task(_restart_later())
    return {
        "success": True,
        "data": {"message": "Restart scheduled"},
        "error": None,
    }


@app.get("/api/status")
async def get_status():
    """Status endpoint."""
    return {
        "status": "running",
        "mode": "limited",
        "services": {
            "chat": "available",
            "config": "available",
            "status": "available"
        }
    }


@app.post("/api/chat")
async def chat(chat_data: dict):
    """Chat endpoint (backward compatibility)."""
    try:
        # Get message and session_id from request body
        message = chat_data.get("message", "")
        session_id = chat_data.get("session_id", "web:default")
        files = chat_data.get("files", [])  # Extract file information if present
        
        if not message:
            return JSONResponse(
                status_code=400,
                content={"error": "Message is required"}
            )
        
        # Generate AI response with file information if present
        response = await generate_ai_response(message, session_id, files=files)
        return {
            "message": message,
            "response": response,
            "session_id": session_id,
            "files": files,  # Include files in response for reference
            "note": "Nanobot integration active" if NANOBOT_AVAILABLE else "Nanobot integration is pending - using placeholder response"
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": f"Chat error: {str(e)}",
                "message": chat_data.get("message", ""),
                "session_id": chat_data.get("session_id", "web:default")
            }
        )


@app.post("/api/config")
async def save_config_compat(config: dict):
    """Save config (backward compatibility)."""
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
        
        return {"success": True, "message": "Config saved"}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


# Voice transcription endpoint
@app.post("/api/v1/voice/transcribe")
async def transcribe_voice(file: UploadFile = File(...)):
    """Transcribe audio file to text using Groq Whisper API."""
    try:
        # Create a temporary file to store the uploaded audio
        import tempfile
        import os
        from pathlib import Path

        # Get data directory for temporary files
        temp_dir = Path(get_data_dir()) / "temp_uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        # Create temporary file with the uploaded audio
        temp_file_path = temp_dir / f"temp_transcribe_{uuid.uuid4()}_{file.filename}"
        with open(temp_file_path, "wb") as temp_file:
            content = await file.read()
            temp_file.write(content)
        
        try:
            # Initialize the transcription provider
            transcriber = GroqTranscriptionProvider()
            transcription = await transcriber.transcribe(temp_file_path)
            
            return {
                "success": True,
                "data": {
                    "text": transcription or "",
                    "language": "auto",  # Currently using auto-detection
                    "duration": 0  # Not implemented yet
                },
                "error": None
            }
        finally:
            # Clean up the temporary file
            if temp_file_path.exists():
                os.remove(temp_file_path)
                
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "TRANSCRIPTION_ERROR",
                "message": str(e)
            }
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
