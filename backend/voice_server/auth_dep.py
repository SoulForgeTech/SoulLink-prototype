"""
JWT authentication for FastAPI WebSocket connections.
Adapts the Flask auth.py logic for FastAPI dependency injection.
"""

import os
import logging
from typing import Optional, Dict
from bson import ObjectId

import jwt as pyjwt

logger = logging.getLogger("voice_server.auth")

JWT_SECRET = os.getenv("JWT_SECRET", "")


async def get_current_user_ws(token: str) -> Optional[Dict]:
    """
    Validate JWT token and return user dict.
    Used for WebSocket connections where token is passed as query param.

    Returns:
        User document from MongoDB, or None if auth fails.
    """
    if not token:
        logger.warning("[AUTH] No token provided")
        return None

    if not JWT_SECRET:
        logger.error("[AUTH] JWT_SECRET not configured")
        return None

    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id_str = payload.get("user_id")
        if not user_id_str:
            logger.warning("[AUTH] Token missing user_id")
            return None

        # Import here to avoid circular imports at module level
        from database import db
        user = db.get_user_by_id(ObjectId(user_id_str))
        if not user:
            logger.warning(f"[AUTH] User not found: {user_id_str}")
            return None

        logger.info(f"[AUTH] Authenticated user: {user_id_str}")
        return user

    except pyjwt.ExpiredSignatureError:
        logger.warning("[AUTH] Token expired")
        return None
    except pyjwt.InvalidTokenError as e:
        logger.warning(f"[AUTH] Invalid token: {e}")
        return None
    except Exception as e:
        logger.error(f"[AUTH] Unexpected error: {e}")
        return None
