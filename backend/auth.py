"""
认证模块 - 支持 Google OAuth 和邮箱密码登录，含邮箱验证码
"""

import os
import re
import random
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from functools import wraps

import jwt
import requests
from flask import request, jsonify, current_app
from bson import ObjectId

from database import db


# ==================== 密码处理 ====================

def hash_password(password: str) -> str:
    """使用 SHA256 + salt 哈希密码"""
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return f"{salt}${password_hash}"


def verify_password(password: str, stored_hash: str) -> bool:
    """验证密码"""
    try:
        salt, password_hash = stored_hash.split("$")
        return hashlib.sha256((password + salt).encode()).hexdigest() == password_hash
    except Exception:
        return False


def validate_email(email: str) -> bool:
    """验证邮箱格式"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def validate_password(password: str) -> Tuple[bool, str]:
    """验证密码强度，返回 (是否有效, 错误信息)"""
    if len(password) < 6:
        return False, "Password must be at least 6 characters"
    if len(password) > 128:
        return False, "Password must be 128 characters or less"
    return True, ""


def generate_verification_code() -> str:
    """生成 6 位数字验证码"""
    return str(random.randint(100000, 999999))


# ==================== 配置 ====================

# Google OAuth 配置
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")

# JWT 配置
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 天


class GoogleOAuth:
    """Google OAuth 处理类"""

    GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
    GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

    @classmethod
    def get_auth_url(cls, state: Optional[str] = None) -> str:
        """生成 Google OAuth 授权 URL"""
        params = {
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent"
        }
        if state:
            params["state"] = state

        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{cls.GOOGLE_AUTH_URL}?{query}"

    @classmethod
    def exchange_code(cls, code: str) -> Optional[Dict[str, Any]]:
        """用授权码换取访问令牌"""
        data = {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": GOOGLE_REDIRECT_URI
        }

        try:
            response = requests.post(cls.GOOGLE_TOKEN_URL, data=data)
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Token exchange failed: {response.text}")
                return None
        except Exception as e:
            print(f"Token exchange error: {e}")
            return None

    @classmethod
    def get_user_info(cls, access_token: str) -> Optional[Dict[str, Any]]:
        """获取用户信息"""
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            response = requests.get(cls.GOOGLE_USERINFO_URL, headers=headers)
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Get user info failed: {response.text}")
                return None
        except Exception as e:
            print(f"Get user info error: {e}")
            return None

    @classmethod
    def verify_id_token(cls, id_token: str) -> Optional[Dict[str, Any]]:
        """
        验证 Google ID Token（用于前端直接传递 token 的场景）
        这是更安全的方式，因为前端可以直接使用 Google Sign-In SDK
        """
        try:
            # 使用 Google 的 tokeninfo 端点验证
            response = requests.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
            )
            if response.status_code == 200:
                data = response.json()
                # 验证 audience（client_id）
                if data.get("aud") == GOOGLE_CLIENT_ID:
                    return data
                else:
                    print(f"Invalid audience: {data.get('aud')}")
                    return None
            else:
                print(f"Token verification failed: {response.text}")
                return None
        except Exception as e:
            print(f"Token verification error: {e}")
            return None


class JWTAuth:
    """JWT 认证处理类"""

    @staticmethod
    def create_token(user_id: str, email: str) -> str:
        """创建 JWT token"""
        payload = {
            "user_id": user_id,
            "email": email,
            "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
            "iat": datetime.utcnow()
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    @staticmethod
    def decode_token(token: str) -> Optional[Dict[str, Any]]:
        """解码并验证 JWT token"""
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            return payload
        except jwt.ExpiredSignatureError:
            print("Token expired")
            return None
        except jwt.InvalidTokenError as e:
            print(f"Invalid token: {e}")
            return None


def login_required(f):
    """登录验证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 从 Header 获取 token
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid authorization header"}), 401

        token = auth_header.split(" ")[1]
        payload = JWTAuth.decode_token(token)

        if not payload:
            return jsonify({"error": "Invalid or expired token"}), 401

        # 获取用户信息
        user_id = payload.get("user_id")
        try:
            user = db.get_user_by_id(ObjectId(user_id))
        except Exception:
            return jsonify({"error": "Invalid user ID"}), 401

        if not user:
            return jsonify({"error": "User not found"}), 401

        # 将用户信息添加到 request context
        request.current_user = user
        request.current_user_id = user["_id"]

        return f(*args, **kwargs)

    return decorated_function


