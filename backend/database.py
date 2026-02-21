"""
MongoDB 数据库连接和操作模块
"""

import os
from typing import Optional, Dict, Any, List
from datetime import datetime
from bson import ObjectId
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.collection import Collection

from models import UserModel, ConversationModel, WorkspaceModel, init_indexes


class MongoDB:
    """MongoDB 数据库管理类"""

    _instance: Optional['MongoDB'] = None
    _client: Optional[MongoClient] = None
    _db: Optional[Database] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def connect(self, uri: Optional[str] = None) -> Database:
        """连接到 MongoDB"""
        if self._db is not None:
            return self._db

        uri = uri or os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        db_name = os.getenv("MONGODB_DB_NAME", "soullink")

        self._client = MongoClient(uri)
        self._db = self._client[db_name]

        # 初始化索引
        init_indexes(self._db)

        print(f"Connected to MongoDB: {db_name}")
        return self._db

    @property
    def db(self) -> Database:
        """获取数据库实例"""
        if self._db is None:
            self.connect()
        return self._db

    def close(self):
        """关闭数据库连接"""
        if self._client:
            self._client.close()
            self._client = None
            self._db = None

    # ==================== 用户操作 ====================

    def get_user_by_google_id(self, google_id: str) -> Optional[Dict]:
        """通过 Google ID 获取用户"""
        return self.db[UserModel.collection_name].find_one({"google_id": google_id})

    def get_user_by_email(self, email: str) -> Optional[Dict]:
        """通过邮箱获取用户"""
        return self.db[UserModel.collection_name].find_one({"email": email})

    def get_user_by_id(self, user_id: ObjectId) -> Optional[Dict]:
        """通过 ID 获取用户"""
        return self.db[UserModel.collection_name].find_one({"_id": user_id})

    def create_user(
        self,
        email: str,
        name: str,
        password_hash: Optional[str] = None,
        google_id: Optional[str] = None,
        avatar_url: Optional[str] = None,
        auth_provider: str = "email"
    ) -> Dict:
        """创建新用户"""
        user_doc = UserModel.create_user(
            email=email,
            name=name,
            password_hash=password_hash,
            google_id=google_id,
            avatar_url=avatar_url,
            auth_provider=auth_provider
        )
        result = self.db[UserModel.collection_name].insert_one(user_doc)
        user_doc["_id"] = result.inserted_id
        return user_doc

    def update_user_password(self, user_id: ObjectId, password_hash: str) -> bool:
        """更新用户密码"""
        result = self.db[UserModel.collection_name].update_one(
            {"_id": user_id},
            {"$set": {"password_hash": password_hash, "updated_at": datetime.utcnow()}}
        )
        return result.modified_count > 0

    def update_user_login(self, user_id: ObjectId) -> bool:
        """更新用户登录时间"""
        result = self.db[UserModel.collection_name].update_one(
            {"_id": user_id},
            {"$set": {"last_login": datetime.utcnow(), "updated_at": datetime.utcnow()}}
        )
        return result.modified_count > 0

    def update_user_workspace(self, user_id: ObjectId, workspace_slug: str) -> bool:
        """更新用户的 workspace slug"""
        result = self.db[UserModel.collection_name].update_one(
            {"_id": user_id},
            {"$set": {"workspace_slug": workspace_slug, "updated_at": datetime.utcnow()}}
        )
        return result.modified_count > 0

    # ==================== Workspace 操作 ====================

    def get_workspace_by_user(self, user_id: ObjectId) -> Optional[Dict]:
        """获取用户的 workspace"""
        return self.db[WorkspaceModel.collection_name].find_one({"user_id": user_id})

    def get_workspace_by_slug(self, slug: str) -> Optional[Dict]:
        """通过 slug 获取 workspace"""
        return self.db[WorkspaceModel.collection_name].find_one({"slug": slug})

    def create_workspace(
        self,
        user_id: ObjectId,
        slug: str,
        anythingllm_workspace_id: Optional[str] = None
    ) -> Dict:
        """创建用户 workspace"""
        workspace_doc = WorkspaceModel.create_workspace(user_id, slug, anythingllm_workspace_id)
        result = self.db[WorkspaceModel.collection_name].insert_one(workspace_doc)
        workspace_doc["_id"] = result.inserted_id
        return workspace_doc

    def update_workspace_stats(
        self,
        user_id: ObjectId,
        message_count_delta: int = 0,
        document_count_delta: int = 0
    ) -> bool:
        """更新 workspace 统计信息"""
        update = {"$set": {"updated_at": datetime.utcnow()}}
        if message_count_delta:
            update["$inc"] = {"stats.total_messages": message_count_delta}
        if document_count_delta:
            if "$inc" not in update:
                update["$inc"] = {}
            update["$inc"]["stats.total_documents"] = document_count_delta

        result = self.db[WorkspaceModel.collection_name].update_one(
            {"user_id": user_id},
            update
        )
        return result.modified_count > 0

    # ==================== 对话操作 ====================

    def create_conversation(
        self,
        user_id: ObjectId,
        title: Optional[str] = None
    ) -> Dict:
        """创建新对话"""
        conv_doc = ConversationModel.create_conversation(user_id, title)
        result = self.db[ConversationModel.collection_name].insert_one(conv_doc)
        conv_doc["_id"] = result.inserted_id
        return conv_doc

    def get_conversation(self, conv_id: ObjectId, user_id: ObjectId) -> Optional[Dict]:
        """获取特定对话（确保属于该用户）"""
        return self.db[ConversationModel.collection_name].find_one({
            "_id": conv_id,
            "user_id": user_id
        })

    def get_user_conversations(
        self,
        user_id: ObjectId,
        limit: int = 20,
        skip: int = 0
    ) -> List[Dict]:
        """获取用户的对话列表"""
        cursor = self.db[ConversationModel.collection_name].find(
            {"user_id": user_id, "is_active": True},
            {"messages": {"$slice": -1}}  # 只返回最后一条消息用于预览
        ).sort("updated_at", -1).skip(skip).limit(limit)
        return list(cursor)

    def add_message_to_conversation(
        self,
        conv_id: ObjectId,
        user_id: ObjectId,
        role: str,
        content: str,
        sources: Optional[List[Dict]] = None,
        thinking: Optional[str] = None,
        attachments: Optional[List[Dict]] = None
    ) -> bool:
        """向对话添加消息"""
        message = ConversationModel.create_message(role, content, sources, thinking=thinking, attachments=attachments)
        result = self.db[ConversationModel.collection_name].update_one(
            {"_id": conv_id, "user_id": user_id},
            {
                "$push": {"messages": message},
                "$set": {
                    "updated_at": datetime.utcnow(),
                    "metadata.last_message_at": datetime.utcnow()
                },
                "$inc": {"metadata.total_messages": 1}
            }
        )
        return result.modified_count > 0

    def get_active_conversation(self, user_id: ObjectId) -> Optional[Dict]:
        """获取用户最近的活跃对话，如果没有则创建新的"""
        conv = self.db[ConversationModel.collection_name].find_one(
            {"user_id": user_id, "is_active": True},
            sort=[("updated_at", -1)]
        )
        if not conv:
            conv = self.create_conversation(user_id)
        return conv

    def delete_conversation(self, conv_id: ObjectId, user_id: ObjectId) -> bool:
        """软删除对话"""
        result = self.db[ConversationModel.collection_name].update_one(
            {"_id": conv_id, "user_id": user_id},
            {"$set": {"is_active": False, "updated_at": datetime.utcnow()}}
        )
        return result.modified_count > 0


# 全局数据库实例
db = MongoDB()
