"""
Lightweight timing helper — used to instrument the chat hot path so we can
attribute latency without pulling in a full APM. Logs only when elapsed
exceeds a threshold to avoid flooding production logs.
"""

import logging
import time
from contextlib import contextmanager

log = logging.getLogger(__name__)


@contextmanager
def timed(label: str, *, threshold_ms: float = 0.0):
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        if elapsed_ms >= threshold_ms:
            log.info(f"[TIMING] {label}: {elapsed_ms:.1f}ms")


class StepTimer:
    """
    Accumulating timer for instrumenting a multi-step pipeline (e.g. one chat
    request). Use .mark(label) at each checkpoint; .summary() emits one log
    line with all step deltas, keeping per-request log volume low.
    """

    def __init__(self, name: str):
        self.name = name
        self._start = time.perf_counter()
        self._last = self._start
        self._steps = []  # list of (label, delta_ms)

    def mark(self, label: str):
        now = time.perf_counter()
        delta_ms = (now - self._last) * 1000.0
        self._steps.append((label, delta_ms))
        self._last = now

    def summary(self):
        total_ms = (time.perf_counter() - self._start) * 1000.0
        parts = [f"{lbl}={ms:.0f}" for lbl, ms in self._steps]
        log.info(f"[TIMING:{self.name}] total={total_ms:.0f}ms | " + " ".join(parts))
