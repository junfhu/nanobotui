"""FastAPI backend for nanobot web interface."""

import sys
import os
import socket
import subprocess
import asyncio
import re
from pathlib import Path

# Add nanobot to path
NANOBOT_PATH = Path("/mnt/d/AI/nanobot")
if str(NANOBOT_PATH) not in sys.path:
    sys.path.insert(0, str(NANOBOT_PATH))

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import json
import uuid
from datetime import datetime
from loguru import logger
from collections import defaultdict

# Import nanobot components
from nanobot.bus.queue import MessageBus
from nanobot.agent.loop import AgentLoop
from nanobot.session.manager import SessionManager
from nanobot.config.loader import load_config, get_data_dir
from nanobot.providers.litellm_provider import LiteLLMProvider
from nanobot.providers.openai_codex_provider import OpenAICodexProvider
from nanobot.providers.custom_provider import CustomProvider
from nanobot.cron.service import CronService
from nanobot.cron.types import CronJob, CronSchedule

# Global variables
NANOBOT_AVAILABLE = False
agent_loop = None
message_bus = None
gateway_process: subprocess.Popen | None = None
cron_service: CronService | None = None
WEB_BACKEND_REVISION = "reminder-fix-v3-2026-02-22"
session_event_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


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
        gateway_process = subprocess.Popen(
            cmd,
            cwd=str(NANOBOT_PATH),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
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
                    response = await agent_loop.process_direct(
                        content=job.payload.message,
                        session_key=f"cron:{job.id}",
                        channel=job.payload.channel or "web",
                        chat_id=job.payload.to or "web:default",
                    ) or ""
                except Exception as e:
                    logger.warning("Cron agent execution failed for job {}: {}", job.id, e)

            # Web UI has no channel dispatcher; always persist a visible message.
            if job.payload.channel == "web" and job.payload.to:
                add_message(job.payload.to, response or job.payload.message, "assistant")
            return response or job.payload.message

        cron_service.on_job = on_cron_job
        await cron_service.start()

        # Get model from config
        model = config.agents.defaults.model
        
        # Use nanobot's config methods to get provider info
        provider_config = config.get_provider(model)
        provider_name = config.get_provider_name(model)
        api_key = config.get_api_key(model) or ""
        api_base = config.get_api_base(model)
        
        # Fallback: find provider by checking which one has api_key or api_base set
        if not api_key and not provider_name:
            if hasattr(config, 'providers') and config.providers:
                for prov_name in ['vllm', 'custom', 'openrouter', 'deepseek', 'anthropic', 'openai']:
                    prov = getattr(config.providers, prov_name, None)
                    if prov and (prov.api_key or prov.api_base):
                        provider_name = prov_name
                        api_key = prov.api_key or ""
                        api_base = prov.api_base
                        break
        
        # Fallback to environment variable if no API key
        if not api_key:
            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        
        if provider_name == "openai_codex" or model.startswith("openai-codex/"):
            provider = OpenAICodexProvider(default_model=model)
        elif provider_name == "custom":
            provider = CustomProvider(
                api_key=api_key or "no-key",
                api_base=api_base or "http://localhost:8000/v1",
                default_model=model,
            )
        else:
            provider = LiteLLMProvider(
                api_key=api_key or None,
                api_base=api_base,
                default_model=model,
                provider_name=provider_name
            )
        
        # Create agent loop
        agent_loop = AgentLoop(
            bus=message_bus,
            provider=provider,
            workspace=config.workspace_path,
            model=config.agents.defaults.model,
            temperature=config.agents.defaults.temperature,
            max_tokens=config.agents.defaults.max_tokens,
            max_iterations=config.agents.defaults.max_tool_iterations,
            memory_window=config.agents.defaults.memory_window,
            cron_service=cron_service,
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

def add_message(session_id: str, content: str, role: str = "user") -> dict:
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
        "tokenUsage": None
    }
    session_data['messages'].append(message)
    session_data['messageCount'] = len(session_data['messages'])
    session_data['updatedAt'] = now
    session_data['lastMessageAt'] = now
    save_session(session_data)
    _publish_session_event(session_id, {"type": "message", "message": message})
    return message

async def generate_ai_response(content: str, session_id: str = "web:default") -> str:
    """Generate AI response using nanobot agent."""
    if not NANOBOT_AVAILABLE or agent_loop is None:
        return f"This is a placeholder response for: {content}"
    
    try:
        response = await agent_loop.process_direct(
            content=content,
            session_key=session_id,
            channel="web",
            chat_id=session_id,
        )
        return response
            
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
        # Add user message
        user_message = add_message(session_id, content, "user")
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
        ai_response = await generate_ai_response(content, session_id)
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
async def send_message_stream_endpoint(session_id: str, body: dict = Body(...)):
    """Send message and stream progress updates via SSE."""
    content = (body.get("content") or "").strip()
    if not content:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "data": None,
                "error": {"code": "BAD_REQUEST", "message": "content is required"},
            },
        )

    # Persist user message immediately.
    user_message = add_message(session_id, content, "user")

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
                    ai_response = await agent_loop.process_direct(
                        content=content,
                        session_key=session_id,
                        channel="web",
                        chat_id=session_id,
                        on_progress=on_progress,
                    )

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
        
        if not message:
            return JSONResponse(
                status_code=400,
                content={"error": "Message is required"}
            )
        
        # Fallback to placeholder response
        return {
            "message": message,
            "response": f"This is a placeholder response for: {message}",
            "session_id": session_id,
            "note": "Nanobot integration is pending - using placeholder response"
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
