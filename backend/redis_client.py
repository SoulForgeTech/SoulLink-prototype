"""
Redis client with graceful fallback.

If REDIS_URL is unreachable at startup we log a warning and return a no-op
stand-in. Callers must therefore treat every read as "may be None / miss" and
every write as best-effort — never assume Redis is up.
"""

import logging
import os
from typing import Optional

import redis as _redis

log = logging.getLogger(__name__)

_client = None


class _NoOpClient:
    """Silent stand-in used when Redis is unreachable. Reads always miss, writes drop."""

    def get(self, *_a, **_kw): return None
    def set(self, *_a, **_kw): return False
    def setex(self, *_a, **_kw): return False
    def delete(self, *_a, **_kw): return 0
    def expire(self, *_a, **_kw): return False
    def exists(self, *_a, **_kw): return 0
    def incr(self, *_a, **_kw): return None
    def ping(self): return False


def get_client():
    global _client
    if _client is not None:
        return _client

    url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    try:
        c = _redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        c.ping()
        _client = c
        log.info(f"[REDIS] Connected to {url}")
    except Exception as e:
        log.warning(f"[REDIS] Connection failed, using no-op fallback: {e}")
        _client = _NoOpClient()
    return _client


def safe_get(key: str) -> Optional[str]:
    try:
        return get_client().get(key)
    except Exception as e:
        log.debug(f"[REDIS] get({key}) failed: {e}")
        return None


def safe_setex(key: str, ttl_seconds: int, value: str) -> bool:
    try:
        return bool(get_client().setex(key, ttl_seconds, value))
    except Exception as e:
        log.debug(f"[REDIS] setex({key}) failed: {e}")
        return False


def safe_delete(key: str) -> bool:
    try:
        return bool(get_client().delete(key))
    except Exception as e:
        log.debug(f"[REDIS] delete({key}) failed: {e}")
        return False
