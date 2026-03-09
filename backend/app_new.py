"""
SoulLink Backend - 支持多用户的版本
使用 MongoDB + Google OAuth + 用户隔离的 Workspace
"""

import os
import json
import logging
import uuid
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from flask_cors import CORS
from bson import ObjectId
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 导入自定义模块
from database import db
from auth import (
    GoogleOAuth,
    JWTAuth,
    login_required,
    get_current_user,
    get_current_user_id,
    handle_google_login,
    handle_email_register,
    handle_email_login,
    handle_verify_email,
    handle_resend_code,
    validate_refresh_token,
    revoke_refresh_token,
    create_refresh_token,
)
from workspace_manager import workspace_manager
from anythingllm_api import AnythingLLMAPI
from image_gen import process_image_markers
import requests as _requests


# ==================== Shared Knowledge Base (Psychology) ====================
KB_WORKSPACE_SLUG = os.getenv("KB_WORKSPACE_SLUG", "soullink_test")


def query_shared_kb(user_message: str, top_k: int = 3, min_score: float = 0.25) -> str:
    """
    Query the shared psychology knowledge base via vector search (no LLM call).
    Uses /api/v1/workspace/{slug}/vector-search for pure similarity lookup.
    Returns relevant context string, or empty string if nothing found.
    """
    logger = logging.getLogger(__name__)

    # Quick keyword check — skip KB for casual chat
    psych_keywords = [
        '焦虑', '抑郁', '失眠', '压力', '情绪', '心理', '自卑', '社恐', '孤独',
        '内耗', '焦躁', '恐惧', '创伤', '暴食', '厌食', '强迫', '拖延', '自残',
        '分手', '失恋', '原生家庭', '依恋', '安全感', '讨好型', '回避型', 'PUA',
        '冷暴力', '精神内耗', '情绪管理', '正念', '认知', '疗愈', '治愈',
        'anxiety', 'depress', 'insomnia', 'stress', 'emotion', 'therapy',
        'mental', 'trauma', 'lonely', 'self-esteem', 'attachment',
        '不开心', '难过', '痛苦', '绝望', '崩溃', '烦', '累', '想哭',
    ]
    msg_lower = user_message.lower()
    if not any(kw in msg_lower for kw in psych_keywords):
        return ""

    try:
        base_url = os.getenv("ANYTHINGLLM_BASE_URL", "http://localhost:3001")
        api_key = os.getenv("ANYTHINGLLM_API_KEY", "")
        resp = _requests.post(
            f"{base_url}/api/v1/workspace/{KB_WORKSPACE_SLUG}/vector-search",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={"query": user_message, "topN": top_k},
            timeout=10
        )
        if resp.status_code != 200:
            logger.warning(f"[KB] Vector search HTTP {resp.status_code}")
            return ""

        data = resp.json()
        results = data.get("results", [])

        # Filter by relevance score and build context
        context_parts = []
        for r in results:
            score = r.get("score", 0)
            if score < min_score:
                continue
            text = r.get("text", "")
            title = r.get("metadata", {}).get("title", "")
            # Strip metadata header if present
            if "<document_metadata>" in text:
                text = text.split("</document_metadata>")[-1].strip()
            # Truncate to 400 chars per chunk
            if len(text) > 400:
                text = text[:400] + "..."
            if text:
                context_parts.append(f"[{title}]: {text}")

        if context_parts:
            ctx = (
                "\n\n[心理知识参考 / Psychology Reference — "
                "请自然融入回复，不要直接引用来源]\n"
                + "\n".join(context_parts)
            )
            return ctx

        return ""
    except Exception:
        return ""


from personality_engine import (
    get_questions,
    calculate_dimensions,
    draw_tarot_cards,
    generate_personality_profile
)

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 创建 Flask 应用
app = Flask(__name__)

# CORS 配置 - 生产环境应限制来源
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}}, supports_credentials=True)


# ==================== 健康检查 ====================

@app.route("/")
def home():
    """健康检查端点"""
    return jsonify({
        "status": "running",
        "service": "SoulLink Backend",
        "version": "2.0.0"
    })


@app.route("/admin")
def admin_panel():
    """管理员面板"""
    admin_html_path = os.path.join(os.path.dirname(__file__), "admin_panel.html")
    try:
        with open(admin_html_path, "r", encoding="utf-8") as f:
            return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}
    except FileNotFoundError:
        return "Admin panel not found", 404


@app.route("/health")
def health():
    """详细健康检查"""
    try:
        # 检查 MongoDB 连接
        db.db.command("ping")
        mongo_status = "connected"
    except Exception as e:
        mongo_status = f"error: {str(e)}"

    return jsonify({
        "status": "healthy" if mongo_status == "connected" else "degraded",
        "mongodb": mongo_status
    })


# ==================== 认证接口 ====================

@app.route("/api/auth/google/url", methods=["GET"])
def get_google_auth_url():
    """获取 Google OAuth 授权 URL"""
    state = request.args.get("state", "")
    auth_url = GoogleOAuth.get_auth_url(state)
    return jsonify({"url": auth_url})


@app.route("/api/auth/google/callback", methods=["POST"])
def google_callback():
    """
    Google OAuth 回调处理
    接收前端传来的授权码或 ID Token
    """
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    # 方式1: 使用授权码
    if "code" in data:
        code = data["code"]

        # 用授权码换取 token
        token_data = GoogleOAuth.exchange_code(code)
        if not token_data:
            return jsonify({"error": "Failed to exchange authorization code"}), 400

        access_token = token_data.get("access_token")
        if not access_token:
            return jsonify({"error": "No access token in response"}), 400

        # 获取用户信息
        user_info = GoogleOAuth.get_user_info(access_token)
        if not user_info:
            return jsonify({"error": "Failed to get user info"}), 400

    # 方式2: 使用 ID Token（推荐，更安全）
    elif "id_token" in data:
        id_token = data["id_token"]

        # 验证 ID Token
        user_info = GoogleOAuth.verify_id_token(id_token)
        if not user_info:
            return jsonify({"error": "Invalid ID token"}), 400

        # 转换字段名（tokeninfo 端点返回的字段名略有不同）
        user_info = {
            "id": user_info.get("sub"),
            "email": user_info.get("email"),
            "name": user_info.get("name", user_info.get("email", "").split("@")[0]),
            "picture": user_info.get("picture")
        }

    # 方式3: 使用 credential（Google One Tap）
    elif "credential" in data:
        credential = data["credential"]

        # credential 就是 ID token
        user_info = GoogleOAuth.verify_id_token(credential)
        if not user_info:
            return jsonify({"error": "Invalid credential"}), 400

        user_info = {
            "id": user_info.get("sub"),
            "email": user_info.get("email"),
            "name": user_info.get("name", user_info.get("email", "").split("@")[0]),
            "picture": user_info.get("picture")
        }

    else:
        return jsonify({"error": "Missing code, id_token, or credential"}), 400

    # 处理登录/注册
    result = handle_google_login(user_info, request.headers.get("User-Agent", ""))

    return jsonify({
        "success": True,
        "token": result["token"],
        "refresh_token": result.get("refresh_token"),
        "user": result["user"],
        "is_new_user": result["is_new_user"]
    })


@app.route("/api/auth/verify", methods=["GET"])
@login_required
def verify_token():
    """验证 token 是否有效"""
    user = get_current_user()
    return jsonify({
        "valid": True,
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "avatar_url": user.get("avatar_url"),
            "workspace_slug": user.get("workspace_slug"),
            "settings": user.get("settings", {})
        }
    })


@app.route("/api/models", methods=["GET"])
@login_required
def get_available_models():
    """获取可用的 AI 模型列表"""
    from workspace_manager import WorkspaceManager
    models = WorkspaceManager.get_available_models()
    return jsonify({"models": models})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    """登出 — 吊销 refresh token（不要求 JWT 有效，因为可能已过期）"""
    data = request.get_json() or {}
    refresh_token = data.get("refresh_token")
    if refresh_token:
        revoke_refresh_token(refresh_token)
    return jsonify({"success": True, "message": "Logged out"})


@app.route("/api/auth/refresh", methods=["POST"])
def refresh_auth_token():
    """用 refresh token 换取新的 JWT access token"""
    data = request.get_json()
    if not data or "refresh_token" not in data:
        return jsonify({"error": "Missing refresh_token"}), 400

    token_doc = validate_refresh_token(data["refresh_token"])
    if not token_doc:
        return jsonify({"error": "Invalid or expired refresh token"}), 401

    user = db.get_user_by_id(token_doc["user_id"])
    if not user:
        return jsonify({"error": "User not found"}), 401

    # 签发新 JWT
    new_token = JWTAuth.create_token(str(user["_id"]), user["email"])

    return jsonify({
        "success": True,
        "token": new_token,
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "avatar_url": user.get("avatar_url"),
            "workspace_slug": user.get("workspace_slug"),
            "settings": user.get("settings", {})
        }
    })


# ==================== 邮箱认证接口 ====================

@app.route("/api/auth/register", methods=["POST"])
def register():
    """邮箱注册"""
    data = request.get_json()

    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    name = data.get("name", "").strip()

    if not email or not password:
        return jsonify({"success": False, "error": "Email and password are required"}), 400

    result = handle_email_register(email, password, name if name else None)

    if result.get("success"):
        return jsonify(result)
    else:
        return jsonify(result), 400


@app.route("/api/auth/login", methods=["POST"])
def login():
    """邮箱登录"""
    data = request.get_json()

    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"success": False, "error": "Email and password are required"}), 400

    result = handle_email_login(email, password, request.headers.get("User-Agent", ""))

    if result.get("success"):
        return jsonify(result)
    else:
        # 对未验证用户返回 200（携带 requires_verification 让前端跳转）
        if result.get("requires_verification"):
            return jsonify(result), 200
        return jsonify(result), 401


@app.route("/api/auth/verify-email", methods=["POST"])
def verify_email():
    """验证邮箱验证码"""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    email = data.get("email", "").strip().lower()
    code = data.get("code", "").strip()

    if not email or not code:
        return jsonify({"success": False, "error": "Email and code are required"}), 400

    if len(code) != 6 or not code.isdigit():
        return jsonify({"success": False, "error": "Invalid code format"}), 400

    result = handle_verify_email(email, code, request.headers.get("User-Agent", ""))

    if result.get("success"):
        return jsonify(result)
    else:
        return jsonify(result), 400


@app.route("/api/auth/resend-code", methods=["POST"])
def resend_code():
    """重新发送验证码"""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    email = data.get("email", "").strip().lower()
    if not email:
        return jsonify({"success": False, "error": "Email is required"}), 400

    result = handle_resend_code(email)

    if result.get("success"):
        return jsonify(result)
    else:
        return jsonify(result), 429


# ==================== 用户接口 ====================

@app.route("/api/user/profile", methods=["GET"])
@login_required
def get_profile():
    """获取用户资料"""
    user = get_current_user()
    return jsonify({
        "id": str(user["_id"]),
        "email": user["email"],
        "name": user["name"],
        "avatar_url": user.get("avatar_url"),
        "workspace_slug": user.get("workspace_slug"),
        "settings": user.get("settings", {}),
        "created_at": user.get("created_at").isoformat() if user.get("created_at") else None
    })


@app.route("/api/user/profile", methods=["PUT"])
@login_required
def update_profile():
    """更新用户资料（昵称、头像等）"""
    user_id = get_current_user_id()
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    updates = {}
    from datetime import datetime

    new_name = None

    # 更新昵称
    if "name" in data:
        name = data["name"].strip()
        if len(name) < 2:
            return jsonify({"error": "Nickname must be at least 2 characters"}), 400
        if len(name) > 20:
            return jsonify({"error": "Nickname must be 20 characters or less"}), 400
        updates["name"] = name
        new_name = name

    # 更新头像
    if "avatar_url" in data:
        avatar_url = data["avatar_url"]
        # 验证头像数据（支持 Cloudinary URL, data URL, 或相对路径）
        if avatar_url:
            if avatar_url.startswith("https://res.cloudinary.com/"):
                # Cloudinary CDN URL — preferred
                pass
            elif avatar_url.startswith("data:image/"):
                # Base64 图片（color avatar 等小图），限制大小
                if len(avatar_url) > 500000:
                    return jsonify({"error": "Avatar image is too large"}), 400
            elif avatar_url.startswith("images/"):
                # 预设头像路径
                pass
            else:
                return jsonify({"error": "Invalid avatar format"}), 400
            updates["avatar_url"] = avatar_url

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    updates["updated_at"] = datetime.utcnow()

    result = db.db["users"].update_one(
        {"_id": user_id},
        {"$set": updates}
    )

    if result.modified_count > 0:
        # 如果昵称改变了，同步更新 AnythingLLM 的 system prompt
        if new_name:
            try:
                from workspace_manager import workspace_manager
                prompt_result = workspace_manager.update_system_prompt(user_id, new_name)
                if not prompt_result.get("success"):
                    logger.warning(f"Failed to update system prompt: {prompt_result.get('error')}")
                    # 不返回错误，因为数据库已更新成功
            except Exception as e:
                logger.warning(f"Error updating system prompt: {e}")

        return jsonify({"success": True})
    else:
        return jsonify({"error": "No changes made"}), 400


@app.route("/api/upload-avatar", methods=["POST"])
@login_required
def upload_avatar():
    """Upload avatar image to Cloudinary, return CDN URL."""
    user_id = get_current_user_id()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file or not file.filename:
        return jsonify({"error": "Empty file"}), 400

    # Validate MIME type
    if not file.content_type or not file.content_type.startswith("image/"):
        return jsonify({"error": "File must be an image"}), 400

    img_data = file.read()

    # Limit: 500KB after frontend compression — should be plenty for avatars
    if len(img_data) > 512 * 1024:
        return jsonify({"error": "Image too large (max 500KB)"}), 400

    try:
        import image_gen as _img_mod
        import cloudinary.uploader
        _img_mod._ensure_cloudinary()
        if not _img_mod._cloudinary_configured:
            return jsonify({"error": "Cloud storage not configured"}), 500

        from datetime import datetime, timezone
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        public_id = f"soullink/avatars/{user_id}_{timestamp}"
        result = cloudinary.uploader.upload(
            img_data,
            public_id=public_id,
            resource_type="image",
            overwrite=True,
            transformation=[{"width": 400, "height": 400, "crop": "fill", "quality": "auto"}],
        )
        url = result.get("secure_url", "")
        if not url:
            return jsonify({"error": "Upload failed"}), 500

        logger.info(f"[AVATAR] Uploaded for user {user_id}: {url[:80]}")
        return jsonify({"success": True, "url": url})
    except Exception as e:
        logger.error(f"[AVATAR] Upload error: {e}")
        return jsonify({"error": "Upload failed"}), 500


