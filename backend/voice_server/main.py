"""
SoulLink Voice Server — FastAPI + WebSocket for real-time voice interaction.

Runs as an independent service alongside the Flask backend:
  - Flask :5000 → existing REST API
  - FastAPI :8001 → real-time voice WebSocket

Start:
  cd backend && uvicorn voice_server.main:app --host 0.0.0.0 --port 8001 --workers 1

Note: workers=1 because Qdrant embedded mode is single-process.
"""

import os
import sys
import logging

# Ensure backend/ is on sys.path so we can import database, mem0_engine, etc.
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(_backend_dir, ".env"))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query
from fastapi.middleware.cors import CORSMiddleware

from voice_server.auth_dep import get_current_user_ws
from voice_server.voice_ws import VoicePipelineHandler

# ==================== Logging ====================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("voice_server")

# ==================== FastAPI App ====================

app = FastAPI(
    title="SoulLink Voice Server",
    version="1.0.0",
    docs_url="/docs",
)

# CORS — match Flask backend's allowed origins
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5500").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins + ["*"],  # permissive for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== Health Check ====================

@app.get("/health")
async def health():
    return {"status": "ok", "service": "voice_server"}


# ==================== WebSocket: Optimized Pipeline (Phase 1) ====================

@app.websocket("/ws/voice")
async def ws_voice_pipeline(
    websocket: WebSocket,
    token: str = Query(...),
    conversation_id: str = Query(default=""),
):
    """
    Real-time voice WebSocket — optimized STT → LLM → TTS pipeline.

    Protocol:
      Client → Server:
        - binary frames: audio chunks (webm/pcm)
        - text JSON: {"type": "end_turn"} / {"type": "interrupt"} / {"type": "config", ...}
      Server → Client:
        - binary frames: TTS audio chunks (mp3)
        - text JSON: {"type": "transcript", "text": "...", "is_final": bool}
                     {"type": "reply", "text": "...", "thinking": "..."}
                     {"type": "state", "state": "listening|processing|speaking"}
                     {"type": "done"}
                     {"type": "error", "message": "..."}
    """
    # Authenticate via token query param (WebSocket can't use headers easily)
    user = await get_current_user_ws(token)
    if not user:
        await websocket.close(code=4001, reason="Authentication failed")
        return

    await websocket.accept()
    logger.info(f"[WS] Voice pipeline connected: user={user['_id']}")

    handler = VoicePipelineHandler(websocket, user, conversation_id)
    try:
        await handler.run()
    except WebSocketDisconnect:
        logger.info(f"[WS] Client disconnected: user={user['_id']}")
    except Exception as e:
        logger.error(f"[WS] Unexpected error: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
    finally:
        await handler.cleanup()
        logger.info(f"[WS] Session ended: user={user['_id']}")


# ==================== WebSocket: Gemini Live S2S (Phase 2 — stub) ====================

@app.websocket("/ws/voice-live")
async def ws_voice_live(
    websocket: WebSocket,
    token: str = Query(...),
    conversation_id: str = Query(default=""),
):
    """
    Gemini Live S2S relay — Phase 2 implementation.
    TODO: Implement in voice_live.py
    """
    await websocket.accept()
    await websocket.send_json({
        "type": "error",
        "message": "Gemini Live mode not yet implemented. Use /ws/voice for optimized pipeline.",
    })
    await websocket.close()
