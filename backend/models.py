"""
MongoDB 数据模型定义
用于 SoulLink 多用户系统
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from bson import ObjectId


class UserModel:
    """用户数据模型"""

    collection_name = "users"

    @staticmethod
    def create_user(
        email: str,
        name: str,
        password_hash: Optional[str] = None,
        google_id: Optional[str] = None,
        avatar_url: Optional[str] = None,
        auth_provider: str = "email"  # "email" 或 "google"
    ) -> Dict[str, Any]:
        """创建新用户文档"""
        doc = {
            "email": email,
            "name": name,
            "password_hash": password_hash,  # 邮箱注册用户的密码哈希
            "auth_provider": auth_provider,  # 认证方式
            "avatar_url": avatar_url,
            "email_verified": auth_provider == "google",  # Google 用户默认已验证
            "workspace_slug": None,  # 将在首次使用时创建
            "personality_test": None,  # 性格测试结果（完成后填充）
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "last_login": datetime.utcnow(),
            "settings": {
                "theme": "dark",
                "language": "zh-CN",
                "notifications_enabled": True,
                "model": "gemini"
            }
        }
        # 只在有值时才加 google_id，避免 sparse unique 索引冲突
        if google_id is not None:
            doc["google_id"] = google_id
        return doc

    @staticmethod
    def get_indexes() -> List[Dict]:
        """返回需要创建的索引"""
        return [
            {"keys": [("google_id", 1)], "unique": True, "sparse": True, "name": "google_id_sparse_unique"},
            {"keys": [("email", 1)], "unique": True},
            {"keys": [("workspace_slug", 1)], "sparse": True}
        ]


class ConversationModel:
    """对话历史数据模型"""

    collection_name = "conversations"

    @staticmethod
    def create_conversation(
        user_id: ObjectId,
        title: Optional[str] = None
    ) -> Dict[str, Any]:
        """创建新对话"""
        return {
            "user_id": user_id,
            "title": title or "新对话",
            "messages": [],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "is_active": True,
            "metadata": {
                "total_messages": 0,
                "last_message_at": None
            }
        }

    @staticmethod
    def create_message(
        role: str,  # "user" or "assistant"
        content: str,
        sources: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """创建消息对象"""
        return {
            "id": str(ObjectId()),
            "role": role,
            "content": content,
            "sources": sources or [],
            "timestamp": datetime.utcnow()
        }

    @staticmethod
    def get_indexes() -> List[Dict]:
        """返回需要创建的索引"""
        return [
            {"keys": [("user_id", 1)]},
            {"keys": [("user_id", 1), ("updated_at", -1)]},
            {"keys": [("user_id", 1), ("is_active", 1)]}
        ]


class RefreshTokenModel:
    """Refresh Token 数据模型 — 用于持久登录（Trust Device）"""

    collection_name = "refresh_tokens"

    @staticmethod
    def create_refresh_token(
        user_id: ObjectId,
        token: str,
        expires_at: datetime,
        user_agent: str = "",
    ) -> Dict[str, Any]:
        return {
            "user_id": user_id,
            "token": token,
            "expires_at": expires_at,
            "user_agent": user_agent,
            "created_at": datetime.utcnow(),
            "last_used_at": datetime.utcnow(),
        }

    @staticmethod
    def get_indexes() -> List[Dict]:
        return [
            {"keys": [("token", 1)], "unique": True},
            {"keys": [("user_id", 1)]},
            {"keys": [("expires_at", 1)], "expireAfterSeconds": 0},  # MongoDB TTL 自动清理过期 token
        ]


class WorkspaceModel:
    """Workspace 配置数据模型"""

    collection_name = "workspaces"

    @staticmethod
    def create_workspace(
        user_id: ObjectId,
        slug: str,
        anythingllm_workspace_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """创建用户专属 workspace 配置"""
        return {
            "user_id": user_id,
            "slug": slug,
            "anythingllm_workspace_id": anythingllm_workspace_id,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "documents": [],  # 记录上传的文档
            "settings": {
                "model": "default",
                "temperature": 0.7,
                "system_prompt": None
            },
            "stats": {
                "total_messages": 0,
                "total_documents": 0
            }
        }

    @staticmethod
    def get_indexes() -> List[Dict]:
        """返回需要创建的索引"""
        return [
            {"keys": [("user_id", 1)], "unique": True},
            {"keys": [("slug", 1)], "unique": True}
        ]


# 集合初始化辅助函数
def get_all_models():
    """返回所有模型类"""
    return [UserModel, ConversationModel, RefreshTokenModel, WorkspaceModel]


def init_indexes(db):
    """初始化所有集合的索引"""
    for model in get_all_models():
        collection = db[model.collection_name]
        for index_spec in model.get_indexes():
            keys = index_spec.pop("keys")
            collection.create_index(keys, **index_spec)