@app.route("/api/user/settings", methods=["PUT"])
@login_required
def update_settings():
    """更新用户设置"""
    user_id = get_current_user_id()
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    # 只允许更新特定字段
    allowed_fields = ["theme", "language", "notifications_enabled", "model", "companion_name", "companion_avatar", "companion_gender", "companion_subtype", "companion_relationship", "chat_background", "voice_id", "voice_name", "kb_enabled"]
    updates = {f"settings.{k}": v for k, v in data.items() if k in allowed_fields}

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    # 验证 model 值
    if "model" in data:
        from workspace_manager import WorkspaceManager
        if data["model"] not in WorkspaceManager.SUPPORTED_MODELS:
            return jsonify({"error": "Unsupported model"}), 400

    # 验证 companion_name 值
    if "companion_name" in data:
        cname = data["companion_name"].strip()
        if len(cname) < 1 or len(cname) > 20:
            return jsonify({"error": "Companion name must be 1-20 characters"}), 400

    # 验证 companion_avatar 值
    if "companion_avatar" in data:
        avatar_val = data["companion_avatar"]
        if not isinstance(avatar_val, str):
            return jsonify({"error": "Invalid avatar data"}), 400
        # Allow: relative paths (images/...), Cloudinary URLs (https://res.cloudinary.com/...),
        # or small data URLs as fallback
        if avatar_val.startswith("data:") and len(avatar_val) > 500000:
            return jsonify({"error": "Avatar image too large (max 500KB)"}), 400

    # 验证 companion_gender 值
    if "companion_gender" in data:
        if data["companion_gender"] not in ("male", "female"):
            return jsonify({"error": "companion_gender must be 'male' or 'female'"}), 400

    # 验证 companion_subtype 值
    if "companion_subtype" in data:
        from personality_engine import COMPANION_SUBTYPES
        if data["companion_subtype"] not in COMPANION_SUBTYPES:
            return jsonify({"error": "Invalid companion_subtype"}), 400

    db.db["users"].update_one(
        {"_id": user_id},
        {"$set": updates}
    )

    # 如果伴侣风格改变了，重新生成 persona 并更新 system prompt
    if "companion_subtype" in data or "companion_gender" in data or "companion_relationship" in data:
        logger.info(f"[STYLE] Companion style changed! data={data}")
        try:
            from personality_engine import generate_personality_profile, COMPANION_SUBTYPES
            # 从数据库重新读取最新用户数据（不用缓存的 request.current_user）
            user = db.db["users"].find_one({"_id": user_id})
            subtype = data.get("companion_subtype") or user.get("settings", {}).get("companion_subtype", "female_gentle")
            gender = data.get("companion_gender") or user.get("settings", {}).get("companion_gender", "female")
            language = user.get("settings", {}).get("language", "en")
            logger.info(f"[STYLE] subtype={subtype}, gender={gender}, language={language}")

            # 如果自定义角色性格生效中，跳过 persona 重新生成和自动改名
            custom_persona = user.get("settings", {}).get("custom_persona")
            if custom_persona:
                logger.info(f"[STYLE] Custom persona active, skipping persona regen & auto-rename")
            else:
                pt = user.get("personality_test") or {}
                if pt.get("completed"):
                    # 重新生成 persona
                    logger.info(f"[STYLE] Regenerating persona for subtype={subtype}")
                    new_profile = generate_personality_profile(
                        pt["dimensions"], pt["tarot_cards"], language, subtype
                    )
                    db.db["users"].update_one(
                        {"_id": user_id},
                        {"$set": {"personality_test.personality_profile": new_profile}}
                    )
                    logger.info(f"[STYLE] New persona saved, length={len(new_profile)}")
                else:
                    logger.info(f"[STYLE] No personality test completed, skipping persona regen")

                # 名字始终保持用户自己设置的，切换子类型不自动改名
                logger.info(f"[STYLE] Keeping user's companion name unchanged")

            # 更新 system prompt（update_system_prompt 内部会自动优先使用 custom_persona）
            logger.info(f"[STYLE] Updating system prompt for user {user['name']}")
            result = workspace_manager.update_system_prompt(user_id, user["name"])
            logger.info(f"[STYLE] update_system_prompt result: {result}")
        except Exception as e:
            logger.warning(f"Error updating companion style: {e}")
            import traceback
            traceback.print_exc()

    # 如果语言或AI昵称改变了，同步更新 system prompt
    elif "language" in data or "companion_name" in data:
        try:
            user = get_current_user()
            workspace_manager.update_system_prompt(
                user_id, user["name"],
                language=data.get("language"),
                companion_name=data.get("companion_name")
            )
        except Exception as e:
            logger.warning(f"Error updating system prompt: {e}")

    # 如果模型改变了，同步更新 workspace 的 LLM 设置
    if "model" in data:
        try:
            result = workspace_manager.update_workspace_model(user_id, data["model"])
            if not result.get("success"):
                logger.warning(f"Failed to update workspace model: {result.get('error')}")
                return jsonify({"error": f"Model saved but failed to apply: {result.get('error')}"}), 500
        except Exception as e:
            logger.warning(f"Error updating workspace model: {e}")
            return jsonify({"error": "Failed to apply model change"}), 500

    return jsonify({"success": True})


# ==================== Feedback 接口 ====================

@app.route("/api/feedback", methods=["POST"])
@login_required
def submit_feedback():
    """提交用户反馈"""
    user_id = get_current_user_id()
    user = get_current_user()
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    content = data.get("content", "").strip()
    feedback_type = data.get("type", "other")

    if not content:
        return jsonify({"error": "Feedback content is required"}), 400

    if len(content) > 1000:
        return jsonify({"error": "Feedback must be 1000 characters or less"}), 400

    if feedback_type not in ["suggestion", "bug", "other"]:
        feedback_type = "other"

    from datetime import datetime
    feedback_doc = {
        "user_id": user_id,
        "user_email": user.get("email", ""),
        "user_name": user.get("name", ""),
        "type": feedback_type,
        "content": content,
        "created_at": datetime.utcnow(),
        "status": "new"
    }

    try:
        db.db["feedbacks"].insert_one(feedback_doc)
        logger.info(f"Feedback submitted by {user.get('email')}: [{feedback_type}] {content[:50]}...")
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to save feedback: {e}")
        return jsonify({"error": "Failed to save feedback"}), 500


@app.route("/api/contact", methods=["POST"])
def contact_message():
    """官网留言表单（公开接口，无需登录）"""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message is required"}), 400
    if len(message) > 2000:
        return jsonify({"error": "Message must be 2000 characters or less"}), 400

    name = (data.get("name") or "").strip()[:100]
    email = (data.get("email") or "").strip()[:200]

    from datetime import datetime
    doc = {
        "name": name or "Anonymous",
        "email": email or "",
        "message": message,
        "source": "website",
        "created_at": datetime.utcnow(),
        "status": "new"
    }

    try:
        db.db["contact_messages"].insert_one(doc)
        logger.info(f"[CONTACT] New message from {name or 'Anonymous'}: {message[:50]}...")
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"[CONTACT] Failed to save: {e}")
        return jsonify({"error": "Failed to save message"}), 500


# ==================== Workspace 接口 ====================

@app.route("/api/workspace", methods=["GET"])
@login_required
def get_workspace():
    """获取当前用户的 workspace"""
    user_id = get_current_user_id()

    result = workspace_manager.get_or_create_workspace(user_id)

    if not result["success"]:
        return jsonify({"error": result.get("error")}), 500

    workspace = result["workspace"]
    return jsonify({
        "success": True,
        "workspace": {
            "id": str(workspace["_id"]),
            "slug": workspace["slug"],
            "created_at": workspace.get("created_at").isoformat() if workspace.get("created_at") else None,
            "stats": workspace.get("stats", {})
        },
        "created": result.get("created", False)
    })


@app.route("/api/workspace/status", methods=["GET"])
@login_required
def get_workspace_status():
    """获取 workspace 状态"""
    user_id = get_current_user_id()
    status = workspace_manager.get_workspace_status(user_id)
    return jsonify(status)


# ==================== 聊天接口 ====================

