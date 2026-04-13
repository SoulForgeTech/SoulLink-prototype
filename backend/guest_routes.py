"""
Guest mode API routes — Flask Blueprint.

All endpoints use X-Guest-Session-Id header for identity.
No @login_required — these are for anonymous users.
"""

import json
import uuid
import logging
from flask import Blueprint, request, jsonify, Response

from guest_session import (
    guest_required,
    get_limiter,
    GUEST_LIMITS,
)
from guest_llm import stream_guest_chat

logger = logging.getLogger(__name__)

guest_bp = Blueprint("guest", __name__, url_prefix="/api/guest")


# ==================== Init ====================

@guest_bp.route("/init", methods=["POST"])
def guest_init():
    """
    Initialize or validate a guest session.
    Returns limits and current usage.

    Client should call this on first visit and on each app reload.
    If no session_id provided, generates one.
    """
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id", "").strip()

    # Validate or generate session_id
    if session_id:
        try:
            uuid.UUID(session_id)
        except ValueError:
            session_id = ""

    if not session_id:
        # IP rate check for new sessions
        ip = request.headers.get("X-Forwarded-For", request.remote_addr or "")
        limiter = get_limiter()
        if not limiter.check_ip_session_limit(ip):
            return jsonify({
                "error": "Too many sessions from this IP. Please try again later.",
            }), 429
        session_id = str(uuid.uuid4())

    limiter = get_limiter()
    usage = limiter.get_usage(session_id)

    return jsonify({
        "session_id": session_id,
        "limits": GUEST_LIMITS,
        "usage": usage,
    })


# ==================== Usage ====================

@guest_bp.route("/usage", methods=["GET"])
@guest_required()
def guest_usage():
    """Get current usage counters for the session."""
    limiter = get_limiter()
    usage = limiter.get_usage(request.guest_session_id)
    return jsonify({
        "usage": usage,
        "limits": GUEST_LIMITS,
    })


# ==================== Chat Stream (SSE) ====================

@guest_bp.route("/chat/stream", methods=["POST"])
@guest_required(limit_kind="text")
def guest_chat_stream():
    """
    Streaming chat for guest users.

    Body: {
      "messages": [{"role": "user|assistant", "content": "..."}],
      "language": "zh-CN"  // optional
    }

    Returns: text/event-stream with events:
      event: text\ndata: {"token": "..."}\n\n
      event: done\ndata: {}\n\n
      event: error\ndata: {"message": "..."}\n\n
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    messages = data.get("messages", [])
    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    # Sanitize messages
    clean_messages = []
    for msg in messages[-50:]:  # Cap at 50 messages
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            clean_messages.append({
                "role": role,
                "content": content[:5000],  # Cap per-message length
            })

    if not clean_messages:
        return jsonify({"error": "No valid messages"}), 400

    language = data.get("language", "zh-CN")

    # Capture values before entering generator (request context ends after return)
    session_id = request.guest_session_id

    def generate():
        import re
        try:
            full_reply = ""
            for token in stream_guest_chat(clean_messages, language=language):
                full_reply += token
                yield f"event: text\ndata: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"

            # Extract [IMAGE:...] tags and generate images
            image_urls = []
            image_pattern = re.findall(r'\[IMAGE:\s*([^\]]+)\]', full_reply)
            if image_pattern:
                limiter = get_limiter()
                for prompt in image_pattern[:1]:  # Max 1 image per message
                    allowed, _ = limiter.check_and_increment(session_id, "image", ip="")
                    if allowed:
                        try:
                            from image_gen import generate_image
                            result = generate_image(prompt=prompt.strip()[:500], user_id=None)
                            if result and result.get("url"):
                                image_urls.append(result["url"])
                                yield f"event: image_generating\ndata: {json.dumps({'status': 'generating'})}\n\n"
                        except Exception as img_err:
                            logger.warning(f"[GUEST-IMAGE] Generation failed: {img_err}")
                    else:
                        logger.info(f"[GUEST-IMAGE] Limit reached for session {session_id}")

                # Strip IMAGE tags from reply text
                full_reply = re.sub(r'\[IMAGE:[^\]]*\]', '', full_reply).strip()

            # Send done event
            limiter = get_limiter()
            usage = limiter.get_usage(session_id)
            done_data = {
                "reply": full_reply,
                "thinking": None,
                "images": [{"url": u} for u in image_urls] if image_urls else [],
                "conversation_id": None,
                "usage": usage,
            }
            yield f"event: done\ndata: {json.dumps(done_data, ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.error(f"[GUEST-CHAT] Stream error: {e}")
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ==================== Image Generation ====================

@guest_bp.route("/image/generate", methods=["POST"])
@guest_required(limit_kind="image")
def guest_image_generate():
    """
    Generate a single image for guest users.
    Uses the same image_gen pipeline but with default appearance.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400

    try:
        from image_gen import generate_image

        # Use default appearance (no custom character)
        result = generate_image(
            prompt=prompt[:500],
            user_id=None,  # Guest — no user-specific appearance
        )

        if result and result.get("url"):
            return jsonify({
                "success": True,
                "url": result["url"],
                "usage": get_limiter().get_usage(request.guest_session_id),
            })
        else:
            return jsonify({"error": "Image generation failed"}), 500

    except Exception as e:
        logger.error(f"[GUEST-IMAGE] Error: {e}")
        return jsonify({"error": str(e)}), 500
