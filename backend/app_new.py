"""
SoulLink Backend - 支持多用户的版本
使用 MongoDB + Google OAuth + 用户隔离的 Workspace
"""

import os
import json
import logging
from flask import Flask, request, jsonify
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
        # 验证头像数据（支持 data URL 或相对路径）
        if avatar_url:
            if avatar_url.startswith("data:image/"):
                # Base64 图片，限制大小（约 2MB base64）
                if len(avatar_url) > 3 * 1024 * 1024:
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


@app.route("/api/user/settings", methods=["PUT"])
@login_required
def update_settings():
    """更新用户设置"""
    user_id = get_current_user_id()
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    # 只允许更新特定字段
    allowed_fields = ["theme", "language", "notifications_enabled", "model", "companion_name", "companion_avatar", "companion_gender", "companion_subtype", "chat_background"]
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
        # Allow relative paths or data URLs, limit size to ~500KB
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
    if "companion_subtype" in data or "companion_gender" in data:
        logger.info(f"[STYLE] Companion style changed! data={data}")
        try:
            from personality_engine import generate_personality_profile, COMPANION_SUBTYPES
            # 从数据库重新读取最新用户数据（不用缓存的 request.current_user）
            user = db.db["users"].find_one({"_id": user_id})
            subtype = data.get("companion_subtype") or user.get("settings", {}).get("companion_subtype", "female_gentle")
            gender = data.get("companion_gender") or user.get("settings", {}).get("companion_gender", "female")
            language = user.get("settings", {}).get("language", "en")
            logger.info(f"[STYLE] subtype={subtype}, gender={gender}, language={language}")

            pt = user.get("personality_test", {})
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

            # 如果用户使用的是默认名字，自动切换到新子类型的默认名字
            all_defaults = [s["default_name"] for s in COMPANION_SUBTYPES.values()]
            current_name = user.get("settings", {}).get("companion_name", "Abigail")
            if current_name in all_defaults or not current_name:
                new_default = COMPANION_SUBTYPES.get(subtype, {}).get("default_name", "Abigail")
                db.db["users"].update_one(
                    {"_id": user_id}, {"$set": {"settings.companion_name": new_default}}
                )
                logger.info(f"[STYLE] Auto-renamed companion: {current_name} -> {new_default}")

            # 更新 system prompt
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
        logger.info(f"Message: {user_message[:50]}... | show_thinking={show_thinking} | attachments={len(attachments) if attachments else 0}")

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

    # 确保 AnythingLLM workspace 的 model 与用户设置一致
    # （防止 MongoDB 和 AnythingLLM 不同步的情况）
    try:
        user_model = user.get("settings", {}).get("model", "gemini")
        if user_model in workspace_manager.SUPPORTED_MODELS:
            model_config = workspace_manager.SUPPORTED_MODELS[user_model]
            import requests as req
            sync_url = f"{workspace_manager.anythingllm_base_url}/api/v1/workspace/{workspace_slug}/update"
            sync_headers = {
                "Authorization": f"Bearer {workspace_manager.anythingllm_api_key}",
                "Content-Type": "application/json"
            }
            sync_payload = {
                "chatProvider": model_config["chatProvider"],
                "chatModel": model_config["chatModel"],
            }
            req.post(sync_url, headers=sync_headers, json=sync_payload, timeout=3)
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

    # 保存用户消息（附件只存元数据，不存base64）
    attachment_meta = None
    if attachments:
        attachment_meta = [{"name": a.get("name", "file"), "mime": a.get("mime", ""), "isImage": a.get("mime", "").startswith("image/")} for a in attachments]
    db.add_message_to_conversation(
        conversation["_id"],
        user_id,
        "user",
        user_message,
        attachments=attachment_meta
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
                # 尝试在内容中找到实际回复（通常 thinking 后面跟着双换行 + 回复）
                # 或者 Gemini 把回复放在最后一段
                split_match = re.split(r'\n\n(?=[^\n*#\-])', raw, maxsplit=1)
                if len(split_match) > 1 and len(split_match[-1].strip()) > 5:
                    # 最后一段看起来像是实际回复
                    thinking_content = split_match[0].strip()
                    reply = split_match[-1].strip()
                else:
                    # 整个内容都是 thinking，没有明确的回复分隔
                    thinking_content = raw
                    reply = ""  # 会在后面触发 fallback
                logger.info(f"[THINKING] Extracted unclosed thinking tag ({len(thinking_content)} chars), reply len={len(reply)}")

        # Pattern 2: "THOUGHT" 前缀（Gemini 思考泄露）
        # 格式: THOUGHT\n英文分析...\nPlan:\n1. ...\n\n中文回复
        # 或: THOUGHT\n英文分析...\nPlan:\n1. ...\nN. 英文...中文回复（无双换行）
        if not thinking_content and re.match(r'^THOUGHT[\s\n]', reply):
            raw = re.sub(r'^THOUGHT[\s\n]+', '', reply).strip()
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

        # 保存 AI 回复（保存清理后的版本，含 thinking）
        db.add_message_to_conversation(
            conversation["_id"],
            user_id,
            "assistant",
            reply,
            sources,
            thinking=thinking_content if thinking_content else None
        )

        # 更新统计
        db.update_workspace_stats(user_id, message_count_delta=2)

        result = {
            "success": True,
            "reply": reply,
            "sources": sources,
            "conversation_id": str(conversation["_id"])
        }
        if thinking_content and show_thinking:
            result["thinking"] = thinking_content
        if companion_name_changed:
            result["companionNameChanged"] = companion_name_changed

        # 异步提取记忆（不阻塞响应）
        import threading
        def _async_memory_extraction(uid, umsg, areply):
            try:
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


# ==================== 对话历史接口 ====================

@app.route("/api/conversations", methods=["GET"])
@login_required
def list_conversations():
    """获取用户的对话列表"""
    user_id = get_current_user_id()
    limit = request.args.get("limit", 20, type=int)
    skip = request.args.get("skip", 0, type=int)

    conversations = db.get_user_conversations(user_id, limit, skip)

    return jsonify({
        "conversations": [
            {
                "id": str(conv["_id"]),
                "title": conv.get("title", "新对话"),
                "updated_at": conv.get("updated_at").isoformat() if conv.get("updated_at") else None,
                "message_count": conv.get("metadata", {}).get("total_messages", 0),
                "preview": conv.get("messages", [{}])[-1].get("content", "")[:50] if conv.get("messages") else ""
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
    """检测 Gemini / GPT / AnythingLLM 服务是否正常"""
    import time
    results = {}

    # --- Gemini ---
    try:
        import google.generativeai as genai
        api_key = os.getenv("GOOGLE_GEMINI_API_KEY")
        if not api_key:
            results["gemini"] = {"ok": False, "error": "API key not set"}
        else:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            t0 = time.time()
            resp = model.generate_content("Hi", generation_config={"max_output_tokens": 5})
            latency = int((time.time() - t0) * 1000)
            results["gemini"] = {"ok": True, "latency": latency}
    except Exception as e:
        results["gemini"] = {"ok": False, "error": str(e)[:100]}

    # --- GPT-4o (via AnythingLLM workspaces) ---
    try:
        import requests as req
        allm_url = os.getenv("ANYTHINGLLM_BASE_URL", "http://localhost:3001")
        allm_key = os.getenv("ANYTHINGLLM_API_KEY", "")
        t0 = time.time()
        r = req.get(
            f"{allm_url}/api/v1/workspaces",
            headers={"Authorization": f"Bearer {allm_key}"},
            timeout=10
        )
        latency = int((time.time() - t0) * 1000)
        if r.status_code == 200:
            workspaces = r.json().get("workspaces", [])
            results["gpt"] = {"ok": True, "latency": latency, "workspaces": len(workspaces)}
        else:
            results["gpt"] = {"ok": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        results["gpt"] = {"ok": False, "error": str(e)[:100]}

    # --- AnythingLLM ---
    try:
        import requests as req
        allm_url = os.getenv("ANYTHINGLLM_BASE_URL", "http://localhost:3001")
        allm_key = os.getenv("ANYTHINGLLM_API_KEY", "")
        t0 = time.time()
        r = req.get(
            f"{allm_url}/api/v1/auth",
            headers={"Authorization": f"Bearer {allm_key}"},
            timeout=10
        )
        latency = int((time.time() - t0) * 1000)
        if r.status_code == 200:
            results["anythingllm"] = {"ok": True, "latency": latency}
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


# ==================== 启动应用 ====================

if __name__ == "__main__":
    # 初始化数据库连接
    db.connect()

    # 启动服务
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    logger.info(f"Starting SoulLink Backend on port {port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