@app.route("/api/chat", methods=["POST"])
@login_required
def chat():
    """
    发送聊天消息
    """
    try:
        logger.info("=== Chat endpoint called ===")
        user_id = get_current_user_id()
        user = get_current_user()
        logger.info(f"User ID: {user_id}")

        data = request.get_json()
        if not data or "message" not in data:
            return jsonify({"error": "Missing message parameter"}), 400

        user_message = data["message"]
        conversation_id = data.get("conversation_id")
        show_thinking = data.get("show_thinking", False)
        attachments = data.get("attachments")  # [{name, mime, contentString}]
        # Voice message fields
        msg_type = data.get("type", "text")  # "text" or "voice"
        user_audio_url = data.get("audio_url")  # user's voice audio URL
        user_audio_duration = data.get("audio_duration")  # seconds
        logger.info(f"Message: {user_message[:50]}... | type={msg_type} | show_thinking={show_thinking} | attachments={len(attachments) if attachments else 0}")

        # 确保用户有 workspace
        logger.info("Getting or creating workspace...")
        workspace_result = workspace_manager.get_or_create_workspace(user_id)
        logger.info(f"Workspace result: {workspace_result}")
        if not workspace_result["success"]:
            logger.error(f"Failed to get workspace: {workspace_result}")
            return jsonify({"error": f"Failed to get workspace: {workspace_result.get('error', 'Unknown')}"}), 500
    except Exception as e:
        logger.error(f"Early chat error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

    workspace = workspace_result["workspace"]
    workspace_slug = workspace["slug"]

    # Sync model + prompt (with Mem0 semantic memory if enabled)
    try:
        user_model = user.get("settings", {}).get("model", "gemini")
        if user_model in workspace_manager.SUPPORTED_MODELS:
            model_config = workspace_manager.SUPPORTED_MODELS[user_model]
            model_temp = 1.0 if user_model == "grok" else 0.9 if user_model == "gpt4o" else 0.7
            import requests as req
            sync_payload = {
                "chatProvider": model_config["chatProvider"],
                "chatModel": model_config["chatModel"],
                "openAiTemp": model_temp,
            }
            if os.environ.get("MEM0_ENABLED", "false").lower() == "true":
                try:
                    from mem0_engine import search_relevant_memories, get_permanent_memories, build_memory_text as mem0_build_text
                    uid_str = str(user_id)
                    permanent = get_permanent_memories(uid_str)
                    relevant = search_relevant_memories(uid_str, user_message)
                    memory_text = mem0_build_text(permanent, relevant)
                    fresh_prompt = workspace_manager.build_prompt_for_user(user_id, memory_text=memory_text)
                    sync_payload["openAiPrompt"] = fresh_prompt
                except Exception as e:
                    logger.warning(f"[MEM0] Pre-chat search failed: {e}")
            req.post(
                f"{workspace_manager.anythingllm_base_url}/api/v1/workspace/{workspace_slug}/update",
                headers={
                    "Authorization": f"Bearer {workspace_manager.anythingllm_api_key}",
                    "Content-Type": "application/json"
                },
                json=sync_payload,
                timeout=5
            )
    except Exception as e:
        logger.warning(f"Model sync check failed (non-fatal): {e}")

    # 获取或创建对话
    if conversation_id:
        try:
            conv_id = ObjectId(conversation_id)
            conversation = db.get_conversation(conv_id, user_id)
            if not conversation:
                # 对话不存在，创建新的
                conversation = db.create_conversation(user_id)
        except Exception:
            conversation = db.create_conversation(user_id)
    else:
        conversation = db.get_active_conversation(user_id)

    # 记录是否是新对话的第一条消息（用于后续自动生成标题）
    is_first_message = conversation.get("metadata", {}).get("total_messages", 0) == 0

    # 保存用户消息（图片附件上传 Cloudinary 持久化）
    attachment_meta = None
    if attachments:
        attachment_meta = []
        for a in attachments:
            meta = {"name": a.get("name", "file"), "mime": a.get("mime", ""), "isImage": a.get("mime", "").startswith("image/")}
            # 用户图片 → 上传 Cloudinary 保存 URL
            if meta["isImage"] and a.get("contentString"):
                try:
                    from image_gen import upload_to_cloudinary
                    b64 = a["contentString"].split(",", 1)[-1] if "," in a["contentString"] else a["contentString"]
                    url = upload_to_cloudinary(b64, str(user_id))
                    if url:
                        meta["url"] = url
                except Exception as e:
                    logger.warning(f"[CHAT] User image upload failed: {e}")
            attachment_meta.append(meta)
    db.add_message_to_conversation(
        conversation["_id"],
        user_id,
        "user",
        user_message,
        attachments=attachment_meta,
        msg_type=msg_type if msg_type != "text" else None,
        audio_url=user_audio_url,
        audio_duration=float(user_audio_duration) if user_audio_duration else None
    )

    # 调用 AnythingLLM
    try:
        logger.info(f"=== Chat Debug ===")
        logger.info(f"Workspace slug: {workspace_slug}")
        logger.info(f"Base URL: {workspace_manager.anythingllm_base_url}")
        logger.info(f"API Key: {workspace_manager.anythingllm_api_key[:10]}...")

        api = AnythingLLMAPI(
            base_url=workspace_manager.anythingllm_base_url,
            api_key=workspace_manager.anythingllm_api_key,
            workspace_slug=workspace_slug
        )

        logger.info(f"AnythingLLM API client created successfully")

        # 获取最近的对话历史作为上下文
        recent_messages = conversation.get("messages", [])[-10:]  # 最近10条消息

        # 联网搜索增强：判断是否需要实时信息，自动搜索并注入结果
        try:
            from web_search import enhance_message_with_search
            enhanced_msg, did_search = enhance_message_with_search(user_message)
            if did_search:
                message_to_send = enhanced_msg
            else:
                message_to_send = user_message
        except Exception as e:
            logger.warning(f"[SEARCH] Enhancement failed, using original: {e}")
            message_to_send = user_message

        # Voice hint so AI knows this was spoken, not typed
        if msg_type == "voice":
            message_to_send = f"[Voice message] {message_to_send}"

        # 心理知识库增强：如果用户开启了 KB，查询共享知识库注入上下文
        try:
            kb_on = user.get("settings", {}).get("kb_enabled", False)
            if kb_on:
                kb_context = query_shared_kb(user_message)
                if kb_context:
                    message_to_send = message_to_send + kb_context
        except Exception:
            pass

        # 检测用户消息是否可能包含改名意图，如果是则追加提醒让 AI 记得输出标记
        import re
        # 排除"你叫什么"这类问名字的场景
        ask_name_patterns = r'你叫什么|你叫啥|你的名字是|what.s your name|what do (they|you) call you'
        is_asking_name = re.search(ask_name_patterns, user_message, re.IGNORECASE)

        rename_hint_patterns = [
            r'叫你|叫做|就叫|改叫|叫回|改回|换回|交回|改名|取名|起名',
            r'call you|name you|rename|your name will|your name is',
            r'名字.*改|名字.*换|名字.*叫做',
        ]
        if not is_asking_name:
            for p in rename_hint_patterns:
                if re.search(p, user_message, re.IGNORECASE):
                    message_to_send = message_to_send + "\n\n[System: 如果你接受了改名，记得在回复最末尾加上 [RENAME:新名字] 标记]"
                    logger.info(f"[RENAME] Detected possible rename intent, adding hint to message")
                    break

        # 导入对话的上下文注入：首次在导入对话中聊天时，注入最近历史消息
        conv_meta = conversation.get("metadata", {})
        if conv_meta.get("imported_from") and not conv_meta.get("import_session_activated"):
            imported_msgs = conversation.get("messages", [])[-20:]  # 最近20条
            if imported_msgs:
                context_lines = []
                for m in imported_msgs:
                    role_label = "User" if m["role"] == "user" else "Assistant"
                    context_lines.append(f"{role_label}: {m['content'][:500]}")
                context_block = "\n".join(context_lines)
                message_to_send = (
                    f"[以下是我们之前在其他平台的对话记录，请基于这些上下文继续和我对话，"
                    f"保持之前的语气和话题]\n{context_block}\n"
                    f"[对话记录结束，请继续]\n\n{message_to_send}"
                )
                logger.info(f"[IMPORT] Injected {len(imported_msgs)} imported messages as context")
            # 标记已激活，后续消息不再注入
            db.db["conversations"].update_one(
                {"_id": conversation["_id"]},
                {"$set": {"metadata.import_session_activated": True}}
            )

        # 发送消息
        logger.info(f"Sending message: {message_to_send[:80]}...")
        response = api.send_message(
            message_to_send,
            session_id=str(conversation["_id"]),
            attachments=attachments
        )
        logger.info(f"Response received: {response}")

        if not response:
            return jsonify({
                "success": False,
                "error": "No response from AnythingLLM"
            }), 500

        # send_message 返回格式: {'text_response': ..., 'full_response': {...}}
        reply = response.get("text_response", "")
        full_response = response.get("full_response", {})

        # ========== 分离 thinking 内容 ==========
        # 统一处理所有模型的 thinking/reasoning 内容
        # Gemini 通过 OpenAI 兼容 API 返回 thinking 的方式：
        #   content = "<thought>思考内容</thought>实际回复"
        # 但有时 <thought> 标签不闭合，整个 content 都是 thinking
        import re
        thinking_content = ""

        # Pattern 1a: <think>...</think> 或 <thought>...</thought> 标签（有闭合）
        think_tag_match = re.search(r'<(?:think|thought)>(.*?)</(?:think|thought)>', reply, re.DOTALL)
        if think_tag_match:
            thinking_content = think_tag_match.group(1).strip()
            reply = re.sub(r'<(?:think|thought)>.*?</(?:think|thought)>', '', reply, flags=re.DOTALL).strip()
            logger.info(f"[THINKING] Extracted thinking tag content ({len(thinking_content)} chars)")

        # Pattern 1b: <thought> 标签未闭合 — Gemini 有时整个 content 都是 thinking 没有 </thought>
        if not thinking_content:
            unclosed_match = re.match(r'^<(?:think|thought)>(.*)', reply, re.DOTALL)
            if unclosed_match:
                raw = unclosed_match.group(1).strip()
                thinking_content = raw  # 全部先归入 thinking
                reply = ""
                # 尝试从 thinking 中提取真正的对话回复
                # 优先找引号内的对话内容（"xxx" / "xxx" / 「xxx」）
                quoted = re.findall(r'[""「]([^""」]{5,})[""」]', raw)
                if quoted:
                    reply = max(quoted, key=len)
                    logger.info(f"[THINKING] Unclosed <think>: extracted quoted reply ({len(reply)} chars)")
                else:
                    # 没引号，找最后一个不含元语言的段落
                    _meta_kw = ['我应该', '我需要', '可以表达', '可以补充', '可以更', '可以结合',
                                '有点平淡', '人设', '回复', '用户', '第一人称', '不要加']
                    paragraphs = [p.strip() for p in raw.split('\n') if p.strip() and len(p.strip()) > 5]
                    for p in reversed(paragraphs):
                        if not any(kw in p for kw in _meta_kw):
                            reply = p
                            logger.info(f"[THINKING] Unclosed <think>: used last clean paragraph as reply ({len(reply)} chars)")
                            break
                if not reply:
                    logger.info(f"[THINKING] Unclosed <think>: no reply found, will fallback ({len(thinking_content)} chars)")

        # Pattern 2: "THOUGHT" / "think" 前缀（Gemini 思考泄露）
        # 格式: THOUGHT\n英文分析...\nPlan:\n1. ...\n\n中文回复
        # 或: think * User context: ... * Goal: ...\n\n中文回复 (Gemini 3)
        if not thinking_content and re.match(r'^(?:THOUGHT|think)\s', reply, re.IGNORECASE):
            raw = re.sub(r'^(?:THOUGHT|think)\s+', '', reply, flags=re.IGNORECASE).strip()
            actual_reply = ""

            # 方法1：双换行分隔 — 找最后一个双换行，其后内容如果以CJK/括号开头则为回复
            double_nl_parts = raw.split('\n\n')
            if len(double_nl_parts) > 1:
                # 从后往前找，第一个以中文/括号/星号动作开头的段落 = 回复起点
                for i in range(len(double_nl_parts) - 1, 0, -1):
                    candidate = double_nl_parts[i].strip()
                    if candidate and re.match(r'[\u4e00-\u9fff（\uff08*「【《""]', candidate):
                        thinking_content = '\n\n'.join(double_nl_parts[:i]).strip()
                        actual_reply = '\n\n'.join(double_nl_parts[i:]).strip()
                        break

            # 方法2：无双换行 — 找最后一个Plan编号项后的回复边界
            if not actual_reply:
                last_plan_items = list(re.finditer(r'^\d+\.\s', raw, re.MULTILINE))
                if last_plan_items:
                    last_item_pos = last_plan_items[-1].start()
                    last_item_text = raw[last_item_pos:]
                    # 找该编号行的末尾
                    line_end = last_item_text.find('\n')
                    if line_end > 0:
                        # 编号行后有换行，换行后非编号内容 = 回复
                        after = raw[last_item_pos + line_end:].strip()
                        if after and not re.match(r'^\d+\.\s', after):
                            thinking_content = raw[:last_item_pos + line_end].rstrip()
                            actual_reply = after
                    else:
                        # 最后一行，找最后一个英文句号后紧跟的中文（连续5+CJK = 回复，非引号内短词）
                        all_matches = list(re.finditer(r'[.!?]\s*(?=[\u4e00-\u9fff（\uff08])', last_item_text))
                        for m in reversed(all_matches):
                            candidate = last_item_text[m.end():].strip()
                            # 至少10个字符才算真正的回复，排除 "有的" 这种引号内短词
                            if len(candidate) >= 10:
                                cut = last_item_pos + m.end()
                                thinking_content = raw[:cut].rstrip()
                                actual_reply = raw[cut:].strip()
                                break

            # 方法3：无Plan列表 — 找连续CJK段落（长度>=10）作为回复
            if not actual_reply:
                # 找换行后跟着长CJK内容的位置
                for m in re.finditer(r'\n([\u4e00-\u9fff（\uff08*「【《""])', raw):
                    candidate = raw[m.start(1):].strip()
                    if len(candidate) >= 10:
                        thinking_content = raw[:m.start(1)].rstrip()
                        actual_reply = candidate
                        break

            # 方法4：找括号动作 (text) 开头（英文回复场景）
            if not actual_reply:
                action_match = re.search(r'\n(\([a-z])', raw)
                if action_match:
                    thinking_content = raw[:action_match.start()].strip()
                    actual_reply = raw[action_match.start():].strip()

            # 方法5：Gemini 3 "think * bullet * bullet..." 格式（inline bullet thinking）
            # 思考内容都在 "* " 分隔的英文 bullet 中，回复跟在后面
            # 找最后一个 "* *Section:*" 或 "* " bullet 之后的中文内容
            if not actual_reply:
                # 找所有中文段落开头（不在 * bullet 内）
                # 先按 " * " 分隔看看是否有中文段
                cjk_start = re.search(r'(?:^|[\s*])(?=[（\uff08\u4e00-\u9fff"「【])', raw[10:])  # 跳过开头几个字
                if cjk_start:
                    pos = 10 + cjk_start.start()
                    candidate = raw[pos:].lstrip('* ').strip()
                    if len(candidate) >= 10 and re.match(r'[\u4e00-\u9fff（\uff08"「【]', candidate):
                        thinking_content = raw[:pos].rstrip()
                        actual_reply = candidate

            # fallback：整段都是思考，reply 为空（后面有 fallback 逻辑取最后一段）
            if not actual_reply:
                thinking_content = raw
                actual_reply = ""

            reply = actual_reply
            logger.info(f"[THINKING] Stripped THOUGHT prefix ({len(thinking_content)} chars), reply={len(reply)} chars")

        # Pattern 3: Gemini "思考：..." / "Thinking：..." 前缀泄露（无标签时）
        if not thinking_content:
            gemini_think_match = re.match(
                r'^(?:思考|Thinking|思考过程|Let me think|我(?:先)?(?:想想|思考一下|分析一下))[\s：:：]+(.+?)(?:\n\n|\n(?=[^\n]))',
                reply, re.DOTALL
            )
            if gemini_think_match:
                thinking_content = gemini_think_match.group(1).strip()
                reply = reply[gemini_think_match.end():].strip()
                logger.info(f"[THINKING] Stripped Gemini thinking prefix ({len(thinking_content)} chars)")

        # Pattern 4: Gemini 有时返回 JSON 包装 {"response": "..."}
        json_match = re.search(r'```json\s*\{["\']response["\']\s*:\s*["\'](.+?)["\']\s*\}\s*```', reply, re.DOTALL)
        if json_match:
            reply = json_match.group(1).strip()
            logger.info(f"[THINKING] Extracted reply from Gemini JSON wrapper")

        # 如果 reply 为空但有 thinking 内容，用 thinking 最后一部分作为 fallback 回复
        # （Gemini 有时整个 content 都是 thinking 没有单独的回复文本）
        if not reply and thinking_content:
            # 取 thinking 最后一段作为回复
            paragraphs = [p.strip() for p in thinking_content.split('\n\n') if p.strip()]
            if paragraphs:
                reply = paragraphs[-1]
                # 从 thinking 中移除被用作 reply 的部分
                if len(paragraphs) > 1:
                    thinking_content = '\n\n'.join(paragraphs[:-1])
                else:
                    thinking_content = ""
                logger.info(f"[THINKING] Used last paragraph of thinking as reply fallback ({len(reply)} chars)")

        # 检查是否有错误
        if "error" in response or not reply:
            error_msg = response.get("error", full_response.get("error", "Unknown error"))
            if not reply and not error_msg:
                error_msg = "Empty response from AnythingLLM"
            return jsonify({
                "success": False,
                "error": error_msg
            }), 500

        # 检测 AI 回复中的图片生成标记 [IMAGE:...]
        generated_images = []
        try:
            reply, generated_images = process_image_markers(reply, user_id, db)
            if generated_images:
                logger.info(f"[IMAGE_GEN] Generated {len(generated_images)} image(s) for user {user_id}")
        except Exception as e:
            logger.warning(f"[IMAGE_GEN] Error processing image markers: {e}")

        # 检测 AI 回复中的改名标记 [RENAME:xxx]
        import re
        logger.info(f"[RENAME DEBUG] Raw AI reply: {repr(reply)}")
        companion_name_changed = None
        rename_match = re.search(r'\[RENAME:(.{1,20}?)\]', reply)
        if rename_match:
            new_companion_name = rename_match.group(1).strip()
            logger.info(f"[RENAME] Detected rename tag in AI reply: '{new_companion_name}'")
            if new_companion_name:
                companion_name_changed = new_companion_name
                # 从回复中去掉标记
                reply = re.sub(r'\s*\[RENAME:.{1,20}?\]', '', reply).strip()
        else:
            # 备用检测：如果 AI 没有输出 [RENAME] 标记，检查用户消息是否有改名意图
            # 并且 AI 回复看起来是接受了改名
            rename_patterns = [
                # "以后叫你小月吧" "就叫小月吧" "叫你小月好不好" "改叫小月"
                r'(?:以后|从现在起)?(?:叫你|叫做|改名|名字叫|就叫|改叫|你叫)\s*[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
                # "你可以叫小红吗" "能叫小红吗" "可以叫你小红"
                r'(?:你?可以|能不?能|能)\s*叫\s*(?:你\s*)?[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
                # "还是叫回fufu吧" "叫回小蓝吧" "改回小蓝" "换回fufu"
                r'(?:还是|就)?(?:叫回|改回|换回|交回)\s*[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
                # "call you Luna" "name you Luna" "I'll call you Luna"
                r'(?:call you|name you|rename you to|your name (?:is|will be)|I\'ll call you)\s+["\']?(\w[\w\s]{0,14}?)["\']?(?:\s|$|[.!?,])',
                # "你的名字就叫甜甜吧" "你的新名字是小月"
                r'(?:你的?(?:新)?名字(?:就)?(?:是|叫))\s*[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
                # "我要叫你小月" "我想叫你小月" "给你取名小月"
                r'(?:我(?:要|想|来)?叫你|给你(?:取名|起名|改名)(?:叫)?)\s*[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
            ]
            for pattern in rename_patterns:
                user_rename_match = re.search(pattern, user_message, re.IGNORECASE)
                if user_rename_match:
                    potential_name = user_rename_match.group(1).strip()
                    # 验证 AI 回复中是否提到了这个名字（大小写不敏感）
                    if potential_name and potential_name.lower() in reply.lower():
                        logger.info(f"[RENAME] Fallback detection: user asked rename to '{potential_name}', AI reply contains it")
                        companion_name_changed = potential_name
                        break

        if companion_name_changed:
            # 更新数据库 + 重建 system prompt
            try:
                db.db["users"].update_one(
                    {"_id": user_id},
                    {"$set": {"settings.companion_name": companion_name_changed}}
                )
                workspace_manager.update_system_prompt(
                    user_id, user["name"], companion_name=companion_name_changed
                )
                logger.info(f"[RENAME] Companion renamed to '{companion_name_changed}' for user {user_id}")
            except Exception as e:
                logger.warning(f"[RENAME] Error updating companion name: {e}")

        # 从 full_response 中获取 sources
        sources = full_response.get("data", {}).get("sources", [])

        # Auto-generate TTS for AI reply if user sent voice message (Fish Audio)
        reply_audio_b64 = None
        reply_audio_duration = None
        if msg_type == "voice":
            try:
                from voice_service import synthesize_speech, extract_voice_style_from_persona
                import base64 as b64mod
                settings = user.get("settings", {})
                gender = settings.get("companion_gender", "female")
                subtype = settings.get("companion_subtype", "")

                # Priority: user-selected voice_id > auto-detect > default
                voice_id = settings.get("voice_id")

                if not voice_id:
                    custom_persona = settings.get("custom_persona", "")
                    if custom_persona and subtype not in (
                        "female_gentle", "female_cold", "female_cute", "female_cheerful",
                        "male_ceo", "male_warm", "male_classmate", "male_badboy",
                    ):
                        cached_style = settings.get("voice_style", "")
                        if cached_style:
                            subtype = cached_style
                        else:
                            voice_style = extract_voice_style_from_persona(custom_persona, gender)
                            subtype = voice_style
                            try:
                                db.db["users"].update_one(
                                    {"_id": user_id},
                                    {"$set": {"settings.voice_style": voice_style}}
                                )
                                logger.info(f"[VOICE] Cached voice_style='{voice_style}' for user {user_id}")
                            except Exception:
                                pass

                tts_text = reply[:2000] if len(reply) > 2000 else reply
                user_lang = settings.get("language", "en")
                voice_lang = "zh" if user_lang.startswith("zh") else "en"
                tts_audio = synthesize_speech(text=tts_text, voice_id=voice_id, gender=gender, subtype=subtype, language=voice_lang)
                if tts_audio:
                    reply_audio_b64 = b64mod.b64encode(tts_audio).decode("ascii")
                    reply_audio_duration = round(max(1.0, len(tts_text) * 0.15), 1)
                    logger.info(f"[Chat] Auto-TTS (Fish Audio): {len(tts_audio)} bytes, est_duration={reply_audio_duration}s")
            except Exception as tts_err:
                logger.warning(f"[Chat] Auto-TTS for reply failed (non-fatal): {tts_err}")

        # 保存 AI 回复（保存清理后的版本，含 thinking + 图片元数据 + Cloudinary URL）
        image_attachments = [
            {
                "name": f"generated_{i}.png", "mime": "image/png",
                "isImage": True, "isGenerated": True,
                "prompt": img["prompt"],
                **({"url": img["url"]} if img.get("url") else {})
            }
            for i, img in enumerate(generated_images)
        ] if generated_images else None
        db.add_message_to_conversation(
            conversation["_id"],
            user_id,
            "assistant",
            reply,
            sources,
            thinking=thinking_content if thinking_content else None,
            attachments=image_attachments,
            # AI TTS 不存 DB — 实时生成播放，文字随时可重新合成语音
        )

        # 更新统计
        db.update_workspace_stats(user_id, message_count_delta=2)

        result = {
            "success": True,
            "reply": reply,
            "sources": sources,
            "conversation_id": str(conversation["_id"])
        }
        if reply_audio_b64:
            result["reply_audio_b64"] = reply_audio_b64
            result["reply_audio_duration"] = reply_audio_duration
        if thinking_content and show_thinking:
            result["thinking"] = thinking_content
        if companion_name_changed:
            result["companionNameChanged"] = companion_name_changed
        if generated_images:
            result["images"] = [
                {"b64": img["b64"], "prompt": img["prompt"], **({"url": img["url"]} if img.get("url") else {})}
                for img in generated_images
            ]

        # 异步提取记忆（不阻塞响应）
        import threading
        def _async_memory_extraction(uid, umsg, areply):
            try:
                if os.environ.get("MEM0_ENABLED", "false").lower() == "true":
                    from mem0_engine import process_memory, cleanup_expired_memories
                    process_memory(uid, umsg, areply)
                    import random
                    if random.random() < 0.05:
                        cleanup_expired_memories(str(uid))
                else:
                    from memory_engine import process_memory
                    process_memory(uid, umsg, areply)
            except Exception as e:
                logger.warning(f"[MEMORY] Async extraction error: {e}")
        threading.Thread(
            target=_async_memory_extraction,
            args=(user_id, user_message, reply),
            daemon=True
        ).start()

        # 异步生成对话标题（仅第一条消息时触发）
        if is_first_message:
            def _async_generate_title(conv_id, uid, umsg, areply):
                try:
                    from memory_engine import _call_gemini
                    prompt = (
                        "Generate a very short conversation title (max 6 words) based on this chat. "
                        "If the message is in Chinese, return Chinese title. If in English, return English title. "
                        "Return ONLY the title text, nothing else. No quotes, no punctuation at the end.\n\n"
                        f"User: {umsg[:200]}\nAssistant: {areply[:200]}"
                    )
                    title = _call_gemini(prompt)
                    if title and len(title) < 50:
                        # 清理标题（去掉引号、多余空白等）
                        title = title.strip().strip('"\'').strip()
                        if title:
                            from datetime import datetime as dt
                            db.db["conversations"].update_one(
                                {"_id": conv_id, "user_id": uid},
                                {"$set": {"title": title, "updated_at": dt.utcnow()}}
                            )
                            logger.info(f"[TITLE] Auto-generated title: {title}")
                except Exception as e:
                    logger.warning(f"[TITLE] Async title generation error: {e}")
            threading.Thread(
                target=_async_generate_title,
                args=(conversation["_id"], user_id, user_message, reply),
                daemon=True
            ).start()

        return jsonify(result)

    except Exception as e:
        logger.error(f"Chat error: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ==================== Streaming Text Chat (SSE) ====================

@app.route("/api/chat/stream", methods=["POST"])
@login_required
def chat_stream():
    """
    Streaming text chat — SSE endpoint for real-time token delivery.
    Same logic as /api/chat but streams tokens via SSE for instant display.
    Events: text (token), thinking (content), done (full reply + metadata), error.
    """
    try:
        user_id = get_current_user_id()
        user = get_current_user()
        data = request.get_json()

        if not data or "message" not in data:
            return jsonify({"error": "Missing message parameter"}), 400

        user_message = data["message"]
        conversation_id = data.get("conversation_id")
        show_thinking = data.get("show_thinking", False)
        attachments = data.get("attachments")
        msg_type = data.get("type", "text")
        user_audio_url = data.get("audio_url")
        user_audio_duration = data.get("audio_duration")

        # Pre-load workspace
        workspace_result = workspace_manager.get_or_create_workspace(user_id)
        if not workspace_result["success"]:
            return jsonify({"error": "Failed to get workspace"}), 500
        workspace = workspace_result["workspace"]
        workspace_slug = workspace["slug"]

        # Sync model + prompt (with Mem0 semantic memory if enabled)
        try:
            user_model = user.get("settings", {}).get("model", "gemini")
            if user_model in workspace_manager.SUPPORTED_MODELS:
                model_config = workspace_manager.SUPPORTED_MODELS[user_model]
                model_temp = 1.0 if user_model == "grok" else 0.9 if user_model == "gpt4o" else 0.7
                import requests as req
                sync_payload = {
                    "chatProvider": model_config["chatProvider"],
                    "chatModel": model_config["chatModel"],
                    "openAiTemp": model_temp,
                }
                # Mem0: 语义搜索记忆 → 实时注入 prompt
                if os.environ.get("MEM0_ENABLED", "false").lower() == "true":
                    try:
                        from mem0_engine import search_relevant_memories, get_permanent_memories, build_memory_text as mem0_build_text
                        uid_str = str(user_id)
                        permanent = get_permanent_memories(uid_str)
                        relevant = search_relevant_memories(uid_str, user_message)
                        memory_text = mem0_build_text(permanent, relevant)
                        fresh_prompt = workspace_manager.build_prompt_for_user(user_id, memory_text=memory_text)
                        sync_payload["openAiPrompt"] = fresh_prompt
                    except Exception as e:
                        logger.warning(f"[MEM0] Pre-chat search failed, prompt unchanged: {e}")
                req.post(
                    f"{workspace_manager.anythingllm_base_url}/api/v1/workspace/{workspace_slug}/update",
                    headers={
                        "Authorization": f"Bearer {workspace_manager.anythingllm_api_key}",
                        "Content-Type": "application/json"
                    },
                    json=sync_payload,
                    timeout=5
                )
        except Exception:
            pass

        # Get or create conversation
        conversation = None
        if conversation_id:
            try:
                conversation = db.get_conversation(ObjectId(conversation_id), user_id)
            except Exception:
                pass
        if not conversation:
            conversation = db.get_active_conversation(user_id)

        is_first_message = conversation.get("metadata", {}).get("total_messages", 0) == 0

        # Save user message（图片附件上传 Cloudinary 持久化）
        attachment_meta = None
        if attachments:
            attachment_meta = []
            for a in attachments:
                meta = {"name": a.get("name", "file"), "mime": a.get("mime", ""),
                        "isImage": a.get("mime", "").startswith("image/")}
                if meta["isImage"] and a.get("contentString"):
                    try:
                        from image_gen import upload_to_cloudinary
                        b64 = a["contentString"].split(",", 1)[-1] if "," in a["contentString"] else a["contentString"]
                        url = upload_to_cloudinary(b64, str(user_id))
                        if url:
                            meta["url"] = url
                    except Exception as e:
                        logger.warning(f"[CHAT-STREAM] User image upload failed: {e}")
                attachment_meta.append(meta)
        db.add_message_to_conversation(
            conversation["_id"], user_id, "user", user_message,
            attachments=attachment_meta,
            msg_type=msg_type if msg_type != "text" else None,
            audio_url=user_audio_url,
            audio_duration=float(user_audio_duration) if user_audio_duration else None
        )

        # Web search enhancement
        message_to_send = user_message
        try:
            from web_search import enhance_message_with_search
            enhanced, did_search = enhance_message_with_search(user_message)
            if did_search:
                message_to_send = enhanced
        except Exception:
            pass

        # KB enhancement: query shared psychology knowledge base
        try:
            kb_on = user.get("settings", {}).get("kb_enabled", False)
            if kb_on:
                kb_context = query_shared_kb(user_message)
                if kb_context:
                    message_to_send = message_to_send + kb_context
        except Exception:
            pass

        # Rename hint injection
        import re
        ask_name_patterns = r'你叫什么|你叫啥|你的名字是|what.s your name|what do (they|you) call you'
        is_asking_name = re.search(ask_name_patterns, user_message, re.IGNORECASE)
        rename_hint_patterns = [
            r'叫你|叫做|就叫|改叫|叫回|改回|换回|交回|改名|取名|起名',
            r'call you|name you|rename|your name will|your name is',
            r'名字.*改|名字.*换|名字.*叫做',
        ]
        if not is_asking_name:
            for p in rename_hint_patterns:
                if re.search(p, user_message, re.IGNORECASE):
                    message_to_send = message_to_send + "\n\n[System: 如果你接受了改名，记得在回复最末尾加上 [RENAME:新名字] 标记]"
                    break

        # Import context injection
        conv_meta = conversation.get("metadata", {})
        if conv_meta.get("imported_from") and not conv_meta.get("import_session_activated"):
            imported_msgs = conversation.get("messages", [])[-20:]
            if imported_msgs:
                context_lines = []
                for m in imported_msgs:
                    role_label = "User" if m["role"] == "user" else "Assistant"
                    context_lines.append(f"{role_label}: {m['content'][:500]}")
                context_block = "\n".join(context_lines)
                message_to_send = (
                    f"[以下是我们之前在其他平台的对话记录，请基于这些上下文继续和我对话，"
                    f"保持之前的语气和话题]\n{context_block}\n"
                    f"[对话记录结束，请继续]\n\n{message_to_send}"
                )
            db.db["conversations"].update_one(
                {"_id": conversation["_id"]},
                {"$set": {"metadata.import_session_activated": True}}
            )

        # Pre-load all variables needed inside generator
        conv_id = conversation["_id"]
        conv_id_str = str(conv_id)
        anythingllm_base = workspace_manager.anythingllm_base_url
        anythingllm_key = workspace_manager.anythingllm_api_key

    except Exception as e:
        logger.error(f"Chat stream setup error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

    def _sse_event(event: str, data_dict: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data_dict, ensure_ascii=False)}\n\n"

    def generate():
        import re as _re
        import threading
        import queue

        # Flush proxy buffers (Cloudflare, nginx) with SSE comment padding
        yield ": " + " " * 2048 + "\n\n"

        api = AnythingLLMAPI(
            base_url=anythingllm_base,
            api_key=anythingllm_key,
            workspace_slug=workspace_slug
        )

        full_reply = ""
        in_thinking = False
        thinking_content = ""
        initial_buffer = ""
        initial_phase = True  # Buffer initial tokens to detect <think> tags
        _tag_detect_buf = ""  # Rolling buffer for mid-stream <think> detection

        # Stream LLM in background thread, send keepalive while waiting
        chunk_queue = queue.Queue()

        def _stream_worker():
            try:
                for c in api.send_message_stream(
                    message_to_send,
                    session_id=conv_id_str,
                    attachments=attachments
                ):
                    chunk_queue.put(("chunk", c))
                chunk_queue.put(("done", None))
            except Exception as exc:
                chunk_queue.put(("error", exc))

        worker = threading.Thread(target=_stream_worker, daemon=True)
        worker.start()

        try:
          while True:
            try:
                msg_type, payload = chunk_queue.get(timeout=3)
            except queue.Empty:
                # No data in 3s — send keepalive to prevent connection drop
                yield ": keepalive\n\n"
                continue

            if msg_type == "done":
                break
            elif msg_type == "error":
                if not full_reply:
                    yield _sse_event("error", {"message": f"LLM error: {str(payload)}"})
                break

            chunk = payload
            if chunk.get("error"):
                err_msg = chunk["error"] if isinstance(chunk["error"], str) else "LLM error"
                yield _sse_event("error", {"message": err_msg})
                return

            token = chunk.get("textResponse", "")
            if not token:
                continue

            full_reply += token

            # --- Initial phase: buffer to detect <think> tags ---
            if initial_phase:
                initial_buffer += token
                lower_buf = initial_buffer.lower()
                stripped_lower = lower_buf.lstrip()
                if "<think>" in lower_buf or "<thought>" in lower_buf:
                    in_thinking = True
                    initial_phase = False
                    for tag in ["<think>", "<thought>"]:
                        idx = lower_buf.find(tag)
                        if idx >= 0:
                            before_tag = initial_buffer[:idx].strip()
                            if before_tag:
                                for ch in before_tag:
                                    yield _sse_event("text", {"token": ch})
                            after_tag = initial_buffer[idx + len(tag):]
                            if after_tag:
                                thinking_content += after_tag
                            break
                    continue
                # Gemini-style thinking (e.g. "思考：...", "Thinking: ...")
                _gemini_think = _re.match(
                    r'^\s*(?:思考|Thinking|思考过程|Let me think|我(?:先)?(?:想想|思考一下|分析一下))[\s：:]+',
                    initial_buffer, _re.IGNORECASE
                )
                if _gemini_think:
                    in_thinking = True
                    initial_phase = False
                    thinking_content = initial_buffer[_gemini_think.end():]
                    continue
                # Bare "think " / "THOUGHT " prefix (e.g. "think The user wants...")
                _think_prefix = _re.match(
                    r'^\s*(?:THOUGHT|think)\s+',
                    initial_buffer, _re.IGNORECASE
                )
                if _think_prefix and len(initial_buffer) > 15:
                    in_thinking = True
                    initial_phase = False
                    thinking_content = initial_buffer[_think_prefix.end():]
                    continue
                # Flush as text when confident it's not thinking
                should_flush = False
                if len(initial_buffer) > 60:
                    should_flush = True
                elif len(initial_buffer) > 5:
                    if not stripped_lower.startswith('<') and not _re.match(
                        r'(?:思考|think|let\s)', stripped_lower, _re.IGNORECASE
                    ):
                        should_flush = True
                if should_flush:
                    initial_phase = False
                    for ch in initial_buffer:
                        yield _sse_event("text", {"token": ch})
                continue

            # --- Thinking mode ---
            if in_thinking:
                combined = thinking_content + token
                lower_combined = combined.lower()
                for close_tag in ["</think>", "</thought>"]:
                    close_idx = lower_combined.find(close_tag)
                    if close_idx >= 0:
                        thinking_content = combined[:close_idx].strip()
                        in_thinking = False
                        if thinking_content and show_thinking:
                            yield _sse_event("thinking", {"content": thinking_content})
                        after_close = combined[close_idx + len(close_tag):]
                        if after_close.strip():
                            yield _sse_event("text", {"token": after_close})
                        break
                else:
                    thinking_content += token
                continue

            # --- Normal streaming ---
            # Mid-stream <think> detection (tag split across tokens)
            _tag_detect_buf += token
            if len(_tag_detect_buf) > 20:
                _tag_detect_buf = _tag_detect_buf[-20:]
            _lower_tdb = _tag_detect_buf.lower()
            _found_mid_tag = False
            for _mtag in ["<think>", "<thought>"]:
                if _mtag in _lower_tdb:
                    in_thinking = True
                    _tidx = _lower_tdb.find(_mtag)
                    _after = _tag_detect_buf[_tidx + len(_mtag):]
                    if _after:
                        thinking_content = _after
                    _tag_detect_buf = ""
                    _found_mid_tag = True
                    break
            # Also detect Grok reasoning pattern: "\nAssistant:" mid-stream
            if not _found_mid_tag:
                for _grok_marker in ["\nassistant:", "\nassistant\uff1a"]:
                    if _grok_marker in _lower_tdb:
                        in_thinking = True
                        _tidx = _lower_tdb.find(_grok_marker)
                        _after = _tag_detect_buf[_tidx + len(_grok_marker):]
                        if _after:
                            thinking_content = _after
                        _tag_detect_buf = ""
                        _found_mid_tag = True
                        break
            if _found_mid_tag:
                continue
            yield _sse_event("text", {"token": token})

        except Exception as e:
            logger.error(f"[CHAT-STREAM] LLM error: {e}")
            if not full_reply:
                yield _sse_event("error", {"message": f"LLM error: {str(e)}"})
                return

        # --- Post-processing: clean full reply ---
        reply = full_reply

        # Strip thinking tags from full reply (in case our streaming logic missed some)
        think_match = _re.search(r'<(?:think|thought)>(.*?)</(?:think|thought)>', reply, _re.DOTALL)
        if think_match:
            if not thinking_content:
                thinking_content = think_match.group(1).strip()
            reply = _re.sub(r'<(?:think|thought)>.*?</(?:think|thought)>', '', reply, flags=_re.DOTALL).strip()

        # Handle THOUGHT/think prefix (no tags)
        if not thinking_content and _re.match(r'^(?:THOUGHT|think)\s', reply, _re.IGNORECASE):
            raw = _re.sub(r'^(?:THOUGHT|think)\s+', '', reply, flags=_re.IGNORECASE).strip()
            _found_delim = False
            for m in _re.finditer(r'\n([\u4e00-\u9fff（\uff08*「【《""])', raw):
                candidate = raw[m.start(1):].strip()
                if len(candidate) >= 10:
                    thinking_content = raw[:m.start(1)].rstrip()
                    reply = candidate
                    _found_delim = True
                    break
            if not _found_delim:
                # No Chinese delimiter — entire content after "think" is thinking
                thinking_content = raw
                reply = ""

        # Handle Gemini "思考：..." prefix
        if not thinking_content:
            gemini_think_match = _re.match(
                r'^(?:思考|Thinking|思考过程|Let me think|我(?:先)?(?:想想|思考一下|分析一下))[\s：:：]+(.+?)(?:\n\n|\n(?=[^\n]))',
                reply, _re.DOTALL
            )
            if gemini_think_match:
                thinking_content = gemini_think_match.group(1).strip()
                reply = reply[gemini_think_match.end():].strip()

        # Handle Grok reasoning leak: "Assistant:" meta-reasoning or Chinese analysis headers
        # Grok sometimes appends internal reasoning as plain text after the roleplay response
        # Always check regardless of existing thinking_content — Grok may leak even after <think> tags
        grok_match = _re.search(r'\n\s*Assistant\s*[:：]', reply)
        if not grok_match:
            # Pattern 2: Standalone Chinese analysis headers at line start
            grok_match = _re.search(
                r'\n\s*(?:角色保持|亲密规则|情节推进|回复内容|场景设定|注意事项|互动建议|下一步)\s*[:：]',
                reply
            )
        if grok_match:
            candidate_reply = reply[:grok_match.start()].strip()
            candidate_think = reply[grok_match.start():].strip()
            if candidate_reply and len(candidate_reply) >= 10:
                if thinking_content:
                    thinking_content += "\n\n" + candidate_think
                else:
                    thinking_content = candidate_think
                reply = candidate_reply
                logger.info(f"[CHAT-STREAM] Stripped Grok reasoning ({len(candidate_think)} chars)")

        # Strip IMAGE tags from thinking content (prevent [IMAGE:] leak in thinking display)
        if thinking_content:
            thinking_content = _re.sub(r'\[IMAGE:\s*.+?\]', '', thinking_content, flags=_re.DOTALL).strip()

        # Fallback: if reply empty but thinking has content
        if not reply and thinking_content:
            paragraphs = [p.strip() for p in thinking_content.split('\n\n') if p.strip()]
            if paragraphs:
                reply = paragraphs[-1]
                if len(paragraphs) > 1:
                    thinking_content = '\n\n'.join(paragraphs[:-1])
                else:
                    thinking_content = ""

        # Process image markers (threaded + keepalive to prevent SSE timeout)
        generated_images = []
        from image_gen import extract_image_markers, check_daily_limit
        reply, _img_prompts = extract_image_markers(reply)
        if _img_prompts:
            if not check_daily_limit(user_id, db):
                logger.info(f"[CHAT-STREAM] Image daily limit reached for user {user_id}, notifying frontend")
                yield _sse_event("image_limit", {"message": "今日图片额度已用完啦～明天再来吧！"})
                _img_prompts = []  # skip image generation
            else:
                yield _sse_event("image_generating", {"count": len(_img_prompts), "prompt": _img_prompts[0][:80]})
            # 重建带所有 [IMAGE:] 标记的文本，交给 process_image_markers 处理
            _fake_reply = " ".join(f"[IMAGE: {p}]" for p in _img_prompts)
            _img_result = [None]
            def _img_worker():
                try:
                    _, _img_result[0] = process_image_markers(
                        _fake_reply, user_id, db
                    )
                except Exception as e:
                    logger.warning(f"[CHAT-STREAM] Image gen error: {e}")
                    _img_result[0] = []
            _img_thread = threading.Thread(target=_img_worker, daemon=True)
            _img_thread.start()
            while _img_thread.is_alive():
                _img_thread.join(timeout=3)
                if _img_thread.is_alive():
                    yield ": keepalive\n\n"
            generated_images = _img_result[0] or []

        # Rename detection
        companion_name_changed = None
        rename_match = _re.search(r'\[RENAME:(.{1,20}?)\]', reply)
        if rename_match:
            new_name = rename_match.group(1).strip()
            if new_name:
                companion_name_changed = new_name
                reply = _re.sub(r'\s*\[RENAME:.{1,20}?\]', '', reply).strip()
        else:
            rename_patterns = [
                r'(?:以后|从现在起)?(?:叫你|叫做|改名|名字叫|就叫|改叫|你叫)\s*[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
                r'(?:你?可以|能不?能|能)\s*叫\s*(?:你\s*)?[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
                r'(?:还是|就)?(?:叫回|改回|换回|交回)\s*[「「"\'【]?(.{1,15}?)[」」"\'】]?(?:\s*[吧了啊呢好哦嘛吗]|$)',
                r'(?:call you|name you|rename you to|your name (?:is|will be)|I\'ll call you)\s+["\']?(\w[\w\s]{0,14}?)["\']?(?:\s|$|[.!?,])',
            ]
            for pattern in rename_patterns:
                user_rename_match = _re.search(pattern, user_message, _re.IGNORECASE)
                if user_rename_match:
                    potential_name = user_rename_match.group(1).strip()
                    if potential_name and potential_name.lower() in reply.lower():
                        companion_name_changed = potential_name
                        break

        if companion_name_changed:
            try:
                db.db["users"].update_one(
                    {"_id": user_id},
                    {"$set": {"settings.companion_name": companion_name_changed}}
                )
                workspace_manager.update_system_prompt(
                    user_id, user["name"], companion_name=companion_name_changed
                )
            except Exception:
                pass

        # Save AI reply to DB
        image_attachments = [
            {"name": f"generated_{i}.png", "mime": "image/png",
             "isImage": True, "isGenerated": True, "prompt": img["prompt"],
             **({"url": img["url"]} if img.get("url") else {})}
            for i, img in enumerate(generated_images)
        ] if generated_images else None
        try:
            db.add_message_to_conversation(
                conv_id, user_id, "assistant", reply,
                thinking=thinking_content if thinking_content else None,
                attachments=image_attachments,
            )
            db.update_workspace_stats(user_id, message_count_delta=2)
        except Exception as e:
            logger.warning(f"[CHAT-STREAM] DB save error: {e}")

        # Emit done event
        done_data = {
            "reply": reply,
            "conversation_id": conv_id_str,
        }
        if thinking_content and show_thinking:
            done_data["thinking"] = thinking_content
        if companion_name_changed:
            done_data["companionNameChanged"] = companion_name_changed
        if generated_images:
            done_data["images"] = [
                {"b64": img.get("b64", ""), "prompt": img["prompt"],
                 **({"url": img["url"]} if img.get("url") else {})}
                for img in generated_images
            ]
        yield _sse_event("done", done_data)

        # Async tasks: memory + title
        def _async_tasks():
            try:
                if os.environ.get("MEM0_ENABLED", "false").lower() == "true":
                    from mem0_engine import process_memory, cleanup_expired_memories
                    process_memory(user_id, user_message, reply)
                    import random
                    if random.random() < 0.05:
                        cleanup_expired_memories(str(user_id))
                else:
                    from memory_engine import process_memory
                    process_memory(user_id, user_message, reply)
            except Exception as e:
                logger.warning(f"[CHAT-STREAM] Memory error: {e}")
        threading.Thread(target=_async_tasks, daemon=True).start()

        if is_first_message:
            def _async_title():
                try:
                    from memory_engine import _call_gemini
                    prompt = (
                        "Generate a very short conversation title (max 6 words) based on this chat. "
                        "If the message is in Chinese, return Chinese title. If in English, return English title. "
                        "Return ONLY the title text, nothing else. No quotes, no punctuation at the end.\n\n"
                        f"User: {user_message[:200]}\nAssistant: {reply[:200]}"
                    )
                    title = _call_gemini(prompt)
                    if title and len(title) < 50:
                        title = title.strip().strip('"\'').strip()
                        if title:
                            from datetime import datetime as dt
                            db.db["conversations"].update_one(
                                {"_id": conv_id, "user_id": user_id},
                                {"$set": {"title": title, "updated_at": dt.utcnow()}}
                            )
                except Exception:
                    pass
            threading.Thread(target=_async_title, daemon=True).start()

    resp = Response(generate(), content_type="text/event-stream; charset=utf-8")
    resp.headers['Cache-Control'] = 'no-cache, no-transform'
    resp.headers['X-Accel-Buffering'] = 'no'
    resp.headers['Connection'] = 'keep-alive'
    return resp


# ==================== Streaming Voice Chat (SSE) ====================

@app.route("/api/voice/chat-stream", methods=["POST"])
@login_required
def voice_chat_stream():
    """
    Streaming voice chat: ASR → LLM → sentence-level TTS → SSE audio chunks.
    Accepts multipart/form-data with 'audio' file (same as voice_upload).
    Returns text/event-stream with events: transcript, reply, audio, done.
    """
    import base64 as b64mod

    # ---------- Parse audio (same as voice_upload) ----------
    user_id = get_current_user_id()
    user = get_current_user()

    if "audio" not in request.files:
        return jsonify({"error": "No audio file"}), 400

    audio_file = request.files["audio"]
    audio_data = audio_file.read()
    if not audio_data or len(audio_data) < 100:
        return jsonify({"error": "Audio too small"}), 400

    audio_format = request.form.get("format", "").lower() or _detect_audio_format(audio_file.filename)
    sample_rate = int(request.form.get("sample_rate", 16000))
    conversation_id = request.form.get("conversation_id", "")

    # Pre-load everything we need before entering the generator
    # (request context is only available here, not inside the generator)
    settings = user.get("settings", {})
    gender = settings.get("companion_gender", "female")
    subtype = settings.get("companion_subtype", "")
    voice_id = settings.get("voice_id", "")
    user_lang = settings.get("language", "en")
    voice_lang = "zh" if user_lang.startswith("zh") else "en"

    # Voice style auto-detection for custom persona
    if not voice_id:
        from voice_service import extract_voice_style_from_persona
        custom_persona = settings.get("custom_persona", "")
        if custom_persona and subtype not in (
            "female_gentle", "female_cold", "female_cute", "female_cheerful",
            "male_ceo", "male_warm", "male_classmate", "male_badboy",
        ):
            cached_style = settings.get("voice_style", "")
            subtype = cached_style if cached_style else extract_voice_style_from_persona(custom_persona, gender)

    def _sse_event(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    def generate():
        from voice_service import recognize_speech, synthesize_speech_segments
        import re as _re
        import threading

        conv_id_str = conversation_id

        # ---------- 1. ASR ----------
        try:
            transcript = recognize_speech(
                audio_data=audio_data,
                audio_format=audio_format,
                sample_rate=sample_rate,
            )
        except Exception as e:
            logger.error(f"[STREAM] ASR error: {e}")
            transcript = ""

        if not transcript:
            yield _sse_event("error", {"message": "Could not recognize speech"})
            return

        yield _sse_event("transcript", {"text": transcript})

        # ---------- 2. Get/create conversation & save user message ----------
        try:
            if conv_id_str:
                conv_oid = ObjectId(conv_id_str)
                conversation = db.get_conversation(conv_oid, user_id)
                if not conversation:
                    conversation = db.create_conversation(user_id)
            else:
                conversation = db.get_active_conversation(user_id)

            # ⚡ PERF: Upload audio in background thread to avoid blocking pipeline (~0.5s saved)
            import threading as _thr
            _conv_id_for_bg = conversation["_id"]
            _uid_for_bg = user_id
            _transcript_for_bg = transcript
            _audio_data_bg = audio_data
            _audio_fmt_bg = audio_format or "webm"
            def _bg_save_user_audio():
                try:
                    audio_url = _save_audio_file(_audio_data_bg, prefix="user", ext=_audio_fmt_bg)
                    db.add_message_to_conversation(
                        _conv_id_for_bg, _uid_for_bg, "user", _transcript_for_bg,
                        msg_type="voice", audio_url=audio_url,
                    )
                except Exception as e:
                    logger.warning(f"[STREAM] Background audio save failed: {e}")
            _thr.Thread(target=_bg_save_user_audio, daemon=True).start()

            is_first_message = conversation.get("metadata", {}).get("total_messages", 0) == 0
        except Exception as e:
            logger.error(f"[STREAM] DB error: {e}")
            yield _sse_event("error", {"message": "Database error"})
            return

        # ---------- 3. Setup workspace & API ----------
        try:
            workspace_result = workspace_manager.get_or_create_workspace(user_id)
            if not workspace_result["success"]:
                yield _sse_event("error", {"message": "Workspace error"})
                return

            workspace_slug = workspace_result["workspace"]["slug"]

            # ⚡ PERF: Skip model sync during voice calls — model doesn't change mid-call (~0.5s saved)
            # Model sync is already done when user opens settings/starts chat.

            api = AnythingLLMAPI(
                base_url=workspace_manager.anythingllm_base_url,
                api_key=workspace_manager.anythingllm_api_key,
                workspace_slug=workspace_slug
            )

            # ⚡ PERF: Skip web search during voice calls — latency matters more than search quality
            message_to_send = transcript
        except Exception as e:
            logger.error(f"[STREAM] Setup error: {e}")
            yield _sse_event("error", {"message": f"Setup error: {str(e)}"})
            return

        # ---------- 4. Streaming LLM + parallel TTS ----------
        # Stream tokens from LLM, detect clause/sentence boundaries, TTS each
        # segment in a background thread so LLM streaming is never blocked.
        from voice_service import synthesize_single_sentence, \
            _clean_text_for_tts, get_voice_ref_id
        from concurrent.futures import ThreadPoolExecutor, Future
        import queue as _queue
        ref_id = voice_id or get_voice_ref_id(gender, subtype, voice_lang)

        # Clause-level split: commas + sentence-ending punctuation
        _CLAUSE_SPLIT_RE = _re.compile(
            r'(?<=[。！？…\.!\?\n，,；;—])'
            r'(?=\S)'
        )

        def _split_clauses(text, min_len=6):
            """Split text on commas and sentence-ending punctuation."""
            if not text:
                return []
            raw = _CLAUSE_SPLIT_RE.split(text.strip())
            out, buf = [], ""
            for part in raw:
                part = part.strip()
                if not part:
                    continue
                buf += part
                if len(buf) >= min_len:
                    out.append(buf)
                    buf = ""
            if buf:
                if out:
                    out[-1] += buf
                else:
                    out.append(buf)
            return out

        # NOTE: Do NOT add voice-mode prefix here — it gets saved into
        # AnythingLLM chat history and pollutes subsequent text chats,
        # causing all replies to be unnaturally short.
        message_with_prefix = message_to_send

        full_reply = ""
        sentence_buffer = ""
        audio_idx = 0
        in_thinking = False
        thinking_content = ""

        # TTS runs in background thread, results collected in order
        tts_executor = ThreadPoolExecutor(max_workers=2)
        pending_tts = []  # list of (idx, sentence_text, Future)

        def _do_tts(sentence_text):
            cleaned = _clean_text_for_tts(sentence_text)
            if cleaned and len(cleaned) >= 2:
                return synthesize_single_sentence(cleaned, ref_id)
            return b""

        try:
            for chunk in api.send_message_stream(
                message_with_prefix,
                session_id=str(conversation["_id"]),
            ):
                if chunk.get("error"):
                    err_msg = chunk["error"] if isinstance(chunk["error"], str) else "LLM error"
                    yield _sse_event("error", {"message": err_msg})
                    return

                token = chunk.get("textResponse", "")
                if not token:
                    # While waiting for tokens, yield any ready TTS audio (in order)
                    while pending_tts and pending_tts[0][2].done():
                        idx, sent, fut = pending_tts.pop(0)
                        audio_bytes = fut.result()
                        if audio_bytes:
                            audio_b64 = b64mod.b64encode(audio_bytes).decode("ascii")
                            yield _sse_event("audio", {
                                "index": idx, "text": sent, "audio_b64": audio_b64,
                            })
                    continue

                full_reply += token

                # Track <think> tags — don't TTS thinking content
                if "<think>" in token.lower() or "<thought>" in token.lower():
                    in_thinking = True
                if "</think>" in token.lower() or "</thought>" in token.lower():
                    in_thinking = False
                    continue
                if in_thinking:
                    continue

                sentence_buffer += token

                # Check for clause/sentence boundaries
                clauses = _split_clauses(sentence_buffer)
                if len(clauses) > 1:
                    complete = clauses[:-1]
                    sentence_buffer = clauses[-1]

                    for sent in complete:
                        fut = tts_executor.submit(_do_tts, sent)
                        pending_tts.append((audio_idx, sent, fut))
                        audio_idx += 1

                # Yield any ready TTS audio (in order)
                while pending_tts and pending_tts[0][2].done():
                    idx, sent, fut = pending_tts.pop(0)
                    audio_bytes = fut.result()
                    if audio_bytes:
                        audio_b64 = b64mod.b64encode(audio_bytes).decode("ascii")
                        yield _sse_event("audio", {
                            "index": idx, "text": sent, "audio_b64": audio_b64,
                        })

            # LLM stream done — process remaining buffer
            if sentence_buffer.strip():
                fut = tts_executor.submit(_do_tts, sentence_buffer.strip())
                pending_tts.append((audio_idx, sentence_buffer.strip(), fut))
                audio_idx += 1

            # Wait for all remaining TTS to complete, yield in order
            for idx, sent, fut in pending_tts:
                audio_bytes = fut.result(timeout=30)
                if audio_bytes:
                    audio_b64 = b64mod.b64encode(audio_bytes).decode("ascii")
                    yield _sse_event("audio", {
                        "index": idx, "text": sent, "audio_b64": audio_b64,
                    })
            pending_tts.clear()

        except Exception as e:
            logger.error(f"[STREAM] LLM+TTS error: {e}")
            if not full_reply:
                yield _sse_event("error", {"message": f"LLM error: {str(e)}"})
                return
        finally:
            tts_executor.shutdown(wait=False)

        # ---------- 5. Process full reply & emit reply event ----------
        reply = full_reply
        # Strip thinking tags from full reply
        think_match = _re.search(r'<(?:think|thought)>(.*?)</(?:think|thought)>', reply, _re.DOTALL)
        if think_match:
            thinking_content = think_match.group(1).strip()
            reply = _re.sub(r'<(?:think|thought)>.*?</(?:think|thought)>', '', reply, flags=_re.DOTALL).strip()

        # Handle THOUGHT prefix
        if not thinking_content and _re.match(r'^(?:THOUGHT|think)\s', reply, _re.IGNORECASE):
            raw = _re.sub(r'^(?:THOUGHT|think)\s+', '', reply, flags=_re.IGNORECASE).strip()
            for m in _re.finditer(r'\n([\u4e00-\u9fff（\uff08*「【《""])', raw):
                candidate = raw[m.start(1):].strip()
                if len(candidate) >= 10:
                    thinking_content = raw[:m.start(1)].rstrip()
                    reply = candidate
                    break

        yield _sse_event("reply", {
            "text": reply,
            "thinking": thinking_content,
            "conversation_id": str(conversation["_id"]),
        })

        # ---------- 6. Save to DB + async tasks ----------
        try:
            db.add_message_to_conversation(
                conversation["_id"], user_id, "assistant", reply,
                thinking=thinking_content if thinking_content else None,
            )
            db.update_workspace_stats(user_id, message_count_delta=2)
        except Exception as e:
            logger.warning(f"[STREAM] DB save error: {e}")

        try:
            def _async_tasks():
                try:
                    if os.environ.get("MEM0_ENABLED", "false").lower() == "true":
                        from mem0_engine import process_memory, cleanup_expired_memories
                        process_memory(user_id, transcript, reply)
                        import random
                        if random.random() < 0.05:
                            cleanup_expired_memories(str(user_id))
                    else:
                        from memory_engine import process_memory
                        process_memory(user_id, transcript, reply)
                except Exception:
                    pass
                if is_first_message:
                    try:
                        from memory_engine import _call_gemini
                        prompt = (
                            "Generate a very short conversation title (max 6 words). "
                            "Chinese message → Chinese title. English → English title. "
                            "Return ONLY the title.\n\n"
                            f"User: {transcript[:200]}\nAssistant: {reply[:200]}"
                        )
                        title = _call_gemini(prompt)
                        if title and len(title) < 50:
                            title = title.strip().strip('"\'').strip()
                            if title:
                                from datetime import datetime as dt
                                db.db["conversations"].update_one(
                                    {"_id": conversation["_id"], "user_id": user_id},
                                    {"$set": {"title": title, "updated_at": dt.utcnow()}}
                                )
                    except Exception:
                        pass
            threading.Thread(target=_async_tasks, daemon=True).start()
        except Exception:
            pass

        yield _sse_event("done", {})

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


# ==================== 对话历史接口 ====================

@app.route("/api/conversations", methods=["GET"])
@login_required
def list_conversations():
    """获取用户的对话列表"""
    user_id = get_current_user_id()
    limit = request.args.get("limit", 500, type=int)
    skip = request.args.get("skip", 0, type=int)

    conversations = db.get_user_conversations(user_id, limit, skip)

    return jsonify({
        "conversations": [
            {
                "id": str(conv["_id"]),
                "title": conv.get("title", "新对话"),
                "updated_at": conv.get("updated_at").isoformat() if conv.get("updated_at") else None,
                "message_count": conv.get("metadata", {}).get("total_messages", 0),
                "preview": conv.get("messages", [{}])[-1].get("content", "")[:50] if conv.get("messages") else "",
                "imported_from": conv.get("metadata", {}).get("imported_from")
            }
            for conv in conversations
        ]
    })


@app.route("/api/conversations/<conv_id>", methods=["GET"])
@login_required
def get_conversation(conv_id):
    """获取特定对话的详情"""
    user_id = get_current_user_id()

    try:
        conversation = db.get_conversation(ObjectId(conv_id), user_id)
    except Exception:
        return jsonify({"error": "Invalid conversation ID"}), 400

    if not conversation:
        return jsonify({"error": "Conversation not found"}), 404

    return jsonify({
        "id": str(conversation["_id"]),
        "title": conversation.get("title", "新对话"),
        "messages": conversation.get("messages", []),
        "created_at": conversation.get("created_at").isoformat() if conversation.get("created_at") else None,
        "updated_at": conversation.get("updated_at").isoformat() if conversation.get("updated_at") else None
    })


@app.route("/api/conversations", methods=["POST"])
@login_required
def create_conversation():
    """创建新对话"""
    user_id = get_current_user_id()
    data = request.get_json() or {}

    title = data.get("title", "新对话")
    conversation = db.create_conversation(user_id, title)

    return jsonify({
        "success": True,
        "conversation": {
            "id": str(conversation["_id"]),
            "title": conversation["title"]
        }
    })


@app.route("/api/conversations/<conv_id>", methods=["PUT"])
@login_required
def update_conversation(conv_id):
    """更新对话（标题等）"""
    user_id = get_current_user_id()
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    try:
        conv_id_obj = ObjectId(conv_id)
    except Exception:
        return jsonify({"error": "Invalid conversation ID"}), 400

    # 检查对话是否存在且属于该用户
    conversation = db.get_conversation(conv_id_obj, user_id)
    if not conversation:
        return jsonify({"error": "Conversation not found"}), 404

    # 更新标题
    update_fields = {}
    if "title" in data:
        update_fields["title"] = data["title"]

    if not update_fields:
        return jsonify({"error": "No valid fields to update"}), 400

    from datetime import datetime
    update_fields["updated_at"] = datetime.utcnow()

    result = db.db["conversations"].update_one(
        {"_id": conv_id_obj, "user_id": user_id},
        {"$set": update_fields}
    )

    if result.modified_count > 0:
        return jsonify({"success": True})
    else:
        return jsonify({"error": "Failed to update conversation"}), 500


@app.route("/api/conversations/<conv_id>", methods=["DELETE"])
@login_required
def delete_conversation(conv_id):
    """删除对话"""
    user_id = get_current_user_id()

    try:
        success = db.delete_conversation(ObjectId(conv_id), user_id)
    except Exception:
        return jsonify({"error": "Invalid conversation ID"}), 400

    if not success:
        return jsonify({"error": "Conversation not found or already deleted"}), 404

    return jsonify({"success": True})


# ==================== 聊天记录导入接口 ====================

@app.route("/api/import/chatgpt", methods=["POST"])
@login_required
def import_conversations():
    """从 ChatGPT 导入聊天记录"""
    import zipfile
    import io
    from datetime import datetime, timezone

    user_id = get_current_user_id()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    try:
        # 读取文件内容
        file_content = file.read()
        raw_json = None

        # 支持 ZIP 和直接 JSON
        if file.filename.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(file_content)) as z:
                # 查找 conversations.json 或 conversations-000.json, conversations-001.json 等
                # ChatGPT 新版导出会把对话拆分成多个文件
                import re as _re
                json_files = [n for n in z.namelist() if _re.search(r'conversations(-\d+)?\.json$', n)]
                if not json_files:
                    return jsonify({"error": "No conversations.json found in ZIP"}), 400
                # 合并所有拆分文件
                data = []
                for jf in sorted(json_files):
                    part = json.loads(z.read(jf))
                    if isinstance(part, list):
                        data.extend(part)
                    elif isinstance(part, dict):
                        data.append(part)
                logger.info(f"[IMPORT] ZIP contains {len(json_files)} conversation files, {len(data)} total conversations")
        else:
            raw_json = file_content
            data = json.loads(raw_json)
            if not isinstance(data, list):
                return jsonify({"error": "Invalid format: expected a JSON array of conversations"}), 400

        # 解析 ChatGPT conversations
        imported = []
        total_messages = 0

        for conv in data:
            title = conv.get("title", "Imported Chat")
            create_time = conv.get("create_time")
            update_time = conv.get("update_time")
            mapping = conv.get("mapping", {})

            # 扁平化 ChatGPT 的 mapping 树结构
            messages = _flatten_chatgpt_mapping(mapping)

            if not messages:
                continue  # 跳过空对话

            # 转换时间戳
            created_at = datetime.fromtimestamp(create_time, tz=timezone.utc) if create_time else datetime.utcnow()
            updated_at = datetime.fromtimestamp(update_time, tz=timezone.utc) if update_time else datetime.utcnow()
            last_msg_time = messages[-1]["timestamp"] if messages else None

            imported.append({
                "user_id": user_id,
                "title": title,
                "messages": messages,
                "created_at": created_at,
                "updated_at": updated_at,
                "is_active": True,
                "metadata": {
                    "total_messages": len(messages),
                    "last_message_at": last_msg_time,
                    "imported_from": "chatgpt",
                    "import_session_activated": False
                }
            })
            total_messages += len(messages)

        if not imported:
            return jsonify({"error": "No valid conversations found in file"}), 400

        # 批量插入
        count = db.batch_create_conversations(imported)

        logger.info(f"[IMPORT] User {user_id} imported {count} conversations ({total_messages} messages) from ChatGPT")

        return jsonify({
            "success": True,
            "imported_count": count,
            "total_messages": total_messages
        })

    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON file"}), 400
    except zipfile.BadZipFile:
        return jsonify({"error": "Invalid ZIP file"}), 400
    except Exception as e:
        logger.error(f"[IMPORT] Failed: {e}", exc_info=True)
        return jsonify({"error": f"Import failed: {str(e)}"}), 500


def _flatten_chatgpt_mapping(mapping: dict) -> list:
    """
    将 ChatGPT 的 mapping 树结构扁平化为有序消息数组
    ChatGPT 用 {node_id: {message, parent, children}} 的树来存对话
    """
    from datetime import datetime, timezone

    # 找到根节点（parent 为 None 或 parent 不在 mapping 中的）
    root_id = None
    for node_id, node in mapping.items():
        parent = node.get("parent")
        if parent is None or parent not in mapping:
            root_id = node_id
            break

    if not root_id:
        return []

    # BFS/DFS 沿 children 链遍历（取第一个 child，即主线程）
    messages = []
    current_id = root_id

    while current_id:
        node = mapping.get(current_id)
        if not node:
            break

        msg = node.get("message")
        if msg and msg.get("content"):
            role = msg.get("author", {}).get("role", "")
            # 只保留 user 和 assistant 消息
            if role in ("user", "assistant"):
                parts = msg.get("content", {}).get("parts", [])
                # 过滤掉非文本 parts（图片等）
                text_parts = [p for p in parts if isinstance(p, str)]
                content = "\n".join(text_parts).strip()

                if content:
                    create_time = msg.get("create_time")
                    timestamp = datetime.fromtimestamp(create_time, tz=timezone.utc) if create_time else datetime.utcnow()

                    messages.append({
                        "id": str(ObjectId()),
                        "role": role,
                        "content": content,
                        "sources": [],
                        "timestamp": timestamp
                    })

        # 移动到下一个节点（取 children 的第一个）
        children = node.get("children", [])
        current_id = children[0] if children else None

    return messages


# ==================== 文档上传接口（可选） ====================

@app.route("/api/documents/upload", methods=["POST"])
@login_required
def upload_document():
    """上传文档到用户的 workspace"""
    user_id = get_current_user_id()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    # 确保用户有 workspace
    workspace_result = workspace_manager.get_or_create_workspace(user_id)
    if not workspace_result["success"]:
        return jsonify({"error": "Failed to get workspace"}), 500

    workspace = workspace_result["workspace"]

    try:
        # 保存临时文件
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file.filename}") as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        # 上传到 AnythingLLM
        api = AnythingLLMAPI(
            base_url=workspace_manager.anythingllm_base_url,
            api_key=workspace_manager.anythingllm_api_key,
            workspace_slug=workspace["slug"]
        )

        result = api.upload_document(tmp_path)

        # 清理临时文件
        os.unlink(tmp_path)

        if result.get("success"):
            # 更新 workspace 统计
            db.update_workspace_stats(user_id, document_count_delta=1)

            return jsonify({
                "success": True,
                "document": result.get("document_title", file.filename)
            })
        else:
            return jsonify({
                "success": False,
                "error": result.get("error", "Upload failed")
            }), 500

    except Exception as e:
        logger.error(f"Document upload error: {e}")
        return jsonify({"error": str(e)}), 500


# ==================== 性格测试接口 ====================

@app.route("/api/personality-test/status", methods=["GET"])
@login_required
def personality_test_status():
    """获取用户性格测试状态"""
    user = get_current_user()
    pt = user.get("personality_test")

    if pt and pt.get("completed"):
        return jsonify({
            "completed": True,
            "completed_at": pt.get("completed_at").isoformat() if pt.get("completed_at") else None,
            "tarot_cards": pt.get("tarot_cards", []),
            "dimensions": pt.get("dimensions", {}),
            "mbti": pt.get("mbti")
        })
    else:
        return jsonify({"completed": False})


@app.route("/api/personality-test/questions", methods=["GET"])
@login_required
def personality_test_questions():
    """获取性格测试题目"""
    user = get_current_user()
    # 优先使用前端传来的语言参数，其次用数据库设置
    language = request.args.get("lang") or user.get("settings", {}).get("language", "en")
    questions = get_questions(language)
    return jsonify({"questions": questions})


@app.route("/api/personality-test/submit", methods=["POST"])
@login_required
def personality_test_submit():
    """提交性格测试答案"""
    user_id = get_current_user_id()
    user = get_current_user()
    data = request.get_json()

    if not data or "answers" not in data:
        return jsonify({"error": "Missing answers"}), 400

    answers = data["answers"]

    # 验证答案：需要10道题的答案
    if not isinstance(answers, list) or len(answers) < 10:
        return jsonify({"error": "Need at least 10 answers"}), 400

    # 验证每个答案格式
    for ans in answers[:10]:
        if "question_id" not in ans or "score" not in ans:
            return jsonify({"error": "Each answer needs question_id and score"}), 400

    # 计算维度分数
    dimensions = calculate_dimensions(answers[:10])

    # 抽取塔罗牌
    tarot_cards = draw_tarot_cards(dimensions)

    # 获取 MBTI（可选）
    mbti = data.get("mbti")

    # 生成性格描述
    language = user.get("settings", {}).get("language", "en")
    personality_profile = generate_personality_profile(dimensions, tarot_cards, language)

    # 保存到用户文档
    from datetime import datetime
    personality_test = {
        "completed": True,
        "completed_at": datetime.utcnow(),
        "answers": answers,
        "dimensions": dimensions,
        "mbti": mbti,
        "tarot_cards": tarot_cards,
        "personality_profile": personality_profile
    }

    db.db["users"].update_one(
        {"_id": user_id},
        {"$set": {"personality_test": personality_test}}
    )

    # 更新 system prompt
    try:
        workspace_manager.update_system_prompt(
            user_id, user["name"], language=language, persona=personality_profile
        )
    except Exception as e:
        logger.warning(f"Error updating system prompt after personality test: {e}")

    return jsonify({
        "success": True,
        "dimensions": dimensions,
        "tarot_cards": tarot_cards,
        "mbti": mbti
    })


# ==================== 错误处理 ====================

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error"}), 500


# ==================== 管理员 API ====================

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "soullink-admin-2026")

