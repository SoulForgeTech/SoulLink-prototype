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
    handle_email_login
)
from workspace_manager import workspace_manager
from anythingllm_api import AnythingLLMAPI

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
    result = handle_google_login(user_info)

    return jsonify({
        "success": True,
        "token": result["token"],
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
            "workspace_slug": user.get("workspace_slug")
        }
    })


@app.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    """登出（客户端应删除 token）"""
    # JWT 是无状态的，服务端不需要做什么
    # 如果需要，可以将 token 加入黑名单（需要额外的存储）
    return jsonify({"success": True, "message": "Logged out"})


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

    result = handle_email_login(email, password)

    if result.get("success"):
        return jsonify(result)
    else:
        return jsonify(result), 401


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
    allowed_fields = ["theme", "language", "notifications_enabled"]
    updates = {f"settings.{k}": v for k, v in data.items() if k in allowed_fields}

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    db.db["users"].update_one(
        {"_id": user_id},
        {"$set": updates}
    )

    return jsonify({"success": True})


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
        logger.info(f"Message: {user_message[:50]}...")

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

    # 保存用户消息
    db.add_message_to_conversation(
        conversation["_id"],
        user_id,
        "user",
        user_message
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

        # 发送消息
        logger.info(f"Sending message: {user_message[:50]}...")
        response = api.send_message(
            user_message,
            session_id=str(conversation["_id"])
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

        # 检查是否有错误
        if "error" in response or not reply:
            error_msg = response.get("error", full_response.get("error", "Unknown error"))
            if not reply and not error_msg:
                error_msg = "Empty response from AnythingLLM"
            return jsonify({
                "success": False,
                "error": error_msg
            }), 500

        # 从 full_response 中获取 sources
        sources = full_response.get("data", {}).get("sources", [])

        # 保存 AI 回复
        db.add_message_to_conversation(
            conversation["_id"],
            user_id,
            "assistant",
            reply,
            sources
        )

        # 更新统计
        db.update_workspace_stats(user_id, message_count_delta=2)

        return jsonify({
            "success": True,
            "reply": reply,
            "sources": sources,
            "conversation_id": str(conversation["_id"])
        })

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


# ==================== 错误处理 ====================

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error"}), 500


# ==================== 启动应用 ====================

if __name__ == "__main__":
    # 初始化数据库连接
    db.connect()

    # 启动服务
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    logger.info(f"Starting SoulLink Backend on port {port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
