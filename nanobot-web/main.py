"""FastAPI backend for nanobot web interface."""

import sys
import os
from pathlib import Path

# Add nanobot to path
NANOBOT_PATH = Path("/mnt/d/AI/nanobot")
if str(NANOBOT_PATH) not in sys.path:
    sys.path.insert(0, str(NANOBOT_PATH))

from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import json
import uuid
from datetime import datetime
from loguru import logger

# Import nanobot components
from nanobot.bus.queue import MessageBus
from nanobot.agent.loop import AgentLoop
from nanobot.session.manager import SessionManager
from nanobot.config.loader import load_config
from nanobot.providers.litellm_provider import LiteLLMProvider
from nanobot.providers.openai_codex_provider import OpenAICodexProvider
from nanobot.providers.custom_provider import CustomProvider

app = FastAPI(
    title="Nanobot Web API",
    description="Web API for nanobot",
    version="0.1.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
NANOBOT_AVAILABLE = False
agent_loop = None
message_bus = None


async def init_nanobot():
    """Initialize nanobot components."""
    global NANOBOT_AVAILABLE, agent_loop, message_bus
    
    try:
        logger.info("Initializing nanobot...")
        
        # Load config
        config = load_config()
        
        # Create message bus
        message_bus = MessageBus()
        
        # Create session manager
        session_manager = SessionManager(config.workspace_path)
        
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


@app.on_event("startup")
async def startup_event():
    """Startup event handler."""
    print("Starting nanobot web backend...")
    # Create data directories if they don't exist
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    # Initialize nanobot
    await init_nanobot()
    if NANOBOT_AVAILABLE:
        print("Nanobot integration enabled!")
    else:
        print("Backend started in limited mode (nanobot integration pending)")


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
        "mode": "limited - basic API endpoints available"
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


@app.post("/api/v1/chat/sessions/{session_id}/messages")
async def send_message_endpoint(session_id: str, body: dict = Body(...)):
    """Send message to session."""
    try:
        content = body.get("content", "")
        # Add user message
        user_message = add_message(session_id, content, "user")
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
        import os
        config_path = Path.home() / ".nanobot" / "config.json"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(config_path, 'w') as f:
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


@app.put("/api/v1/config/agent")
async def update_agent_config(agent: dict):
    """Update agent configuration."""
    try:
        # Common config locations
        config_paths = [
            Path.home() / ".nanobot" / "config.json",
            Path(".") / "config.json",
            Path("~") / ".nanobot" / "config.json"
        ]
        
        config_path = None
        for path in config_paths:
            if path.exists():
                config_path = path
                break
        
        if not config_path:
            config_path = Path.home() / ".nanobot" / "config.json"
        
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
        config_path = Path.home() / ".nanobot" / "config.json"
        
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
@app.get("/api/v1/status")
async def get_status_v1():
    """Status endpoint v1."""
    return {
        "success": True,
        "data": {
            "status": "running",
            "mode": "limited",
            "nanobot_available": NANOBOT_AVAILABLE,
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
        config_path = Path.home() / ".nanobot" / "config.json"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(config_path, 'w') as f:
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