def require_admin(f):
    """管理员接口鉴权装饰器"""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("X-Admin-Secret", "")
        if auth != ADMIN_SECRET:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


@app.route("/api/admin/sync-all", methods=["POST"])
@require_admin
def admin_sync_all():
    """一键同步所有用户的 system prompt + 知识库文档"""
    try:
        result = workspace_manager.sync_all()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Admin sync-all failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/sync-prompts", methods=["POST"])
@require_admin
def admin_sync_prompts():
    """只同步所有用户的 system prompt"""
    try:
        result = workspace_manager.sync_all_system_prompts()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Admin sync-prompts failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/sync-documents", methods=["POST"])
@require_admin
def admin_sync_documents():
    """只同步所有用户的知识库文档"""
    try:
        result = workspace_manager.sync_documents_for_all_users()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Admin sync-documents failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/stats", methods=["GET"])
@require_admin
def admin_stats():
    """获取系统统计信息"""
    try:
        user_count = db.db["users"].count_documents({})
        workspace_count = db.db["workspaces"].count_documents({})
        feedback_count = db.db["feedbacks"].count_documents({})
        waitlist_count = db.db["waitlist"].count_documents({})
        contact_count = db.db["contacts"].count_documents({})
        return jsonify({
            "users": user_count,
            "workspaces": workspace_count,
            "feedbacks": feedback_count,
            "waitlist": waitlist_count,
            "contacts": contact_count
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/ai-health", methods=["GET"])
@require_admin
def admin_ai_health():
    """通过 AnythingLLM workspace chat 端到端测试各 AI 服务延迟"""
    import time
    import requests as req
    from concurrent.futures import ThreadPoolExecutor, as_completed
    results = {}

    allm_url = os.getenv("ANYTHINGLLM_BASE_URL", "http://localhost:3001")
    allm_key = os.getenv("ANYTHINGLLM_API_KEY", "")
    allm_headers = {
        "Authorization": f"Bearer {allm_key}",
        "Content-Type": "application/json",
    }

    # 专用健康检测 workspace（每个绑定了对应 provider/model）
    HEALTH_WORKSPACES = {
        "gemini":  "soullink_test",       # gemini / gemini-2.5-flash
        "gpt":     "health-check-gpt",    # openai / gpt-4o
        "grok":    "health-check-grok",   # xai / grok-3-mini-fast
    }

    def _chat_health(name, slug):
        """向指定 workspace 发一条 chat，测端到端延迟"""
        try:
            t0 = time.time()
            r = req.post(
                f"{allm_url}/api/v1/workspace/{slug}/chat",
                headers=allm_headers,
                json={"message": "say ok", "mode": "chat"},
                timeout=30,
            )
            latency = int((time.time() - t0) * 1000)
            if r.status_code == 200:
                data = r.json()
                text = data.get("textResponse", "")
                if text:
                    return {name: {"ok": True, "latency": latency}}
                else:
                    return {name: {"ok": False, "error": "Empty response", "latency": latency}}
            else:
                return {name: {"ok": False, "error": f"HTTP {r.status_code}", "latency": latency}}
        except Exception as e:
            return {name: {"ok": False, "error": str(e)[:120]}}

    # 并行测试 Gemini / GPT-4o / Grok
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(_chat_health, name, slug) for name, slug in HEALTH_WORKSPACES.items()]
        for f in as_completed(futures):
            results.update(f.result())

    # --- AnythingLLM 本身（auth 检测 + workspace 数量）---
    try:
        t0 = time.time()
        r = req.get(f"{allm_url}/api/v1/auth", headers=allm_headers, timeout=10)
        latency = int((time.time() - t0) * 1000)
        if r.status_code == 200:
            try:
                r2 = req.get(f"{allm_url}/api/v1/workspaces", headers=allm_headers, timeout=5)
                ws_count = len(r2.json().get("workspaces", [])) if r2.status_code == 200 else "?"
            except Exception:
                ws_count = "?"
            results["anythingllm"] = {"ok": True, "latency": latency, "workspaces": ws_count}
        else:
            results["anythingllm"] = {"ok": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        results["anythingllm"] = {"ok": False, "error": str(e)[:100]}

    return jsonify(results)


# ==================== Waitlist & Contact (公开接口) ====================

@app.route("/api/waitlist", methods=["POST"])
def join_waitlist():
    """加入等待列表（无需登录）"""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "Valid email is required"}), 400

    try:
        # 检查是否已存在
        existing = db.db["waitlist"].find_one({"email": email})
        if existing:
            return jsonify({"success": True, "message": "Already on waitlist"})

        from datetime import datetime
        waitlist_doc = {
            "email": email,
            "source": data.get("source", "website"),
            "created_at": datetime.utcnow(),
            "status": "pending"
        }
        db.db["waitlist"].insert_one(waitlist_doc)
        logger.info(f"Waitlist signup: {email}")
        return jsonify({"success": True, "message": "Added to waitlist"})
    except Exception as e:
        logger.error(f"Waitlist signup failed: {e}")
        return jsonify({"error": "Server error"}), 500


