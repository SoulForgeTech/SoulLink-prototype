"""
SoulLink Image Generation — BFL + Venice 双引擎
AI 在回复中插入 [IMAGE: description] 标记，后端检测并生成图片
Normal → BFL Flux Pro（高质量） → Venice fallback
NSFW  → Venice lustify-sdxl（无审查） → BFL fallback
生成后上传到 Cloudinary 持久化存储
"""

import os
import re
import io
import time
import base64
import logging
import requests
import cloudinary
import cloudinary.uploader
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ==================== Venice.ai 配置 ====================
VENICE_API_KEY = os.getenv("VENICE_API_KEY", "")
VENICE_IMAGE_URL = "https://api.venice.ai/api/v1/image/generate"
VENICE_MODEL_PHOTO = "lustify-sdxl"       # 真人风格 NSFW ($0.01/张)
VENICE_MODEL_ANIME = "wai-Illustrious"    # 动漫风格 NSFW ($0.01/张)

# ==================== BFL (Black Forest Labs) 配置 ====================
BFL_API_KEY = os.getenv("BFL_API_KEY", "")
BFL_MODEL = os.getenv("BFL_MODEL", "flux-pro-1.1")  # flux-pro-1.1 / flux-dev
BFL_SUBMIT_URL = "https://api.bfl.ai/v1"
BFL_RESULT_URL = "https://api.bfl.ai/v1/get_result"

DAILY_LIMIT = 20  # 每用户每天限额

# 默认通用外观 — 没有导入自定义角色时使用
DEFAULT_APPEARANCE_FEMALE = (
    "Anime art style, beautiful young woman with long flowing dark hair, "
    "bright expressive eyes, fair skin, slender build, wearing a stylish casual outfit "
    "with soft pastel colors, gentle and warm aesthetic"
)
DEFAULT_APPEARANCE_MALE = (
    "Realistic photographic style, handsome young man with dark hair, "
    "warm expressive eyes, fair skin, tall athletic build, wearing a casual stylish outfit, "
    "warm and charismatic aesthetic"
)
DEFAULT_APPEARANCE = DEFAULT_APPEARANCE_FEMALE  # 兼容旧代码引用

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


def _clean_image_prompt(prompt: str) -> str:
    """
    清理 AI 生成的 IMAGE 描述，去除夸张形容词和冗余外观描述。
    让 prompt 更简洁自然，避免图片模型产生夸张/畸形的结果。
    """
    # 去除常见的夸张形容词
    exaggerated_words = [
        r'\bperfect\b', r'\bflawless\b', r'\bstunning\b', r'\bgorgeous\b',
        r'\bsuperior\b', r'\bexquisite\b', r'\bimmaculate\b', r'\bimpeccable\b',
        r'\bporcelain\b', r'\bmodel-like\b', r'\bmodel-long\b', r'\bmodel-tall\b',
        r'\bbreathtak\w+\b', r'\bmesmeriz\w+\b', r'\bcaptivat\w+\b',
        r'\bideal\b', r'\bsculpted\b', r'\bchiseled\b', r'\bethere\w+\b',
        r'\bangelic\b', r'\bdivine\b', r'\bravishing\b', r'\bmagnificent\b',
        r'\bextraordinar\w+\b', r'\bunparalleled\b', r'\bsupremely\b',
    ]
    result = prompt
    for word in exaggerated_words:
        result = re.sub(word, '', result, flags=re.IGNORECASE)

    # 清理多余空格
    result = re.sub(r'  +', ' ', result).strip()
    # 清理连续的逗号
    result = re.sub(r',\s*,', ',', result)
    result = re.sub(r'^\s*,\s*', '', result)

    if result != prompt:
        logger.info(f"[IMAGE_GEN] Cleaned prompt: removed exaggerated words")

    return result


