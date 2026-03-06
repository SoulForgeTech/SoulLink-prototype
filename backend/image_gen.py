"""
SoulLink Image Generation — xAI grok-imagine-image + fal.ai Flux fallback
AI 在回复中插入 [IMAGE: description] 标记，后端检测并生成图片
优先用 xAI，失败时 fallback 到 fal.ai Flux Uncensored
生成后上传到 Cloudinary 持久化存储
"""

import os
import re
import base64
import logging
import requests
import cloudinary
import cloudinary.uploader
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ==================== xAI 配置 ====================
XAI_API_KEY = os.getenv("XAI_API_KEY", "")
XAI_IMAGE_URL = "https://api.x.ai/v1/images/generations"

# ==================== fal.ai 配置 ====================
FAL_KEY = os.getenv("FAL_KEY", "")
FAL_API_URL = "https://fal.run/fal-ai/flux-lora"
FAL_LORA_PATH = "https://huggingface.co/Ryouko65777/Flux-Uncensored-V2/resolve/main/lora.safetensors"

DAILY_LIMIT = 20  # 每用户每天限额

# 默认通用外观 — 没有导入自定义角色时使用
DEFAULT_APPEARANCE = (
    "Anime art style, beautiful young woman with long flowing dark hair, "
    "bright expressive eyes, fair skin, slender build, wearing a stylish casual outfit "
    "with soft pastel colors, gentle and warm aesthetic"
)

# Cloudinary 配置
_cloudinary_configured = False
def _ensure_cloudinary():
    global _cloudinary_configured
    if not _cloudinary_configured:
        cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
        api_key = os.getenv("CLOUDINARY_API_KEY", "")
        api_secret = os.getenv("CLOUDINARY_API_SECRET", "")
        if cloud_name and api_key and api_secret:
            cloudinary.config(
                cloud_name=cloud_name,
                api_key=api_key,
                api_secret=api_secret,
                secure=True
            )
            _cloudinary_configured = True
            logger.info("[IMAGE_GEN] Cloudinary configured successfully")
        else:
            logger.warning("[IMAGE_GEN] Cloudinary env vars not set, images won't persist")


def upload_to_cloudinary(b64_data: str, user_id: str) -> str:
    """
    上传 base64 图片到 Cloudinary。
    返回永久 URL 或空字符串（失败时）。
    """
    _ensure_cloudinary()
    if not _cloudinary_configured:
        return ""
    try:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        public_id = f"soullink/chat_images/{user_id}/{timestamp}"
        result = cloudinary.uploader.upload(
            f"data:image/png;base64,{b64_data}",
            public_id=public_id,
            resource_type="image",
            overwrite=True,
        )
        url = result.get("secure_url", "")
        if url:
            logger.info(f"[IMAGE_GEN] Uploaded to Cloudinary: {url[:80]}")
        return url
    except Exception as e:
        logger.error(f"[IMAGE_GEN] Cloudinary upload failed: {e}")
        return ""


def extract_image_markers(reply: str):
    """
    从 AI 回复中提取 [IMAGE: ...] 标记。
    返回 (cleaned_reply, prompts_list)
    只提取第一个标记（控制成本）。
    """
    pattern = r'\[IMAGE:\s*(.+?)\]'
    match = re.search(pattern, reply, re.DOTALL)
    if not match:
        return reply, []

    prompt = match.group(1).strip()
    # 从回复中移除标记（包括前后可能的空白行）
    cleaned = re.sub(r'\s*\[IMAGE:\s*.+?\]', '', reply, count=1, flags=re.DOTALL).strip()
    return cleaned, [prompt]


def _extract_appearance_from_persona(persona: str) -> str:
    """
    用 Gemini 从 persona 文本中提取角色的视觉外观描述。
    返回一段英文外观描述（用于图片生成 prompt 前缀）。
    """
    try:
        from memory_engine import _call_gemini
        extraction_prompt = (
            "Extract a concise visual appearance description from this character persona for AI image generation. "
            "Output ONLY the appearance in English, max 100 words. MUST include:\n"
            "1. Art style — if the character is from anime/game/manga, state 'Anime art style' and the source (e.g. 'Genshin Impact aesthetic'). If realistic, state 'Realistic/photographic style'.\n"
            "2. If the character is based on a REAL person/celebrity, START with 'Resembling [real name]' (e.g. 'Resembling Cai Xukun, male idol...'). This is critical for accurate likeness.\n"
            "3. Gender, body type, skin tone\n"
            "4. Hair: color, style, distinctive features\n"
            "5. Eyes: color, distinctive features\n"
            "6. Typical outfit & accessories\n"
            "If details are missing, infer from context. Output a single descriptive paragraph, no bullet points.\n\n"
            f"Character persona:\n{persona[:2000]}"
        )
        result = _call_gemini(extraction_prompt)
        if result and len(result) > 10:
            logger.info(f"[IMAGE_GEN] Extracted appearance: {result[:100]}")
            return result
    except Exception as e:
        logger.warning(f"[IMAGE_GEN] Failed to extract appearance: {e}")
    return ""