@app.route("/api/contact", methods=["POST"])
def submit_contact():
    """提交联系表单（无需登录）"""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    message = (data.get("message") or "").strip()

    if not email or "@" not in email:
        return jsonify({"error": "Valid email is required"}), 400
    if not message:
        return jsonify({"error": "Message is required"}), 400
    if len(message) > 2000:
        return jsonify({"error": "Message must be 2000 characters or less"}), 400

    try:
        from datetime import datetime
        contact_doc = {
            "name": name,
            "email": email,
            "message": message,
            "source": data.get("source", "website"),
            "created_at": datetime.utcnow(),
            "status": "new"
        }
        db.db["contacts"].insert_one(contact_doc)
        logger.info(f"Contact form from {email}: {message[:50]}...")
        return jsonify({"success": True, "message": "Message sent"})
    except Exception as e:
        logger.error(f"Contact form failed: {e}")
        return jsonify({"error": "Server error"}), 500


# ==================== 自定义角色 & 知识库 ====================

@app.route("/api/user/search-character", methods=["POST"])
@login_required
def search_character_api():
    """用 Gemini + Google Search 搜索已有角色的详细设定"""
    from character_parser import search_character

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"error": "Search query is required"}), 400

    if len(query) > 200:
        return jsonify({"error": "Query too long (max 200 chars)"}), 400

    # 获取用户语言偏好：优先前端传入，其次数据库设置
    user = get_current_user()
    language = data.get("language") or user.get("settings", {}).get("language", "en")

    result = search_character(query, language=language)

    if result.get("success"):
        return jsonify({
            "success": True,
            "description": result.get("description"),
            "query": result.get("query")
        })
    else:
        return jsonify({
            "success": False,
            "error": result.get("error", "Search failed")
        }), 500


