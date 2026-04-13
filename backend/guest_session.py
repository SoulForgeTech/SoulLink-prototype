"""
Guest session management — rate limiting + decorator for anonymous users.

Storage: in-memory dict (single Gunicorn worker) with optional Redis fallback.
"""

import os
import uuid
import time
import threading
import logging
from collections import defaultdict, deque
from functools import wraps
from typing import Optional, Tuple

from flask import request, jsonify

logger = logging.getLogger(__name__)

# ==================== Limits ====================

GUEST_LIMITS = {
    "text": 50,                 # max messages per rolling window
    "text_window_seconds": 7200,  # 2 hours
    "voice": 5,                 # total voice turns (lifetime)
    "image": 3,                 # total image generations (lifetime)
}

# IP-level abuse prevention
IP_MAX_SESSIONS_PER_HOUR = 20
IP_MAX_MESSAGES_PER_HOUR = 200


# ==================== GuestLimiter ====================

class GuestLimiter:
    """
    Rate limiter for guest sessions.

    Text: rolling 2-hour window (deque of timestamps).
    Voice/Image: lifetime counters (never reset).
    Thread-safe via Lock.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # session_id -> {"text": deque([ts, ...]), "voice": int, "image": int}
        self._sessions: dict = defaultdict(
            lambda: {"text": deque(), "voice": 0, "image": 0}
        )
        # IP -> {"sessions": deque([ts, ...]), "messages": deque([ts, ...])}
        self._ip_state: dict = defaultdict(
            lambda: {"sessions": deque(), "messages": deque()}
        )

    def _clean_window(self, dq: deque, window_seconds: int) -> None:
        """Remove expired timestamps from deque."""
        cutoff = time.time() - window_seconds
        while dq and dq[0] < cutoff:
            dq.popleft()

    def check_and_increment(
        self, session_id: str, kind: str, ip: str = ""
    ) -> Tuple[bool, dict]:
        """
        Atomically check limit and increment usage.

        Returns:
            (allowed, usage_dict)
            If not allowed, usage_dict includes "reset_at" for text.
        """
        with self._lock:
            state = self._sessions[session_id]
            now = time.time()

            if kind == "text":
                window = GUEST_LIMITS["text_window_seconds"]
                self._clean_window(state["text"], window)
                count = len(state["text"])
                limit = GUEST_LIMITS["text"]

                if count >= limit:
                    reset_at = state["text"][0] + window if state["text"] else now + window
                    return False, {
                        "text": count,
                        "voice": state["voice"],
                        "image": state["image"],
                        "reset_at": reset_at,
                    }

                state["text"].append(now)

                # IP-level message tracking
                if ip:
                    ip_state = self._ip_state[ip]
                    self._clean_window(ip_state["messages"], 3600)
                    if len(ip_state["messages"]) >= IP_MAX_MESSAGES_PER_HOUR:
                        return False, self._get_usage(session_id)
                    ip_state["messages"].append(now)

            elif kind in ("voice", "image"):
                limit = GUEST_LIMITS[kind]
                if state[kind] >= limit:
                    return False, self._get_usage(session_id)
                state[kind] += 1

            return True, self._get_usage(session_id)

    def check_ip_session_limit(self, ip: str) -> bool:
        """Check if IP has created too many sessions. Returns True if allowed."""
        with self._lock:
            ip_state = self._ip_state[ip]
            self._clean_window(ip_state["sessions"], 3600)
            if len(ip_state["sessions"]) >= IP_MAX_SESSIONS_PER_HOUR:
                return False
            ip_state["sessions"].append(time.time())
            return True

    def get_usage(self, session_id: str) -> dict:
        """Get current usage for a session."""
        with self._lock:
            return self._get_usage(session_id)

    def _get_usage(self, session_id: str) -> dict:
        """Internal: get usage dict (must hold lock)."""
        state = self._sessions[session_id]
        self._clean_window(state["text"], GUEST_LIMITS["text_window_seconds"])
        return {
            "text": len(state["text"]),
            "voice": state["voice"],
            "image": state["image"],
        }


# Global singleton
_limiter = GuestLimiter()


def get_limiter() -> GuestLimiter:
    return _limiter


# ==================== Decorator ====================

def guest_required(limit_kind: Optional[str] = None):
    """
    Flask decorator: validate X-Guest-Session-Id header and optionally check limit.

    Usage:
        @guest_required()                  # Just validate session_id
        @guest_required(limit_kind="text") # Validate + check text limit
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            session_id = request.headers.get("X-Guest-Session-Id", "").strip()

            # Validate UUID format
            if not session_id:
                return jsonify({"error": "Missing X-Guest-Session-Id header"}), 401
            try:
                uuid.UUID(session_id)
            except ValueError:
                return jsonify({"error": "Invalid session ID format"}), 400

            request.guest_session_id = session_id
            ip = request.headers.get("X-Forwarded-For", request.remote_addr or "")

            # Check limit if specified
            if limit_kind:
                limiter = get_limiter()
                allowed, usage = limiter.check_and_increment(session_id, limit_kind, ip=ip)
                if not allowed:
                    return jsonify({
                        "error": "limit_exceeded",
                        "kind": limit_kind,
                        "limit": GUEST_LIMITS.get(limit_kind, 0),
                        "usage": usage,
                    }), 429
                request.guest_usage = usage

            return f(*args, **kwargs)
        return decorated
    return decorator