def get_appearance_prefix(user_id, db) -> str:
    """
    获取用户角色的外观描述前缀。
    优先使用缓存（settings.image_appearance），否则从 persona 提取并缓存。
    如果有原始角色名（如明星名），确保 appearance 包含真名以便图片匹配。
    """
    user = db.db["users"].find_one({"_id": user_id})
    if not user:
        return ""

    settings = user.get("settings", {})

    # 检查缓存
    cached = settings.get("image_appearance")
    if cached:
        # 兼容旧数据：如果缓存中没有 "Resembling" 但有原始角色名（真人），尝试注入
        source_name = settings.get("custom_persona_name") or ""
        if source_name and "Resembling" not in cached:
            # 简单检查：如果角色名看起来是真人名（非虚构），补充真名引用
            # 真人名通常不含"酱/ちゃん/sama/桑"等虚构角色后缀
            # 这里我们保守处理：只要 cached 中没有 source_name，就补上
            if source_name.lower() not in cached.lower():
                cached = f"Resembling {source_name}. {cached}"
                # 更新缓存
                db.db["users"].update_one(
                    {"_id": user_id},
                    {"$set": {"settings.image_appearance": cached}}
                )
                logger.info(f"[IMAGE_GEN] Injected source name '{source_name}' into appearance for user {user_id}")
        return cached

    # 从 persona 提取
    persona = settings.get("custom_persona") or ""
    if not persona:
        pt = user.get("personality_test") or {}
        persona = pt.get("personality_profile") or ""

    if not persona:
        # 没有任何 persona，使用默认通用外观
        logger.info(f"[IMAGE_GEN] No persona for user {user_id}, using default appearance")
        return DEFAULT_APPEARANCE

    appearance = _extract_appearance_from_persona(persona)
    if appearance:
        # 如果有原始角色名但提取结果没包含，补上
        source_name = settings.get("custom_persona_name") or ""
        if source_name and "Resembling" not in appearance and source_name.lower() not in appearance.lower():
            appearance = f"Resembling {source_name}. {appearance}"

        # 缓存到 settings
        db.db["users"].update_one(
            {"_id": user_id},
            {"$set": {"settings.image_appearance": appearance}}
        )
        logger.info(f"[IMAGE_GEN] Cached appearance for user {user_id}")
        return appearance

    # 提取失败也用默认
    return DEFAULT_APPEARANCE