@app.route("/api/user/import-persona", methods=["POST"])
@login_required
def import_persona():
    """用 Gemini 从用户文本中提取角色核心性格（仅预览，不保存）"""
    from character_parser import extract_persona_with_ai

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Text is required"}), 400

    if len(text) > 10000:
        return jsonify({"error": "Text too long (max 10000 chars)"}), 400

    # 获取用户语言偏好：优先前端传入，其次数据库设置
    user = get_current_user()
    language = data.get("language") or user.get("settings", {}).get("language", "en")

    result = extract_persona_with_ai(text, language=language)

    if result.get("success"):
        preview = {
            "name": result.get("name"),
            "core_persona": result.get("core_persona")
        }
        if result.get("appearance"):
            preview["appearance"] = result["appearance"]
        return jsonify({
            "success": True,
            "preview": preview
        })
    else:
        return jsonify({
            "success": False,
            "error": result.get("error", "AI extraction failed")
        }), 500


@app.route("/api/user/confirm-persona", methods=["POST"])
@login_required
def confirm_persona():
    """确认并保存角色性格到 system prompt"""
    user_id = get_current_user_id()
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    core_persona = (data.get("core_persona") or "").strip()
    if not core_persona:
        return jsonify({"error": "core_persona is required"}), 400

    persona_name = (data.get("name") or "").strip() or None
    appearance = (data.get("appearance") or "").strip() or None

    try:
        from datetime import datetime

        # 保存到 user.settings
        update_fields = {
            "settings.custom_persona": core_persona,
            "settings.custom_persona_imported_at": datetime.utcnow().isoformat(),
        }
        if persona_name:
            update_fields["settings.custom_persona_name"] = persona_name
        else:
            update_fields["settings.custom_persona_name"] = None

        # 如果有提取到的外观描述，直接缓存到 image_appearance（用于图片生成）
        # 这样即使用户改了昵称，图片生成仍然使用原始角色的外貌特征
        unset_fields = {"settings.voice_style": ""}
        if appearance:
            update_fields["settings.image_appearance"] = appearance
        else:
            unset_fields["settings.image_appearance"] = ""

        db.db["users"].update_one(
            {"_id": user_id},
            {
                "$set": update_fields,
                "$unset": unset_fields
            }
        )

        # 更新 system prompt（会自动从 user.settings.custom_persona 读取）
        user = db.db["users"].find_one({"_id": user_id})
        user_name = user.get("name", "Friend") if user else "Friend"
        result = workspace_manager.update_system_prompt(user_id, user_name)

        if result.get("success"):
            logger.info(f"[PERSONA] Custom persona saved for user {user_id}: {persona_name or 'unnamed'}")
            return jsonify({"success": True})
        else:
            return jsonify({
                "success": False,
                "error": result.get("error", "Failed to update system prompt")
            }), 500

    except Exception as e:
        logger.error(f"[PERSONA] Error saving persona: {e}")
        return jsonify({"error": str(e)}), 500


