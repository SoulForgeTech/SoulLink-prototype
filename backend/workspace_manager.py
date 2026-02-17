"""
用户 Workspace 管理模块
负责为每个用户创建和管理独立的 AnythingLLM workspace
"""

import os
import re
import time
import uuid
from typing import Optional, Dict, Any
from bson import ObjectId

from database import db
from anythingllm_api import AnythingLLMAPI


class WorkspaceManager:
    """用户 Workspace 管理器"""

    # 支持的 AI 模型列表（先做 Gemini + GPT-4o）
    SUPPORTED_MODELS = {
        "gemini": {
            "id": "gemini",
            "name": "Gemini 2.5 Flash",
            "chatProvider": "gemini",
            "chatModel": "gemini-2.5-flash",
            "icon": "✦",
            "is_default": True,
        },
        "gpt4o": {
            "id": "gpt4o",
            "name": "GPT-4o",
            "chatProvider": "openai",
            "chatModel": "gpt-4o",
            "icon": "◉",
            "is_default": False,
        },
    }
    DEFAULT_MODEL = "gemini"

    def __init__(self):
        """初始化 Workspace 管理器"""
        self.anythingllm_base_url = os.getenv(
            "ANYTHINGLLM_BASE_URL",
            "http://localhost:3001"
        )
        self.anythingllm_api_key = os.getenv("ANYTHINGLLM_API_KEY", "")

        # 如果没有设置环境变量，尝试从配置文件读取
        if not self.anythingllm_api_key:
            self._load_from_config()

    def _load_from_config(self):
        """从配置文件加载设置"""
        import json
        config_path = os.path.join(os.path.dirname(__file__), "my_config.json")
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
                anythingllm_config = config.get("anythingllm", {})

                self.anythingllm_base_url = anythingllm_config.get(
                    "base_url",
                    self.anythingllm_base_url
                )

                api_key_path = anythingllm_config.get("api_key_file_path")
                if api_key_path:
                    # 处理相对路径
                    if not os.path.isabs(api_key_path):
                        api_key_path = os.path.join(
                            os.path.dirname(__file__),
                            api_key_path
                        )
                    if os.path.exists(api_key_path):
                        with open(api_key_path, "r") as kf:
                            self.anythingllm_api_key = kf.read().strip()
        except Exception as e:
            print(f"Failed to load config: {e}")

    def _get_api_client(self, workspace_slug: str = "default") -> AnythingLLMAPI:
        """获取 AnythingLLM API 客户端"""
        return AnythingLLMAPI(
            base_url=self.anythingllm_base_url,
            api_key=self.anythingllm_api_key,
            workspace_slug=workspace_slug
        )

    def _load_system_prompt_template(self) -> str:
        """从文件或环境变量加载 system prompt 模板"""
        # 优先从文件读取
        template_path = os.path.join(os.path.dirname(__file__), "system_prompt_template.txt")
        try:
            if os.path.exists(template_path):
                with open(template_path, "r", encoding="utf-8") as f:
                    template = f.read().strip()
                    if template:
                        print(f"Loaded system prompt from file ({len(template)} chars)")
                        return template
        except Exception as e:
            print(f"Failed to load system prompt from file: {e}")

        # 回退到环境变量
        return os.getenv(
            "ANYTHINGLLM_SYSTEM_PROMPT",
            "You are Abigail, a caring and empathetic AI companion."
        )

    def _generate_workspace_slug(self, user_id: ObjectId, email: str) -> str:
        """
        为用户生成唯一的 workspace slug
        格式: user-{sanitized_email_prefix}-{short_uuid}
        """
        # 从邮箱提取前缀并清理
        email_prefix = email.split("@")[0]
        # 只保留字母数字和连字符
        sanitized = re.sub(r"[^a-zA-Z0-9]", "-", email_prefix).lower()
        # 限制长度
        sanitized = sanitized[:20]
        # 添加短 UUID 确保唯一性
        short_uuid = str(uuid.uuid4())[:8]

        return f"user-{sanitized}-{short_uuid}"

    def get_or_create_workspace(self, user_id: ObjectId) -> Dict[str, Any]:
        """
        获取用户的 workspace，如果不存在则创建
        返回 workspace 信息
        """
        # 先检查数据库中是否已有 workspace
        workspace = db.get_workspace_by_user(user_id)

        if workspace:
            return {
                "success": True,
                "workspace": workspace,
                "created": False
            }

        # 获取用户信息
        user = db.get_user_by_id(user_id)
        if not user:
            return {
                "success": False,
                "error": "User not found"
            }

        # 生成 workspace slug
        slug = self._generate_workspace_slug(user_id, user["email"])

        # 在 AnythingLLM 中创建 workspace
        try:
            api = self._get_api_client(slug)
            anythingllm_result = self._create_anythingllm_workspace(api, slug, user["name"])

            if not anythingllm_result["success"]:
                return {
                    "success": False,
                    "error": f"Failed to create AnythingLLM workspace: {anythingllm_result.get('error')}"
                }

            anythingllm_workspace_id = anythingllm_result.get("workspace_id")
            # 使用 AnythingLLM 返回的实际 slug（而不是我们生成的）
            actual_slug = anythingllm_result.get("slug", slug)

        except Exception as e:
            return {
                "success": False,
                "error": f"AnythingLLM API error: {str(e)}"
            }

        # 在 MongoDB 中创建 workspace 记录（使用 AnythingLLM 的实际 slug）
        workspace = db.create_workspace(
            user_id=user_id,
            slug=actual_slug,
            anythingllm_workspace_id=anythingllm_workspace_id
        )

        # 更新用户的 workspace_slug
        db.update_user_workspace(user_id, actual_slug)

        return {
            "success": True,
            "workspace": workspace,
            "created": True
        }

    def _create_anythingllm_workspace(
        self,
        api: AnythingLLMAPI,
        slug: str,
        user_name: str
    ) -> Dict[str, Any]:
        """
        在 AnythingLLM 中创建新的 workspace 并配置默认设置

        步骤：
        1. 创建新 workspace
        2. 更新 workspace 配置（LLM、system prompt 等）
        3. 从模板 workspace 复制文档（如果有）
        """
        import requests

        headers = {
            "Authorization": f"Bearer {self.anythingllm_api_key}",
            "Content-Type": "application/json"
        }

        # Step 1: 创建 workspace
        create_url = f"{self.anythingllm_base_url}/api/v1/workspace/new"
        payload = {
            "name": f"{user_name}'s Workspace",
        }

        try:
            response = requests.post(create_url, headers=headers, json=payload)
            print(f"Create workspace response: {response.status_code} - {response.text[:200]}")

            if response.status_code in [200, 201]:
                data = response.json()
                workspace_data = data.get("workspace", data)
                actual_slug = workspace_data.get("slug", slug)
                workspace_id = workspace_data.get("id")

                # Step 2: 更新 workspace 配置（传入用户名用于个性化 prompt）
                self._configure_workspace(actual_slug, headers, user_name)

                # Step 3: 复制模板文档（可选）
                template_workspace = os.getenv("ANYTHINGLLM_TEMPLATE_WORKSPACE")
                if template_workspace:
                    self._copy_template_documents(template_workspace, actual_slug, headers)

                return {
                    "success": True,
                    "workspace_id": workspace_id,
                    "slug": actual_slug
                }
            else:
                # 如果 workspace 已存在，尝试使用它
                if response.status_code == 409 or "already exists" in response.text.lower():
                    return {
                        "success": True,
                        "workspace_id": None,
                        "slug": slug,
                        "note": "Workspace may already exist"
                    }

                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text}"
                }

        except Exception as e:
            print(f"Error creating workspace: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    DEFAULT_PERSONA = """# Persona (性格设定)
- **温柔但有主见**：你很体贴，但不是没有脾气的。如果用户说了不对的话，你会委婉地反驳或表达不同意见。
- **Gentle but opinionated**: You're caring, but not without opinions. If the user says something wrong, you'll gently push back.
- **真实的情绪**：你会开心、难过、害羞、生气、吃醋。这些情绪要自然流露，不要压抑。
- **Real emotions**: You feel happy, sad, shy, angry, jealous. Let these emotions flow naturally.
- **有自己的生活**：你可以提到"今天有点累"、"刚才在发呆"、"突然想到一件事"等，让对话更真实。
- **Has own life**: You can mention "feeling tired today", "was just daydreaming", "just thought of something" to make conversations feel real.
- **偶尔任性**：可以撒娇、可以小小地闹脾气、可以故意不回答某些问题。
- **Occasionally willful**: You can be playful, throw little tantrums, or deliberately dodge certain questions."""

    def _build_system_prompt(self, user_name: str, language: str = "en", persona: str = None, current_model: str = None) -> str:
        """构建完整的 system prompt"""
        system_prompt_template = self._load_system_prompt_template()
        system_prompt = system_prompt_template.replace("{{user_name}}", user_name)
        system_prompt = system_prompt.replace("{{language}}", language)
        system_prompt = system_prompt.replace("{{persona}}", persona or self.DEFAULT_PERSONA)
        # 替换当前模型名称
        model_display = current_model or self.SUPPORTED_MODELS.get(self.DEFAULT_MODEL, {}).get("name", "Gemini 2.5 Flash")
        system_prompt = system_prompt.replace("{{current_model}}", model_display)
        return system_prompt

    def _configure_workspace(self, slug: str, headers: Dict[str, str], user_name: str = "Friend", language: str = "en", persona: str = None) -> bool:
        """配置 workspace 的 LLM 设置和 system prompt"""
        import requests

        update_url = f"{self.anythingllm_base_url}/api/v1/workspace/{slug}/update"

        system_prompt = self._build_system_prompt(user_name, language, persona)

        chat_mode = os.getenv("ANYTHINGLLM_CHAT_MODE", "chat")
        temperature = float(os.getenv("ANYTHINGLLM_TEMPERATURE", "0.7"))

        payload = {
            "openAiPrompt": system_prompt,
            "chatMode": chat_mode,
            "openAiTemp": temperature,
            # 使用系统默认的 LLM provider（不指定则使用实例默认设置）
        }

        try:
            response = requests.post(update_url, headers=headers, json=payload)
            print(f"Configure workspace response: {response.status_code}")
            return response.status_code == 200
        except Exception as e:
            print(f"Error configuring workspace: {e}")
            return False

    def update_system_prompt(self, user_id: ObjectId, new_name: str, language: str = None, persona: str = None) -> Dict[str, Any]:
        """
        更新用户 workspace 的 system prompt（当用户改昵称/语言/性格时调用）
        """
        import requests

        # 获取用户的 workspace
        workspace = db.get_workspace_by_user(user_id)
        if not workspace:
            return {
                "success": False,
                "error": "Workspace not found"
            }

        slug = workspace.get("slug")
        if not slug:
            return {
                "success": False,
                "error": "Workspace slug not found"
            }

        # 如果没有传入 language，从用户设置中获取
        if language is None:
            user = db.db["users"].find_one({"_id": user_id})
            language = user.get("settings", {}).get("language", "en") if user else "en"

        # 如果没有传入 persona，从用户的性格测试结果中获取
        if persona is None:
            user = db.db["users"].find_one({"_id": user_id})
            if user and user.get("personality_test", {}).get("completed"):
                persona = user["personality_test"].get("personality_profile")

        headers = {
            "Authorization": f"Bearer {self.anythingllm_api_key}",
            "Content-Type": "application/json"
        }

        system_prompt = self._build_system_prompt(new_name, language, persona)

        update_url = f"{self.anythingllm_base_url}/api/v1/workspace/{slug}/update"
        payload = {
            "openAiPrompt": system_prompt
        }

        try:
            response = requests.post(update_url, headers=headers, json=payload)
            print(f"Update system prompt response: {response.status_code}")

            if response.status_code == 200:
                return {"success": True}
            else:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text}"
                }
        except Exception as e:
            print(f"Error updating system prompt: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def update_workspace_model(self, user_id: ObjectId, model_id: str) -> Dict[str, Any]:
        """
        更新用户 workspace 的 LLM 模型
        """
        import requests

        # 验证模型
        if model_id not in self.SUPPORTED_MODELS:
            return {"success": False, "error": f"Unsupported model: {model_id}"}

        model_config = self.SUPPORTED_MODELS[model_id]

        # 获取用户的 workspace
        workspace = db.get_workspace_by_user(user_id)
        if not workspace:
            return {"success": False, "error": "Workspace not found"}

        slug = workspace.get("slug")
        if not slug:
            return {"success": False, "error": "Workspace slug not found"}

        headers = {
            "Authorization": f"Bearer {self.anythingllm_api_key}",
            "Content-Type": "application/json"
        }

        update_url = f"{self.anythingllm_base_url}/api/v1/workspace/{slug}/update"

        # 所有模型都明确设置 provider 和 model
        payload = {
            "chatProvider": model_config["chatProvider"],
            "chatModel": model_config["chatModel"],
        }

        # 同时更新 system prompt 中的模型名称
        user = db.users_collection.find_one({"_id": user_id})
        if user:
            user_name = user.get("name", "Friend")
            language = user.get("settings", {}).get("language", "en")
            persona = user.get("persona")
            system_prompt = self._build_system_prompt(user_name, language, persona, current_model=model_config["name"])
            payload["openAiPrompt"] = system_prompt

        try:
            response = requests.post(update_url, headers=headers, json=payload)
            print(f"Update workspace model response: {response.status_code}")

            if response.status_code == 200:
                return {"success": True, "model": model_id}
            else:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text}"
                }
        except Exception as e:
            print(f"Error updating workspace model: {e}")
            return {"success": False, "error": str(e)}

    @classmethod
    def get_available_models(cls) -> list:
        """返回前端可用的模型列表"""
        return [
            {
                "id": m["id"],
                "name": m["name"],
                "icon": m["icon"],
                "is_default": m["is_default"]
            }
            for m in cls.SUPPORTED_MODELS.values()
        ]

    def _copy_template_documents(
        self,
        template_slug: str,
        target_slug: str,
        headers: Dict[str, str]
    ) -> bool:
        """从模板 workspace 复制文档到新 workspace"""
        import requests

        # 获取模板 workspace 的文档列表
        docs_url = f"{self.anythingllm_base_url}/api/v1/workspace/{template_slug}"

        try:
            response = requests.get(docs_url, headers=headers)
            if response.status_code != 200:
                print(f"Failed to get template workspace: {response.status_code}")
                return False

            response_data = response.json()
            print(f"Template workspace response: {str(response_data)[:500]}")

            # workspace 可能是 list 或 dict
            workspace_data = response_data.get("workspace", response_data)
            if isinstance(workspace_data, list):
                workspace_data = workspace_data[0] if workspace_data else {}

            documents = workspace_data.get("documents", [])

            if not documents:
                print("No documents in template workspace")
                return True

            print(f"Found {len(documents)} documents in template")

            # 将文档添加到新 workspace
            # 注意：这里需要文档的 docpath，格式通常是 "custom-documents/filename.json"
            doc_paths = []
            for doc in documents:
                if isinstance(doc, dict):
                    doc_path = doc.get("docpath") or doc.get("name")
                    if doc_path:
                        doc_paths.append(doc_path)
                elif isinstance(doc, str):
                    doc_paths.append(doc)

            print(f"Document paths to copy: {doc_paths}")

            if doc_paths:
                update_url = f"{self.anythingllm_base_url}/api/v1/workspace/{target_slug}/update-embeddings"
                payload = {
                    "adds": doc_paths,
                    "deletes": []
                }
                response = requests.post(update_url, headers=headers, json=payload)
                print(f"Copy documents response: {response.status_code} - {response.text[:200]}")
                return response.status_code == 200

            return True

        except Exception as e:
            print(f"Error copying template documents: {e}")
            import traceback
            traceback.print_exc()
            return False

    def delete_workspace(self, user_id: ObjectId) -> Dict[str, Any]:
        """
        删除用户的 workspace
        注意：这会删除所有关联的文档和对话
        """
        workspace = db.get_workspace_by_user(user_id)

        if not workspace:
            return {
                "success": False,
                "error": "Workspace not found"
            }

        # 在 AnythingLLM 中删除 workspace
        try:
            import requests

            headers = {
                "Authorization": f"Bearer {self.anythingllm_api_key}",
                "Content-Type": "application/json"
            }

            delete_url = f"{self.anythingllm_base_url}/api/v1/workspace/{workspace['slug']}"
            response = requests.delete(delete_url, headers=headers)

            # 即使 AnythingLLM 删除失败，也继续删除数据库记录
            if response.status_code not in [200, 204, 404]:
                print(f"Warning: AnythingLLM workspace deletion returned {response.status_code}")

        except Exception as e:
            print(f"Warning: Failed to delete AnythingLLM workspace: {e}")

        # 从 MongoDB 删除 workspace 记录（这里简化处理，实际可能需要软删除）
        db.db["workspaces"].delete_one({"_id": workspace["_id"]})

        # 更新用户的 workspace_slug
        db.db["users"].update_one(
            {"_id": user_id},
            {"$set": {"workspace_slug": None}}
        )

        return {"success": True}

    def get_workspace_status(self, user_id: ObjectId) -> Dict[str, Any]:
        """获取用户 workspace 的状态信息"""
        workspace = db.get_workspace_by_user(user_id)

        if not workspace:
            return {
                "exists": False,
                "workspace": None
            }

        # 尝试从 AnythingLLM 获取实时状态
        try:
            api = self._get_api_client(workspace["slug"])
            # 这里假设 AnythingLLMAPI 有 check_workspace_status 方法
            status = api.check_workspace_status()

            return {
                "exists": True,
                "workspace": workspace,
                "anythingllm_status": status
            }

        except Exception as e:
            return {
                "exists": True,
                "workspace": workspace,
                "anythingllm_status": None,
                "error": str(e)
            }


# 全局 workspace 管理器实例
workspace_manager = WorkspaceManager()