def _strip_real_names(prompt: str) -> str:
    """
    从 prompt 中移除真人名字，替换为通用描述。
    避免图片生成 API 因真人名字拒绝 NSFW 内容，也避免生成真人 likeness 的法律风险。
    """
    # 常见真人名字映射（出现在 appearance prefix 中的）
    name_replacements = {
        r'\bLiu Yifei\b': 'a beautiful Chinese woman',
        r'\b刘亦菲\b': 'a beautiful Chinese woman',
        r'\bYang Mi\b': 'a beautiful Chinese woman',
        r'\b杨幂\b': 'a beautiful Chinese woman',
        r'\bDilraba\b': 'a beautiful woman',
        r'\b迪丽热巴\b': 'a beautiful woman',
        r'\bJu Jingyi\b': 'a beautiful Chinese woman',
        r'\b鞠婧祎\b': 'a beautiful Chinese woman',
        r'\bTaylor Swift\b': 'a beautiful woman',
        r'\bScarlett Johansson\b': 'a beautiful woman',
        r'\bEmma Watson\b': 'a beautiful woman',
    }
    result = prompt
    for pattern, replacement in name_replacements.items():
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def _generate_image_xai(prompt: str) -> dict:
    """
    调用 xAI grok-imagine-image API 生成图片。
    返回 {"b64": base64_string, "prompt": prompt} 或 None。
    """
    if not XAI_API_KEY:
        return None

    try:
        resp = requests.post(
            XAI_IMAGE_URL,
            headers={
                "Authorization": f"Bearer {XAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "grok-imagine-image",
                "prompt": prompt,
                "n": 1,
                "response_format": "b64_json",
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        b64 = data["data"][0]["b64_json"]
        logger.info(f"[IMAGE_GEN] xAI generated image for prompt: {prompt[:80]}... ({len(b64)} chars b64)")
        return {"b64": b64, "prompt": prompt}
    except requests.exceptions.Timeout:
        logger.warning(f"[IMAGE_GEN] xAI timeout for: {prompt[:60]}")
    except Exception as e:
        logger.warning(f"[IMAGE_GEN] xAI failed: {e}")
    return None


def _generate_image_fal(prompt: str) -> dict:
    """
    调用 fal.ai Flux LoRA (Uncensored V2) 生成图片。
    返回 {"b64": base64_string, "prompt": prompt} 或 None。
    """
    if not FAL_KEY:
        logger.warning("[IMAGE_GEN] FAL_KEY not configured, cannot fallback")
        return None

    try:
        # 为 fal.ai 去掉真人名字
        clean_prompt = _strip_real_names(prompt)

        resp = requests.post(
            FAL_API_URL,
            headers={
                "Authorization": f"Key {FAL_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "prompt": clean_prompt,
                "image_size": "square_hd",
                "num_inference_steps": 28,
                "guidance_scale": 3.5,
                "num_images": 1,
                "output_format": "jpeg",
                "enable_safety_checker": False,
                "loras": [
                    {
                        "path": FAL_LORA_PATH,
                        "scale": 1.0,
                    }
                ],
            },
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()
        image_url = data["images"][0]["url"]
        logger.info(f"[IMAGE_GEN] fal.ai generated image: {image_url[:80]}")

        # 下载图片转 base64（保持与现有流程一致）
        img_resp = requests.get(image_url, timeout=30)
        img_resp.raise_for_status()
        b64 = base64.b64encode(img_resp.content).decode("utf-8")
        logger.info(f"[IMAGE_GEN] fal.ai image downloaded and encoded ({len(b64)} chars b64)")

        return {"b64": b64, "prompt": prompt}
    except requests.exceptions.Timeout:
        logger.warning(f"[IMAGE_GEN] fal.ai timeout for: {prompt[:60]}")
    except Exception as e:
        logger.error(f"[IMAGE_GEN] fal.ai failed: {e}")
    return None


def generate_image(prompt: str) -> dict:
    """
    生成图片：先尝试 xAI，失败时 fallback 到 fal.ai Flux Uncensored。
    返回 {"b64": base64_string, "prompt": prompt} 或 None。
    """
    # 1. 先尝试 xAI
    result = _generate_image_xai(prompt)
    if result:
        return result

    # 2. xAI 失败（400 内容审核/超时/其他错误），fallback 到 fal.ai
    if FAL_KEY:
        logger.info(f"[IMAGE_GEN] xAI failed, falling back to fal.ai for: {prompt[:60]}")
        return _generate_image_fal(prompt)

    return None


def check_daily_limit(user_id, db) -> bool:
    """
    检查用户今日图片生成是否超过限额。
    返回 True = 还可以生成, False = 已达限额。
    """
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    count = db.db["image_gen_usage"].count_documents({
        "user_id": user_id,
        "created_at": {"$gte": today_start}
    })
    return count < DAILY_LIMIT


def record_usage(user_id, prompt: str, db):
    """记录一次图片生成使用"""
    db.db["image_gen_usage"].insert_one({
        "user_id": user_id,
        "prompt": prompt,
        "created_at": datetime.now(timezone.utc)
    })


def process_image_markers(reply: str, user_id, db):
    """
    顶层函数：提取 [IMAGE:] 标记 → 检查限额 → 拼接外观前缀 → 生成图片。
    返回 (cleaned_reply, images_list)
    images_list: [{"b64": ..., "prompt": ...}] 或 []
    图片生成失败不影响聊天 — 静默返回空列表。
    """
    cleaned_reply, prompts = extract_image_markers(reply)

    if not prompts:
        return reply, []

    if not XAI_API_KEY and not FAL_KEY:
        logger.warning("[IMAGE_GEN] No image generation API keys configured, skipping")
        return cleaned_reply, []

    if not check_daily_limit(user_id, db):
        logger.info(f"[IMAGE_GEN] User {user_id} reached daily limit ({DAILY_LIMIT})")
        return cleaned_reply, []

    # 获取角色外观前缀
    appearance = get_appearance_prefix(user_id, db)

    images = []
    for prompt in prompts:
        # 拼接外观前缀到 prompt
        if appearance:
            full_prompt = f"Character appearance: {appearance}. Scene: {prompt}"
        else:
            full_prompt = prompt
        result = generate_image(full_prompt)
        if result:
            # 保存原始短 prompt（不含 appearance 前缀），用于 DB 存储和前端显示
            result["prompt"] = prompt
            # 上传到 Cloudinary 持久化
            url = upload_to_cloudinary(result["b64"], user_id)
            if url:
                result["url"] = url
            images.append(result)
            record_usage(user_id, prompt, db)

    return cleaned_reply, images