MAX_LORE_DOCS = 10  # 每用户最多知识库文档数


def _migrate_lore_fields(user_id, settings):
    """懒迁移：将旧的单文件 lore 字段转换为新的 docs 数组格式"""
    if "custom_lore_status" not in settings:
        return  # 没有旧字段，无需迁移
    if "custom_lore_docs" in settings:
        return  # 已经有新字段，无需迁移

    old_status = settings.get("custom_lore_status")
    migrated_docs = []
    if old_status in ("ready", "processing"):
        migrated_docs = [{
            "id": f"lore_{str(user_id)}_migrated",
            "doc_name": settings.get("custom_lore_doc_name", f"custom_lore_{str(user_id)}.txt"),
            "doc_location": settings.get("custom_lore_doc_location", ""),
            "original_filename": settings.get("custom_lore_original_filename", ""),
            "imported_at": settings.get("custom_lore_imported_at", ""),
            "status": old_status,
        }]

    db.db["users"].update_one(
        {"_id": user_id},
        {
            "$set": {"settings.custom_lore_docs": migrated_docs},
            "$unset": {
                "settings.custom_lore_status": "",
                "settings.custom_lore_doc_name": "",
                "settings.custom_lore_doc_location": "",
                "settings.custom_lore_imported_at": "",
                "settings.custom_lore_original_filename": "",
            }
        }
    )
    logger.info(f"[LORE] Migrated old lore fields for user {user_id}, docs={len(migrated_docs)}")


@app.route("/api/user/import-lore", methods=["POST"])
@login_required
def import_lore():
    """导入知识库资料到 AnythingLLM workspace（支持多文件，追加模式）"""
    user_id = get_current_user_id()

    # 支持两种方式：JSON body（text 字段）或 multipart/form-data（file）
    text_content = None
    original_filename = None

    if request.content_type and "multipart/form-data" in request.content_type:
        # 文件上传
        if "file" in request.files:
            file = request.files["file"]
            if file.filename:
                original_filename = file.filename
                try:
                    text_content = file.read().decode("utf-8")
                except UnicodeDecodeError:
                    return jsonify({"error": "File must be UTF-8 text"}), 400
        # 也可能同时有 text 字段
        if not text_content:
            text_content = request.form.get("text", "").strip()
    else:
        data = request.get_json()
        if data:
            text_content = (data.get("text") or "").strip()

    if not text_content:
        return jsonify({"error": "No content provided (text or file required)"}), 400

    if len(text_content) > 100000:
        return jsonify({"error": "Content too large (max 100K chars)"}), 400

    try:
        import tempfile
        import time
        from datetime import datetime

        # 懒迁移旧字段
        user = db.db["users"].find_one({"_id": user_id})
        settings = (user or {}).get("settings", {})
        _migrate_lore_fields(user_id, settings)

        # 重新读取（迁移后可能变化）
        user = db.db["users"].find_one({"_id": user_id})
        existing_docs = (user or {}).get("settings", {}).get("custom_lore_docs", [])

        # 检查数量上限
        if len(existing_docs) >= MAX_LORE_DOCS:
            return jsonify({"error": f"Maximum {MAX_LORE_DOCS} documents allowed"}), 400

        # 生成唯一文档名
        timestamp = int(time.time())
        doc_id = f"lore_{str(user_id)}_{timestamp}"
        doc_name = f"{doc_id}.txt"

        # 确保用户有 workspace
        workspace_result = workspace_manager.get_or_create_workspace(user_id)
        if not workspace_result["success"]:
            return jsonify({"error": "Failed to get workspace"}), 500

        workspace = workspace_result["workspace"]

        # 写临时文件
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", delete=False,
            suffix=f"_{doc_name}"
        ) as tmp:
            tmp.write(text_content)
            tmp_path = tmp.name

        # 上传到 AnythingLLM
        api = AnythingLLMAPI(
            base_url=workspace_manager.anythingllm_base_url,
            api_key=workspace_manager.anythingllm_api_key,
            workspace_slug=workspace["slug"]
        )

        result = api.upload_document(tmp_path)

        # 清理临时文件
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

        if result.get("status_code") == 200 and result.get("data", {}).get("success"):
            # 成功 — 追加文档到数组
            doc_location = result.get("data", {}).get("document_location", doc_name)
            new_doc_entry = {
                "id": doc_id,
                "doc_name": doc_name,
                "doc_location": doc_location,
                "original_filename": original_filename or doc_name,
                "imported_at": datetime.utcnow().isoformat(),
                "status": "ready",
            }
            db.db["users"].update_one(
                {"_id": user_id},
                {"$push": {"settings.custom_lore_docs": new_doc_entry}}
            )
            logger.info(f"[LORE] Knowledge base doc added for user {user_id}: {doc_name} (location: {doc_location})")
            return jsonify({
                "success": True,
                "doc": new_doc_entry
            })
        else:
            error_msg = result.get("error") or result.get("data", {}).get("error", "Upload failed")
            logger.error(f"[LORE] Upload failed: {error_msg}")
            return jsonify({
                "success": False,
                "error": str(error_msg)
            }), 500

    except Exception as e:
        logger.error(f"[LORE] Error importing lore: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/user/clear-persona", methods=["POST"])
@login_required
def clear_persona():
    """清除自定义角色性格，恢复默认 persona"""
    user_id = get_current_user_id()

    try:
        # 清除 custom_persona 及相关缓存
        db.db["users"].update_one(
            {"_id": user_id},
            {"$unset": {
                "settings.custom_persona": "",
                "settings.custom_persona_name": "",
                "settings.custom_persona_imported_at": "",
                "settings.voice_style": "",
                "settings.image_appearance": "",
            }}
        )

        # 更新 system prompt（会回退到性格测试 persona 或默认）
        user = db.db["users"].find_one({"_id": user_id})
        user_name = user.get("name", "Friend") if user else "Friend"
        result = workspace_manager.update_system_prompt(user_id, user_name)

        logger.info(f"[PERSONA] Custom persona cleared for user {user_id}")
        return jsonify({"success": True})

    except Exception as e:
        logger.error(f"[PERSONA] Error clearing persona: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/user/clear-lore", methods=["POST"])