def extract_image_markers(reply: str):
    """
    从 AI 回复中提取所有 [IMAGE: ...] 标记（无数量限制）。
    返回 (cleaned_reply, prompts_list)
    """
    pattern = r'\[IMAGE:\s*(.+?)\]'
    matches = re.findall(pattern, reply, re.DOTALL)
    if not matches:
        return reply, []

    prompts = [_clean_image_prompt(m.strip()) for m in matches]
    # 移除所有 [IMAGE:] 标记（防止泄露到聊天）
    cleaned = re.sub(r'\s*\[IMAGE:\s*.+?\]', '', reply, flags=re.DOTALL).strip()
    return cleaned, prompts


def _extract_appearance_from_persona(persona: str) -> str:
    """
    用 Gemini 从 persona 文本中提取角色的视觉外观描述。
    返回一段英文外观描述（用于图片生成 prompt 前缀）。
    """
    try:
        from memory_engine import _call_gemini
        extraction_prompt = (
            "Extract a concise visual appearance description from this character persona for AI image generation. "
            "Output ONLY the appearance in English, max 80 words. MUST include:\n"
            "1. CRITICAL — Identify the character for the image model:\n"
            "   - Real person/celebrity → START with 'Resembling [Full English Name]' (e.g. 'Resembling Cai Xukun', 'Resembling Taylor Swift')\n"
            "   - Anime/game character → START with '[Name] from [Source]' (e.g. 'Rem from Re:Zero, anime art style')\n"
            "   - Original character → just describe, no prefix\n"
            "2. Art style — anime/game → 'Anime art style'; realistic → 'Realistic photographic style'\n"
            "3. Gender, hair color and style, eye features\n"
            "4. Typical outfit style\n"
            "IMPORTANT: Use simple, natural language. Do NOT use exaggerated words like: "
            "perfect, flawless, exquisite, stunning, gorgeous, model-like, porcelain, chiseled, sculpted, divine, angelic. "
            "Just describe factually.\n"
            "Output a single descriptive paragraph, no bullet points.\n\n"
            f"Character persona:\n{persona[:2000]}"
        )
        result = _call_gemini(extraction_prompt)
        if result and len(result) > 10:
            logger.info(f"[IMAGE_GEN] Extracted appearance: {result[:100]}")
            return result
    except Exception as e:
        logger.warning(f"[IMAGE_GEN] Failed to extract appearance: {e}")
    return ""


def _extract_persona_from_workspace(user_id, db) -> str:
    """
    兜底方案：当 MongoDB 中没有 persona 数据时，从 AnythingLLM workspace 的 system prompt 中提取。
    很多早期用户的角色数据只存在 workspace prompt 里，MongoDB 的 custom_persona 是空的。
    """
    try:
        workspace = db.db["workspaces"].find_one({"user_id": user_id})
        if not workspace:
            return ""
        slug = workspace.get("slug", "")
        if not slug:
            return ""

        allm_url = os.getenv("ANYTHINGLLM_BASE_URL", "http://localhost:3001")
        allm_key = os.getenv("ANYTHINGLLM_API_KEY", "")
        headers = {"Authorization": f"Bearer {allm_key}", "accept": "application/json"}

        resp = requests.get(f"{allm_url}/api/v1/workspace/{slug}", headers=headers, timeout=5)
        if not resp.ok:
            return ""

        data = resp.json()
        ws = data.get("workspace", [])
        if isinstance(ws, list) and ws:
            ws = ws[0]
        prompt = ws.get("openAiPrompt", "")
        if not prompt:
            return ""

        # 提取 Persona 段落（在 "# Persona" 和下一个 "#" 标题之间）
        import re
        persona_match = re.search(
            r'# Persona.*?\n(.*?)(?=\n# |\Z)',
            prompt, re.DOTALL
        )
        if persona_match:
            persona_text = persona_match.group(1).strip()
            if len(persona_text) > 30:
                logger.info(f"[IMAGE_GEN] Extracted persona from workspace for user {user_id} ({len(persona_text)} chars)")
                return persona_text

    except Exception as e:
        logger.warning(f"[IMAGE_GEN] Failed to extract persona from workspace: {e}")
    return ""