def get_current_user() -> Optional[Dict]:
    """获取当前登录用户（在 login_required 装饰的路由中使用）"""
    return getattr(request, "current_user", None)


def get_current_user_id() -> Optional[ObjectId]:
    """获取当前登录用户 ID"""
    return getattr(request, "current_user_id", None)


# ==================== 用户登录/注册流程 ====================

def handle_google_login(google_user_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    处理 Google 登录
    如果用户存在则登录，不存在则注册
    返回 JWT token 和用户信息
    """
    google_id = google_user_info.get("id")
    email = google_user_info.get("email")
    name = google_user_info.get("name", email.split("@")[0])
    avatar_url = google_user_info.get("picture")

    # 先检查是否有 Google ID 对应的用户
    user = db.get_user_by_google_id(google_id)

    if user:
        # 更新登录时间
        db.update_user_login(user["_id"])
        is_new_user = False
    else:
        # 检查邮箱是否已被使用（可能是邮箱注册的用户）
        existing_user = db.get_user_by_email(email)
        if existing_user:
            # 邮箱已存在，关联 Google 账号
            db.db["users"].update_one(
                {"_id": existing_user["_id"]},
                {"$set": {"google_id": google_id, "avatar_url": avatar_url or existing_user.get("avatar_url")}}
            )
            db.update_user_login(existing_user["_id"])
            user = db.get_user_by_id(existing_user["_id"])
            is_new_user = False
        else:
            # 创建新用户
            user = db.create_user(
                email=email,
                name=name,
                google_id=google_id,
                avatar_url=avatar_url,
                auth_provider="google"
            )
            is_new_user = True

    # 生成 JWT token
    token = JWTAuth.create_token(str(user["_id"]), email)

    return {
        "token": token,
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "avatar_url": user.get("avatar_url"),
            "workspace_slug": user.get("workspace_slug"),
            "auth_provider": user.get("auth_provider", "google"),
            "settings": user.get("settings", {})
        },
        "is_new_user": is_new_user
    }


def handle_email_register(email: str, password: str, name: Optional[str] = None) -> Dict[str, Any]:
    """
    处理邮箱注册
    创建未验证用户，发送验证码邮件
    """
    from email_service import send_verification_email

    # 验证邮箱格式
    if not validate_email(email):
        return {"success": False, "error": "Invalid email format"}

    # 验证密码
    valid, error_msg = validate_password(password)
    if not valid:
        return {"success": False, "error": error_msg}

    user_name = name or email.split("@")[0]
    code = generate_verification_code()

    # 检查邮箱是否已存在
    existing_user = db.get_user_by_email(email)
    if existing_user:
        # 如果已验证，不允许重复注册
        if existing_user.get("email_verified", False):
            return {"success": False, "error": "This email is already registered"}

        # 未验证用户：更新密码/名字，重新发送验证码
        password_hash = hash_password(password)
        db.db["users"].update_one(
            {"_id": existing_user["_id"]},
            {"$set": {
                "name": user_name,
                "password_hash": password_hash,
                "verification_code": code,
                "verification_code_expires": datetime.utcnow() + timedelta(minutes=10),
                "verification_code_sent_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }}
        )
        send_verification_email(email, code, user_name)
        return {
            "success": True,
            "requires_verification": True,
            "email": email,
            "message": "Verification code sent to your email"
        }

    # 创建新用户（未验证）
    password_hash = hash_password(password)
    user = db.create_user(
        email=email,
        name=user_name,
        password_hash=password_hash,
        auth_provider="email"
    )

    # 添加验证码字段
    db.db["users"].update_one(
        {"_id": user["_id"]},
        {"$set": {
            "verification_code": code,
            "verification_code_expires": datetime.utcnow() + timedelta(minutes=10),
            "verification_code_sent_at": datetime.utcnow()
        }}
    )

    # 发送验证邮件
    send_verification_email(email, code, user_name)

    return {
        "success": True,
        "requires_verification": True,
        "email": email,
        "message": "Verification code sent to your email"
    }


def handle_email_login(email: str, password: str) -> Dict[str, Any]:
    """
    处理邮箱登录
    返回 JWT token 和用户信息，或错误信息
    """
    # 查找用户
    user = db.get_user_by_email(email)

    if not user:
        return {"success": False, "error": "Invalid email or password"}

    # 检查是否是邮箱注册的用户
    if not user.get("password_hash"):
        # 这个用户是通过 Google 注册的，没有密码
        return {"success": False, "error": "This account was registered with Google. Please use Google Sign-In."}

    # 验证密码
    if not verify_password(password, user["password_hash"]):
        return {"success": False, "error": "Invalid email or password"}

    # 检查邮箱是否已验证
    if not user.get("email_verified", False):
        from email_service import send_verification_email

        # 自动发送验证码（如果没有有效验证码或已过期）
        code_expires = user.get("verification_code_expires")
        needs_new_code = not code_expires or datetime.utcnow() > code_expires

        if needs_new_code:
            code = generate_verification_code()
            db.db["users"].update_one(
                {"_id": user["_id"]},
                {"$set": {
                    "verification_code": code,
                    "verification_code_expires": datetime.utcnow() + timedelta(minutes=10),
                    "verification_code_sent_at": datetime.utcnow()
                }}
            )
            send_verification_email(email, code, user.get("name", ""))

        return {
            "success": False,
            "error": "Please verify your email before logging in",
            "requires_verification": True,
            "email": email
        }

    # 更新登录时间
    db.update_user_login(user["_id"])

    # 生成 JWT token
    token = JWTAuth.create_token(str(user["_id"]), email)

    return {
        "success": True,
        "token": token,
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "avatar_url": user.get("avatar_url"),
            "workspace_slug": user.get("workspace_slug"),
            "auth_provider": user.get("auth_provider", "email"),
            "settings": user.get("settings", {})
        },
        "is_new_user": False
    }


# ==================== 邮箱验证 ====================

def handle_verify_email(email: str, code: str) -> Dict[str, Any]:
    """验证邮箱验证码，成功后发放 JWT token"""
    user = db.get_user_by_email(email)
    if not user:
        return {"success": False, "error": "User not found"}

    if user.get("email_verified"):
        return {"success": False, "error": "Email already verified"}

    stored_code = user.get("verification_code")
    expires = user.get("verification_code_expires")

    if not stored_code or not expires:
        return {"success": False, "error": "No verification code found. Please request a new one."}

    if datetime.utcnow() > expires:
        return {"success": False, "error": "Verification code expired. Please request a new one."}

    if code != stored_code:
        return {"success": False, "error": "Incorrect verification code"}

    # 验证成功，更新用户状态
    db.db["users"].update_one(
        {"_id": user["_id"]},
        {"$set": {
            "email_verified": True,
            "verification_code": None,
            "verification_code_expires": None,
            "verification_code_sent_at": None,
            "updated_at": datetime.utcnow()
        }}
    )

    # 发放 JWT token
    token = JWTAuth.create_token(str(user["_id"]), email)

    return {
        "success": True,
        "token": token,
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "avatar_url": user.get("avatar_url"),
            "workspace_slug": user.get("workspace_slug"),
            "auth_provider": "email",
            "settings": user.get("settings", {})
        },
        "is_new_user": True
    }


def handle_resend_code(email: str) -> Dict[str, Any]:
    """重新发送验证码（60秒限流）"""
    from email_service import send_verification_email

    user = db.get_user_by_email(email)
    if not user:
        return {"success": False, "error": "User not found"}

    if user.get("email_verified"):
        return {"success": False, "error": "Email already verified"}

    # 60秒限流
    last_sent = user.get("verification_code_sent_at")
    if last_sent and (datetime.utcnow() - last_sent).total_seconds() < 60:
        remaining = 60 - int((datetime.utcnow() - last_sent).total_seconds())
        return {"success": False, "error": f"Please wait {remaining} seconds before requesting a new code"}

    code = generate_verification_code()
    db.db["users"].update_one(
        {"_id": user["_id"]},
        {"$set": {
            "verification_code": code,
            "verification_code_expires": datetime.utcnow() + timedelta(minutes=10),
            "verification_code_sent_at": datetime.utcnow()
        }}
    )

    send_verification_email(email, code, user.get("name", ""))

    return {"success": True, "message": "New verification code sent"}