@login_required
def clear_lore():
    """清除知识库文档：支持删除单个（传 doc_id）或全部（不传 doc_id）"""
    user_id = get_current_user_id()
    data = request.get_json() or {}
    doc_id = data.get("doc_id")  # 可选：指定删除哪个文档

    try:
        user = db.db["users"].find_one({"_id": user_id})
        settings = (user or {}).get("settings", {})

        # 懒迁移旧字段
        _migrate_lore_fields(user_id, settings)
        # 重新读取
        user = db.db["users"].find_one({"_id": user_id})
        docs = (user or {}).get("settings", {}).get("custom_lore_docs", [])

        # 获取 workspace slug
        workspace = db.get_workspace_by_user(user_id)
        api = None
        if workspace and workspace.get("slug"):
            api = AnythingLLMAPI(
                base_url=workspace_manager.anythingllm_base_url,
                api_key=workspace_manager.anythingllm_api_key,
                workspace_slug=workspace["slug"]
            )

        if doc_id:
            # 删除单个文档
            target_doc = next((d for d in docs if d.get("id") == doc_id), None)
            if not target_doc:
                return jsonify({"error": "Document not found"}), 404

            # 从 AnythingLLM 删除（非阻塞）
            if api and target_doc.get("doc_location"):
                try:
                    delete_result = api.remove_document_from_workspace(target_doc["doc_location"])
                    logger.info(f"[LORE] Deleted doc {doc_id} from AnythingLLM: {delete_result.get('success')}")
                except Exception as e:
                    logger.warning(f"[LORE] AnythingLLM delete failed (non-blocking): {e}")

            # 从数组中移除
            db.db["users"].update_one(
                {"_id": user_id},
                {"$pull": {"settings.custom_lore_docs": {"id": doc_id}}}
            )
            logger.info(f"[LORE] Removed doc {doc_id} for user {user_id}")
        else:
            # 删除全部文档
            for doc in docs:
                if api and doc.get("doc_location"):
                    try:
                        api.remove_document_from_workspace(doc["doc_location"])
                    except Exception as e:
                        logger.warning(f"[LORE] AnythingLLM delete failed for {doc.get('id')}: {e}")

            db.db["users"].update_one(
                {"_id": user_id},
                {"$set": {"settings.custom_lore_docs": []}}
            )
            logger.info(f"[LORE] Cleared all {len(docs)} docs for user {user_id}")

        return jsonify({"success": True})

    except Exception as e:
        import traceback
        logger.error(f"[LORE] Error clearing lore: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/user/custom-status", methods=["GET"])
@login_required
def custom_status():
    """获取当前自定义角色和知识库状态"""
    user = get_current_user()
    user_id = user.get("_id")
    settings = user.get("settings", {})

    # 懒迁移旧的单文件 lore 字段
    _migrate_lore_fields(user_id, settings)
    # 重新读取（迁移后可能变化）
    if "custom_lore_status" in settings and "custom_lore_docs" not in settings:
        user = db.db["users"].find_one({"_id": user_id})
        settings = (user or {}).get("settings", {})

    return jsonify({
        "persona": {
            "active": bool(settings.get("custom_persona")),
            "name": settings.get("custom_persona_name"),
            "imported_at": settings.get("custom_persona_imported_at"),
        },
        "lore": {
            "docs": settings.get("custom_lore_docs", []),
            "max_docs": MAX_LORE_DOCS,
        }
    })


# ==================== 语音接口 (Voice API) ====================

# Voice uploads directory (fallback for local storage)
VOICE_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "voice")
os.makedirs(VOICE_UPLOAD_DIR, exist_ok=True)


def _upload_audio_to_cloudinary(audio_data: bytes, prefix: str = "tts", ext: str = "mp3") -> str:
    """Upload audio to Cloudinary. Returns CDN URL or empty string on failure."""
    try:
        import image_gen as _img_mod
        import cloudinary.uploader
        _img_mod._ensure_cloudinary()
        # 必须通过模块引用检查，from import 导入的是值副本不会更新
        if not _img_mod._cloudinary_configured:
            logger.warning("[Voice] Cloudinary not configured, skipping upload")
            return ""
        from datetime import datetime, timezone
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        public_id = f"soullink/voice/{prefix}_{timestamp}_{uuid.uuid4().hex[:6]}"
        result = cloudinary.uploader.upload(
            audio_data,
            public_id=public_id,
            resource_type="raw",  # Raw avoids media processing, prevents Range request 400s on free tier
            overwrite=True,
            format=ext,
        )
        url = result.get("secure_url", "")
        if url:
            logger.info(f"[Voice] Uploaded to Cloudinary: {url[:80]}")
        return url
    except Exception as e:
        logger.warning(f"[Voice] Cloudinary upload failed: {e}")
        return ""


def _save_audio_file(audio_data: bytes, prefix: str = "tts", ext: str = "mp3") -> str:
    """Save audio: try Cloudinary first, fallback to local storage."""
    # Try Cloudinary first
    cdn_url = _upload_audio_to_cloudinary(audio_data, prefix, ext)
    if cdn_url:
        return cdn_url
    # Fallback: save locally
    filename = f"{prefix}_{uuid.uuid4().hex[:12]}.{ext}"
    filepath = os.path.join(VOICE_UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(audio_data)
    logger.info(f"[Voice] Saved {len(audio_data)} bytes locally to {filepath}")
    return f"/uploads/voice/{filename}"


def _detect_audio_format(filename: str) -> str:
    """Detect audio format from filename extension."""
    filename = filename.lower()
    for ext in [".wav", ".mp3", ".m4a", ".webm", ".aac", ".amr", ".opus"]:
        if filename.endswith(ext):
            return ext[1:]  # remove the dot
    return "wav"


@app.route("/uploads/voice/<filename>")
def serve_voice_file(filename):
    """Serve voice audio files from uploads directory."""
    return send_from_directory(VOICE_UPLOAD_DIR, filename)


@app.route("/api/voice/tts", methods=["POST"])
@login_required
def voice_tts():
    """
    文本转语音 (Text-to-Speech) via Fish Audio
    POST /api/voice/tts
    Body: { "text": "...", "voice_id": "optional_fish_audio_ref_id" }
    Returns: { "success": true, "audio_b64": "...", "size": ... }
    """
    try:
        from voice_service import synthesize_speech, check_voice_service_health

        health = check_voice_service_health()
        if not health["configured"]:
            return jsonify({"error": "Voice service not configured. FISH_AUDIO_KEY is missing."}), 503

        data = request.get_json()
        if not data or not data.get("text"):
            return jsonify({"error": "Missing 'text' field"}), 400

        text = data["text"].strip()
        if not text:
            return jsonify({"error": "Text cannot be empty"}), 400

        user = get_current_user()
        user_id = get_current_user_id()
        settings = user.get("settings", {})
        gender = settings.get("companion_gender", "female")
        subtype = settings.get("companion_subtype", "")

        # Priority: request voice_id > user settings voice_id > auto-detect from persona > default
        voice_id = data.get("voice_id") or settings.get("voice_id")

        if not voice_id:
            # Auto-detect from persona if custom persona is set
            from voice_service import extract_voice_style_from_persona
            custom_persona = settings.get("custom_persona", "")
            if custom_persona and subtype not in (
                "female_gentle", "female_cold", "female_cute", "female_cheerful",
                "male_ceo", "male_warm", "male_classmate", "male_badboy",
            ):
                cached_style = settings.get("voice_style", "")
                if cached_style:
                    subtype = cached_style
                else:
                    voice_style = extract_voice_style_from_persona(custom_persona, gender)
                    subtype = voice_style
                    try:
                        db.db["users"].update_one(
                            {"_id": user_id},
                            {"$set": {"settings.voice_style": voice_style}}
                        )
                    except Exception:
                        pass

        # Determine language for voice selection
        user_lang = settings.get("language", "en")
        voice_lang = "zh" if user_lang.startswith("zh") else "en"

        audio_data = synthesize_speech(
            text=text,
            voice_id=voice_id,
            gender=gender,
            subtype=subtype,
            language=voice_lang,
        )

        import base64 as b64mod
        audio_b64 = b64mod.b64encode(audio_data).decode("ascii")
        logger.info(f"[TTS] Returning {len(audio_data)} bytes as base64 (Fish Audio, lang={voice_lang})")

        return jsonify({
            "success": True,
            "audio_b64": audio_b64,
            "size": len(audio_data),
        })

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"[TTS] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"TTS synthesis failed: {str(e)}"}), 500


@app.route("/api/voice/list", methods=["GET"])
@login_required
def voice_list():
    """
    获取预设音色列表
    GET /api/voice/list
    Returns: { "voices": [{ "id", "name", "gender", "type", "is_preset" }] }
    """
    try:
        from voice_service import list_preset_voices
        user = get_current_user()
        settings = user.get("settings", {})
        current_voice_id = settings.get("voice_id", "")
        current_voice_name = settings.get("voice_name", "")

        # Frontend passes ?lang=zh or ?lang=en to match its current i18n state
        lang_param = request.args.get("lang", "")
        if lang_param:
            voice_lang = "zh" if lang_param.startswith("zh") else "en"
        else:
            user_lang = settings.get("language", "en")
            voice_lang = "zh" if user_lang.startswith("zh") else "en"
        presets = list_preset_voices(language=voice_lang)

        return jsonify({
            "voices": presets,
            "current_voice_id": current_voice_id,
            "current_voice_name": current_voice_name,
        })
    except Exception as e:
        logger.error(f"[VOICE] List error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/voice/search", methods=["GET"])
@login_required
def voice_search():
    """
    搜索 Fish Audio 社区音色
    GET /api/voice/search?q=xxx&language=zh&page=1&page_size=20
    Returns: { "total": int, "voices": [...] }
    """
    try:
        from voice_service import search_voices

        query = request.args.get("q", "")
        language = request.args.get("language", None)
        page = int(request.args.get("page", 1))
        page_size = int(request.args.get("page_size", 20))

        result = search_voices(
            query=query,
            language=language,
            page=page,
            page_size=page_size,
        )

        return jsonify(result)
    except Exception as e:
        logger.error(f"[VOICE] Search error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/voice/model/<model_id>", methods=["GET"])
@login_required
def voice_model_detail(model_id):
    """
    获取单个音色详情（含头像 + 试听音频）
    GET /api/voice/model/<model_id>
    Returns: { "id", "name", "cover_image", "samples": [{ "audio", "text" }], ... }
    """
    try:
        from voice_service import get_voice_model_detail
        detail = get_voice_model_detail(model_id)
        return jsonify(detail)
    except Exception as e:
        logger.error(f"[VOICE] Model detail error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/voice/preview", methods=["POST"])
@login_required
def voice_preview():
    """
    试听音色：用指定音色合成一句示例文本
    POST /api/voice/preview
    Body: { "voice_id": "fish_audio_ref_id", "text": "optional sample text" }
    Returns: { "success": true, "audio_b64": "..." }
    """
    try:
        from voice_service import synthesize_speech, check_voice_service_health

        health = check_voice_service_health()
        if not health["configured"]:
            return jsonify({"error": "Voice service not configured"}), 503

        data = request.get_json()
        voice_id = data.get("voice_id")
        if not voice_id:
            return jsonify({"error": "Missing voice_id"}), 400

        # Default preview text based on user language
        user = get_current_user()
        user_lang = user.get("settings", {}).get("language", "en")
        if user_lang.startswith("zh"):
            default_text = "你好呀，很高兴认识你！今天过得怎么样？"
        else:
            default_text = "Hey there! Nice to meet you. How's your day going?"
        text = data.get("text", default_text)

        audio_data = synthesize_speech(text=text, voice_id=voice_id)

        import base64 as b64mod
        audio_b64 = b64mod.b64encode(audio_data).decode("ascii")

        return jsonify({
            "success": True,
            "audio_b64": audio_b64,
            "size": len(audio_data),
        })
    except Exception as e:
        logger.error(f"[VOICE] Preview error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/voice/upload", methods=["POST"])
@login_required
def voice_upload():
    """
    上传语音消息 (Upload voice recording + STT)
    POST /api/voice/upload
    Body: multipart/form-data with 'audio' file
    Optional: format, sample_rate
    Returns: { "success": true, "audio_url": "...", "text": "...", "duration": ... }
    """
    try:
        from voice_service import recognize_speech, check_voice_service_health
        import wave
        import io

        health = check_voice_service_health()
        if not health["configured"]:
            return jsonify({"error": "Voice service not configured. DASHSCOPE_API_KEY is missing."}), 503

        if "audio" not in request.files:
            return jsonify({"error": "No audio file provided. Use 'audio' field in multipart form."}), 400

        audio_file = request.files["audio"]
        if not audio_file.filename:
            return jsonify({"error": "Empty audio file"}), 400

        audio_data = audio_file.read()
        if not audio_data or len(audio_data) < 100:
            return jsonify({"error": "Audio file is too small or empty"}), 400

        audio_format = request.form.get("format", "").lower()
        if not audio_format:
            audio_format = _detect_audio_format(audio_file.filename)

        sample_rate = int(request.form.get("sample_rate", 16000))

        logger.info(f"[VoiceUpload] Received {len(audio_data)} bytes, format={audio_format}, filename={audio_file.filename}")

        # Calculate duration from WAV header if possible
        duration = 0.0
        if audio_format == "wav":
            try:
                with wave.open(io.BytesIO(audio_data), "rb") as wf:
                    frames = wf.getnframes()
                    rate = wf.getframerate()
                    if rate > 0:
                        duration = round(frames / rate, 1)
            except Exception as e:
                logger.warning(f"[VoiceUpload] Could not read WAV duration: {e}")

        # Convert to wav for reliable storage & playback (handles mislabeled formats)
        from voice_service import _ensure_wav
        save_data, save_fmt = _ensure_wav(audio_data, audio_format or "webm")
        audio_url = _save_audio_file(save_data, prefix="user", ext=save_fmt)

        # Run STT to get text transcription
        text = ""
        try:
            text = recognize_speech(
                audio_data=audio_data,
                audio_format=audio_format,
                sample_rate=sample_rate,
            )
        except Exception as stt_err:
            logger.warning(f"[VoiceUpload] STT failed (non-fatal): {stt_err}")
            # STT failure is non-fatal — the voice message is still saved

        return jsonify({
            "success": True,
            "audio_url": audio_url,
            "text": text,
            "duration": duration,
            "size": len(audio_data),
        })

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"[VoiceUpload] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Voice upload failed: {str(e)}"}), 500


@app.route("/api/voice/stt", methods=["POST"])
@login_required
def voice_stt():
    """
    语音转文字 (Speech-to-Text)
    POST /api/voice/stt
    Body: multipart/form-data with 'audio' file
    Optional query params: format (wav/mp3/m4a/webm), sample_rate (16000)
    Returns: { "success": true, "text": "recognized text" }
    """
    try:
        from voice_service import recognize_speech, check_voice_service_health

        health = check_voice_service_health()
        if not health["configured"]:
            return jsonify({"error": "Voice service not configured. DASHSCOPE_API_KEY is missing."}), 503

        # Check for audio file in request
        if "audio" not in request.files:
            return jsonify({"error": "No audio file provided. Use 'audio' field in multipart form."}), 400

        audio_file = request.files["audio"]
        if not audio_file.filename:
            return jsonify({"error": "Empty audio file"}), 400

        # Read audio data
        audio_data = audio_file.read()
        if not audio_data or len(audio_data) < 100:
            return jsonify({"error": "Audio file is too small or empty"}), 400

        # Determine audio format from filename or request param
        audio_format = request.form.get("format", "").lower()
        if not audio_format:
            audio_format = _detect_audio_format(audio_file.filename)

        sample_rate = int(request.form.get("sample_rate", 16000))

        logger.info(f"[STT] Received {len(audio_data)} bytes, format={audio_format}, filename={audio_file.filename}")

        text = recognize_speech(
            audio_data=audio_data,
            audio_format=audio_format,
            sample_rate=sample_rate,
        )

        return jsonify({
            "success": True,
            "text": text,
        })

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"[STT] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Speech recognition failed: {str(e)}"}), 500


@app.route("/api/voice/health", methods=["GET"])
def voice_health():
    """语音服务健康检查"""
    try:
        from voice_service import check_voice_service_health
        return jsonify(check_voice_service_health())
    except ImportError:
        return jsonify({"configured": False, "error": "voice_service module not found"}), 503


# ==================== 启动应用 ====================

if __name__ == "__main__":
    # 初始化数据库连接
    db.connect()

    # 启动服务
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    logger.info(f"Starting SoulLink Backend on port {port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