def get_appearance_prefix(user_id, db) -> str:
    """
    获取用户角色的外观描述前缀。
    优先级：缓存 → MongoDB persona → AnythingLLM workspace prompt → 默认外观
    """
    user = db.db["users"].find_one({"_id": user_id})
    if not user:
        return ""

    settings = user.get("settings", {})

    # 1. 检查缓存
    cached = settings.get("image_appearance")
    if cached:
        # 兼容旧数据：如果缓存中没有角色原名引用，尝试注入
        source_name = settings.get("custom_persona_name") or ""
        if source_name and source_name.lower() not in cached.lower():
            cached = f"{source_name}. {cached}"
            db.db["users"].update_one(
                {"_id": user_id},
                {"$set": {"settings.image_appearance": cached}}
            )
            logger.info(f"[IMAGE_GEN] Injected source name '{source_name}' into appearance for user {user_id}")
        return cached

    # 2. 从 MongoDB persona 提取
    persona = settings.get("custom_persona") or ""
    if not persona:
        pt = user.get("personality_test") or {}
        persona = pt.get("personality_profile") or ""

    # 3. 兜底：从 AnythingLLM workspace system prompt 提取
    if not persona:
        persona = _extract_persona_from_workspace(user_id, db)

    if not persona:
        # 根据伴侣性别选择默认外观
        gender = settings.get("companion_gender", "female")
        default_app = DEFAULT_APPEARANCE_MALE if gender == "male" else DEFAULT_APPEARANCE_FEMALE
        logger.info(f"[IMAGE_GEN] No persona for user {user_id}, using default {gender} appearance")
        return default_app

    appearance = _extract_appearance_from_persona(persona)
    if appearance:
        # 如果有原始角色名但提取结果没包含，补上
        source_name = settings.get("custom_persona_name") or ""
        if source_name and source_name.lower() not in appearance.lower():
            appearance = f"{source_name}. {appearance}"

        # 缓存到 settings
        db.db["users"].update_one(
            {"_id": user_id},
            {"$set": {"settings.image_appearance": appearance}}
        )
        logger.info(f"[IMAGE_GEN] Cached appearance for user {user_id}")
        return appearance

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


def _is_black_image(b64_data: str) -> bool:
    """
    检测图片是否是纯黑/近黑图（内容审核被拦截的标志）。
    用 Pillow 缩到 1x1 取平均亮度，低于阈值判定为黑图。
    """
    try:
        from PIL import Image
        img_bytes = base64.b64decode(b64_data)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        # 缩到 1x1 = 整张图的平均颜色
        avg_color = img.resize((1, 1)).getpixel((0, 0))
        avg_brightness = sum(avg_color) / 3
        if avg_brightness < 15:
            logger.warning(f"[IMAGE_GEN] Black/censored image detected: avg_brightness={avg_brightness:.1f}, avg_color={avg_color}, b64_len={len(b64_data)}")
            return True
        return False
    except Exception as e:
        logger.warning(f"[IMAGE_GEN] Black image check failed: {e}, falling back to size check")
        if len(b64_data) < 35000:
            return True
        return False


def _generate_image_venice(prompt: str, model: str = None) -> dict:
    """
    调用 Venice.ai API 生成图片（同步 API，~3 秒返回）。
    safe_mode=false 禁用 Mature Filter，支持完全无审查 NSFW。
    返回 {"b64": base64_string, "prompt": prompt} 或 None。
    """
    if not VENICE_API_KEY:
        logger.warning("[IMAGE_GEN] VENICE_API_KEY not configured")
        return None

    if not model:
        model = VENICE_MODEL_PHOTO

    try:
        resp = requests.post(
            VENICE_IMAGE_URL,
            headers={
                "Authorization": f"Bearer {VENICE_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "prompt": prompt,
                "width": 1024,
                "height": 1024,
                "safe_mode": False,
                "hide_watermark": True,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        images = data.get("images", [])
        if not images:
            logger.error(f"[IMAGE_GEN] Venice returned no images: {data}")
            return None

        b64 = images[0]  # Venice 直接返回 base64 字符串列表

        # 检测黑图/模糊图
        if _is_black_image(b64):
            logger.warning(f"[IMAGE_GEN] Venice returned black/censored image for: {prompt[:80]}...")
            return None

        timing = data.get("timing", {})
        duration = timing.get("total", "?")
        logger.info(f"[IMAGE_GEN] Venice [{model}] generated image ({len(b64)} chars b64, {duration}ms) for: {prompt[:80]}")
        return {"b64": b64, "prompt": prompt}

    except requests.exceptions.Timeout:
        logger.warning(f"[IMAGE_GEN] Venice timeout for: {prompt[:60]}")
    except Exception as e:
        logger.error(f"[IMAGE_GEN] Venice failed: {e}")
    return None


def _generate_image_bfl(prompt: str, safety_tolerance: int = 6) -> dict:
    """
    调用 BFL (Black Forest Labs) 官方 Flux API 生成图片。
    异步模式：提交任务 → 轮询结果。
    safety_tolerance: 0(最严格) ~ 6(最宽松)，NSFW 用 6。
    返回 {"b64": base64_string, "prompt": prompt} 或 None。
    """
    if not BFL_API_KEY:
        logger.warning("[IMAGE_GEN] BFL_API_KEY not configured")
        return None

    try:
        clean_prompt = _strip_real_names(prompt)

        # Step 1: 提交生成任务
        submit_url = f"{BFL_SUBMIT_URL}/{BFL_MODEL}"
        payload = {
            "prompt": clean_prompt,
            "width": 1024,
            "height": 1024,
            "safety_tolerance": safety_tolerance,
            "output_format": "jpeg",
        }
        # flux-dev 支持 steps 和 guidance 参数
        if "dev" in BFL_MODEL:
            payload["steps"] = 28
            payload["guidance"] = 3.5

        resp = requests.post(
            submit_url,
            headers={"x-key": BFL_API_KEY, "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        task_id = resp.json().get("id")
        if not task_id:
            logger.error("[IMAGE_GEN] BFL returned no task ID")
            return None

        logger.info(f"[IMAGE_GEN] BFL task submitted: {task_id}")

        # Step 2: 轮询结果（最多 120 秒）
        for i in range(40):  # 40 x 3s = 120s
            time.sleep(3)
            result_resp = requests.get(
                BFL_RESULT_URL,
                params={"id": task_id},
                headers={"x-key": BFL_API_KEY},
                timeout=15,
            )
            result_resp.raise_for_status()
            result_data = result_resp.json()
            status = result_data.get("status")

            if status == "Ready":
                image_url = result_data.get("result", {}).get("sample")
                if not image_url:
                    logger.error(f"[IMAGE_GEN] BFL Ready but no image URL: {result_data}")
                    return None

                logger.info(f"[IMAGE_GEN] BFL generated image: {image_url[:80]}")

                # 下载图片转 base64
                img_resp = requests.get(image_url, timeout=30)
                img_resp.raise_for_status()
                b64 = base64.b64encode(img_resp.content).decode("utf-8")

                # 检测黑图
                if _is_black_image(b64):
                    logger.warning(f"[IMAGE_GEN] BFL returned black/censored image for: {prompt[:80]}...")
                    return None

                logger.info(f"[IMAGE_GEN] BFL image ready ({len(b64)} chars b64, polled {i+1} times)")
                return {"b64": b64, "prompt": prompt}

            elif status in ("Error", "Content Moderated", "Request Moderated"):
                logger.warning(f"[IMAGE_GEN] BFL task {status}: {result_data}")
                return None

            # Pending / Processing → 继续轮询

        logger.warning(f"[IMAGE_GEN] BFL polling timeout for task {task_id}")
        return None

    except requests.exceptions.Timeout:
        logger.warning(f"[IMAGE_GEN] BFL timeout for: {prompt[:60]}")
    except Exception as e:
        logger.error(f"[IMAGE_GEN] BFL failed: {e}")
    return None




_NSFW_KEYWORDS = re.compile(
    r'\b(?:'
    # === 身体部位 ===
    r'breast[s]?|nipple[s]?|boob[s]?|tit[s]?|areola[s]?|cleavage|underboob|sideboob'
    r'|pussy|vagina|clit(?:oris)?|labia|crotch|vulva'
    r'|cock|dick|penis|shaft|erect(?:ion)?|boner|phallus'
    r'|ass(?:hole)?|butt(?:ocks)?|anus|anal'
    r'|genital[s]?|groin|pubic|crotch'
    r'|bosom|bust(?:y)|busty'
    # === 裸体/暴露状态 ===
    r'|nude|naked|topless|bottomless|undress(?:ed|ing)?'
    r'|strip(?:ping|ped|tease)?|uncloth'
    r'|bare\s*(?:chest|breast|skin|body|ass|butt)'
    # === 性行为/动作 ===
    r'|fuck(?:ing|ed)?|sex(?:ual|ually)?|intercourse|penetrat'
    r'|mast[ua]rbat|orgasm|cum(?:ming|shot)?|ejaculat|climax'
    r'|blowjob|handjob|fellatio|cunnilingus|deepthroat'
    r'|gangbang|threesome|foursome|orgy'
    r'|riding\s*(?:him|her|cock|dick)'
    r'|thrust(?:ing)?|grind(?:ing)?|hump(?:ing)?'
    r'|creampie|facial|squirt'
    # === 身体接触（性暗示）===
    r'|grope|groping|fondle|fondling|spank(?:ing)?'
    r'|lick(?:ing)?\s*(?:nipple|breast|pussy|cock|body)'
    r'|suck(?:ing)?\s*(?:nipple|breast|cock|dick|tit)'
    r'|moan(?:ing)?|erotic|lewd|hentai|aroused|horny'
    # === BDSM/Fetish ===
    r'|bondage|bdsm|tied\s*up|handcuff|rope\s*(?:bound|tied)'
    r'|dominat(?:e|ing|ion|rix)|submissive|slave'
    r'|whip(?:ping|ped)?|collar(?:ed)?|gagged?|blindfold'
    r'|fetish|kinky|sadomaso'
    # === 衣着相关 ===
    r'|lingerie|panties|thong|g-string|bra(?:\s|$)|braless'
    r'|see[\s-]?through|transparent\s*(?:cloth|dress|top|shirt)'
    r'|sheer\s*(?:cloth|dress|top|fabric)'
    r'|fishnet|garter|stockings\s*only'
    r'|micro[\s-]?bikini|slingshot\s*bikini'
    # === 姿势/动作描述 ===
    r'|spread\s*(?:legs?|open|eagle)|bent\s*over|on\s*(?:all\s*)?fours'
    r'|legs?\s*(?:wide\s*)?(?:spread|open|apart)'
    r'|straddle|straddling|mounting|mounted'
    r'|exposing|spilling\s*out|pulled\s*down|lifted\s*up|ripped\s*off'
    r'|clothes?\s*(?:off|removed|torn)|taking\s*off\s*(?:clothes|shirt|pants|dress)'
    # === 通用标记 ===
    r'|nsfw|xxx|porn(?:ographic)?|explicit|r[\s-]?rated|x[\s-]?rated'
    r'|slutty|slut|whore|bitch'
    r'|seduct(?:ive|ion|ress)|provocat(?:ive|ively)'
    r'|sensual(?:ly)?|intimate(?:ly)?\s*(?:touch|kiss|embrace)'
    r')\b',
    re.IGNORECASE
)


def _is_nsfw_prompt(prompt: str) -> bool:
    """检测 prompt 是否包含 NSFW 内容，用于路由到无审查 provider。"""
    matches = _NSFW_KEYWORDS.findall(prompt)
    if matches:
        logger.info(f"[IMAGE_GEN] NSFW detected ({len(matches)} keywords), routing to uncensored provider")
        return True
    return False


def _detect_anime_style(prompt: str) -> bool:
    """检测 prompt 是否为动漫/二次元风格（用于选择 Venice 模型）。"""
    anime_keywords = re.compile(
        r'\b(?:anime|manga|hentai|2D|illustration|wai[-\s]?illustrious'
        r'|chibi|cel[\s-]?shad|cartoon|animated'
        r'|from\s+(?:re:zero|naruto|one\s*piece|attack\s*on\s*titan|demon\s*slayer'
        r'|jujutsu|my\s*hero|genshin|honkai|fate|sword\s*art|evangelion))\b',
        re.IGNORECASE
    )
    return bool(anime_keywords.search(prompt))


def generate_image(prompt: str) -> dict:
    """
    三路由生成图片：
    - NSFW → Venice（无审查） → BFL fallback
    - Anime（非 NSFW） → Venice wai-Illustrious（动漫专用） → BFL fallback
    - Normal → BFL Flux Pro（高质量） → Venice fallback
    返回 {"b64": base64_string, "prompt": prompt} 或 None。
    """
    nsfw = _is_nsfw_prompt(prompt)
    anime = _detect_anime_style(prompt)

    if nsfw:
        # NSFW → Venice 优先（完全无审查）
        model = VENICE_MODEL_ANIME if anime else VENICE_MODEL_PHOTO
        logger.info(f"[IMAGE_GEN] NSFW routing → Venice [{model}]")
        result = _generate_image_venice(prompt, model=model)
        if result:
            return result
        logger.info("[IMAGE_GEN] Venice failed, fallback → BFL (tolerance=6)")
        result = _generate_image_bfl(prompt, safety_tolerance=6)
        if result:
            return result
    elif anime:
        # Anime → Venice wai-Illustrious（BFL 不认识动漫角色）
        logger.info(f"[IMAGE_GEN] Anime routing → Venice [{VENICE_MODEL_ANIME}]")
        result = _generate_image_venice(prompt, model=VENICE_MODEL_ANIME)
        if result:
            return result
        logger.info("[IMAGE_GEN] Venice anime failed, fallback → BFL")
        result = _generate_image_bfl(prompt, safety_tolerance=6)
        if result:
            return result
    else:
        # Normal → BFL 优先（高质量真人/风景）
        logger.info("[IMAGE_GEN] Normal routing → BFL")
        result = _generate_image_bfl(prompt, safety_tolerance=6)
        if result:
            return result
        logger.info("[IMAGE_GEN] BFL failed, fallback → Venice")
        result = _generate_image_venice(prompt)
        if result:
            return result

    logger.warning(f"[IMAGE_GEN] All providers failed for prompt: {prompt[:80]}")
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

    if not BFL_API_KEY and not VENICE_API_KEY:
        logger.warning("[IMAGE_GEN] No image generation API keys configured, skipping")
        return cleaned_reply, []

    if not check_daily_limit(user_id, db):
        logger.info(f"[IMAGE_GEN] User {user_id} reached daily limit ({DAILY_LIMIT})")
        return cleaned_reply, []

    # 获取角色外观前缀
    appearance = get_appearance_prefix(user_id, db)
    # 也清理 appearance 中的夸张形容词
    if appearance:
        appearance = _clean_image_prompt(appearance)

    images = []
    for prompt in prompts:
        # 拼接外观前缀到 prompt，控制总长度
        if appearance:
            # 截断外观前缀避免过长（保留核心特征）
            app_text = appearance[:200] if len(appearance) > 200 else appearance
            # 截断场景描述避免过长
            scene_text = prompt[:250] if len(prompt) > 250 else prompt
            full_prompt = f"Character appearance: {app_text}. Scene: {scene_text}"
        else:
            full_prompt = prompt[:350] if len(prompt) > 350 else prompt

        logger.info(f"[IMAGE_GEN] Full prompt ({len(full_prompt)} chars): {full_prompt[:200]}...")

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
