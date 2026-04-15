"""
SoulLink Expression Generation Pipeline
Venice keyframes → Seedance 2.0 video interpolation → frame extraction → sprite sheet

Flow:
  1. Venice generates 8 keyframes (neutral + 7 emotions) for both full & chibi
  2. Upload keyframes to fal.ai storage
  3. Seedance 2.0 Fast interpolates neutral→emotion (7 videos per type)
  4. OpenCV extracts 8 frames per video
  5. Pillow assembles sprite sheet (8 columns x 8 rows)
  6. Upload sprite sheets to Cloudinary

Dependencies:
  pip install fal-client opencv-python-headless Pillow
"""

import os
import io
import time
import uuid
import base64
import logging
import threading
import requests
import cv2
import numpy as np
from PIL import Image
from typing import Callable

import fal_client
import cloudinary
import cloudinary.uploader

logger = logging.getLogger(__name__)

# ==================== Config ====================

VENICE_API_KEY = os.getenv("VENICE_API_KEY", "")
VENICE_IMAGE_URL = "https://api.venice.ai/api/v1/image/generate"
VENICE_MODEL_ANIME = "wai-Illustrious"
VENICE_MODEL_PHOTO = "lustify-sdxl"

FAL_KEY = os.getenv("FAL_KEY", "")

# Video model: Wan-2.1 FLF2V (open-source, no IP copyright restrictions)
VIDEO_MODEL = "fal-ai/wan-flf2v"

FRAMES_PER_EMOTION = 8

EMOTIONS = ["happy", "sad", "angry", "surprised", "shy", "thinking", "loving"]

EMOTION_PROMPTS = {
    "happy": "bright cheerful smile, eyes squinting with joy, excited happy expression",
    "sad": "downcast eyes looking down, slight frown, melancholy sad expression",
    "angry": "furrowed brows, intense angry stare, annoyed expression",
    "surprised": "wide eyes, open mouth, shocked surprised expression",
    "shy": "blushing cheeks, looking away shyly, embarrassed cute expression",
    "thinking": "hand on chin, curious thoughtful look, pondering expression",
    "loving": "warm gentle smile, soft loving eyes, affectionate expression",
}

STYLE_CONFIGS = {
    "anime": {
        "prefix": "Anime art style, cel shading, clean linework, ",
        "venice_model": VENICE_MODEL_ANIME,
    },
    "realistic": {
        "prefix": "Photorealistic portrait, professional photography, soft lighting, ",
        "venice_model": VENICE_MODEL_PHOTO,
    },
    "3d": {
        "prefix": "3D rendered character, smooth shading, volumetric lighting, ",
        "venice_model": VENICE_MODEL_ANIME,
    },
    "illustration": {
        "prefix": "Digital illustration, painterly style, vibrant colors, ",
        "venice_model": VENICE_MODEL_ANIME,
    },
}

CHIBI_SUFFIX = (
    ", chibi style, big head small body, cute simplified proportions, "
    "standing pose, simple clean solid color background"
)

_http = requests.Session()


# ==================== Venice Keyframe Generation ====================

def _is_black_image(b64_data: str) -> bool:
    """Check if image is mostly black (Venice censorship)."""
    try:
        img_bytes = base64.b64decode(b64_data[:10000])  # sample first bytes
        img = Image.open(io.BytesIO(base64.b64decode(b64_data)))
        arr = np.array(img.convert("L"))  # grayscale
        return arr.mean() < 15  # average pixel value < 15 = basically black
    except Exception:
        return False


def _generate_keyframe_venice(prompt: str, model: str, retries: int = 2) -> str | None:
    """Generate a single keyframe via Venice. Returns base64 or None. Auto-retries on black images."""
    if not VENICE_API_KEY:
        return None

    for attempt in range(retries + 1):
        try:
            resp = _http.post(
                VENICE_IMAGE_URL,
                headers={
                    "Authorization": f"Bearer {VENICE_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "prompt": prompt,
                    "width": 768,
                    "height": 768,
                    "safe_mode": False,
                    "hide_watermark": True,
                },
                timeout=30,
            )
            resp.raise_for_status()
            images = resp.json().get("images", [])
            if not images:
                continue

            b64 = images[0]
            if _is_black_image(b64):
                logger.warning(f"[EXPR_GEN] Venice black image (attempt {attempt+1}), retrying...")
                continue

            return b64

        except Exception as e:
            logger.error(f"[EXPR_GEN] Venice error (attempt {attempt+1}): {e}")

    return None


def generate_keyframes(
    appearance: str,
    style: str = "anime",
    is_chibi: bool = False,
    on_progress: Callable | None = None,
) -> dict[str, str]:
    """
    Generate neutral + 7 emotion keyframes.
    Returns dict: { "neutral": b64, "happy": b64, ... }
    """
    config = STYLE_CONFIGS.get(style, STYLE_CONFIGS["anime"])
    suffix = CHIBI_SUFFIX if is_chibi else ", upper body portrait, clean white background"
    results = {}
    total = 1 + len(EMOTIONS)
    done = 0

    # Neutral first
    prompt = f"{config['prefix']}{appearance}, calm relaxed expression, gentle slight smile{suffix}"
    b64 = _generate_keyframe_venice(prompt, config["venice_model"])
    if b64:
        results["neutral"] = b64
    done += 1
    if on_progress:
        on_progress("keyframes", done, total, "Generated neutral keyframe")

    # Emotion keyframes
    for emotion in EMOTIONS:
        prompt = f"{config['prefix']}{appearance}, {EMOTION_PROMPTS[emotion]}{suffix}"
        b64 = _generate_keyframe_venice(prompt, config["venice_model"])
        if b64:
            results[emotion] = b64
        done += 1
        if on_progress:
            on_progress("keyframes", done, total, f"Generated {emotion} keyframe")

    return results


# ==================== fal.ai Upload ====================

def upload_to_fal(b64_data: str) -> str:
    """Upload base64 image to fal.ai storage. Returns public URL."""
    image_bytes = base64.b64decode(b64_data)
    url = fal_client.upload(image_bytes, content_type="image/jpeg")
    return url


# ==================== Seedance Video Interpolation ====================

IDLE_MOTION_PROMPTS = {
    "neutral": (
        "Anime character gentle idle animation, soft breathing motion, "
        "hair swaying slightly in breeze, gentle head tilt, blinking naturally, "
        "calm peaceful atmosphere, subtle body sway"
    ),
    "happy": (
        "Anime character happy bouncy idle animation, cheerful head bobbing, "
        "bright eyes sparkling, hair bouncing with movement, slight giggle motion, "
        "energetic cute swaying, joyful body language"
    ),
    "sad": (
        "Anime character sad idle animation, slow melancholy breathing, "
        "eyes looking down then up slowly, hair falling over face slightly, "
        "subtle shoulder drop, gentle sighing motion"
    ),
    "angry": (
        "Anime character annoyed idle animation, sharp eyebrow twitching, "
        "huffing breathing motion, crossed arms shifting, intense stare, "
        "slight head turn with attitude"
    ),
    "surprised": (
        "Anime character surprised idle animation, wide eyes blinking in shock, "
        "slight backward lean, hair bouncing from sudden movement, "
        "mouth opening and closing, startled body jolt"
    ),
    "shy": (
        "Anime character shy idle animation, fidgeting nervously, "
        "eyes darting left and right, blushing cheeks, hair tucking behind ear, "
        "slight body swaying side to side, cute embarrassed movement"
    ),
    "thinking": (
        "Anime character thinking idle animation, head tilting curiously, "
        "eyes looking up in thought, finger on chin gesture, "
        "slight nodding motion, contemplative expression shifting"
    ),
    "loving": (
        "Anime character loving idle animation, warm gentle swaying, "
        "eyes softening with affection, hand near heart, "
        "dreamy head tilt, hair flowing softly, adoring smile deepening"
    ),
}


KLING_MODEL = "fal-ai/kling-video/v2.1/master/image-to-video"


def _try_kling(
    image_url: str, label: str, prompt: str,
) -> bytes | None:
    """Try Kling 2.1 (good quality, lenient IP policy). Returns video bytes or None."""
    try:
        result = fal_client.subscribe(
            KLING_MODEL,
            arguments={
                "prompt": prompt,
                "image_url": image_url,
            },
        )
        video_url = result.get("video", {}).get("url")
        if not video_url:
            return None
        logger.info(f"[EXPR_GEN] Kling OK for {label}: {video_url}")
        resp = _http.get(video_url, timeout=120)
        return resp.content
    except Exception as e:
        logger.warning(f"[EXPR_GEN] Kling failed for {label}: {e}")
        return None


def _try_wan(
    start_url: str, end_url: str, label: str, prompt: str,
) -> bytes | None:
    """Wan fallback — no IP restrictions."""
    try:
        result = fal_client.subscribe(
            VIDEO_MODEL,
            arguments={
                "prompt": prompt,
                "start_image_url": start_url,
                "end_image_url": end_url,
                "num_frames": 81,
                "frames_per_second": 16,
                "resolution": "480p",
                "aspect_ratio": "1:1",
                "enable_safety_checker": False,
            },
        )
        video_url = result.get("video", {}).get("url")
        if not video_url:
            return None
        logger.info(f"[EXPR_GEN] Wan OK for {label}: {video_url}")
        resp = _http.get(video_url, timeout=120)
        return resp.content
    except Exception as e:
        logger.error(f"[EXPR_GEN] Wan error for {label}: {e}")
        return None


def interpolate_expression(
    start_url: str,
    end_url: str,
    label: str,
    motion_prompt: str | None = None,
) -> bytes | None:
    """
    Kling first (good quality + lenient IP), Wan fallback (no IP limits).
    Returns video bytes or None.
    """
    prompt = motion_prompt or (
        "Anime character gentle idle animation, natural breathing, "
        "hair swaying, subtle movement, same character same background"
    )

    # Try Kling first (image-to-video, uses start_url only)
    video = _try_kling(start_url, label, prompt)
    if video:
        return video

    # Fallback to Wan (FLF2V, uses both start+end)
    logger.info(f"[EXPR_GEN] Falling back to Wan for {label}")
    return _try_wan(start_url, end_url, label, prompt)


def interpolate_all_expressions(
    neutral_url: str,
    emotion_urls: dict[str, str],
    on_progress: Callable | None = None,
) -> dict[str, bytes]:
    """
    Interpolate neutral→each emotion via Seedance.
    Returns dict: { "happy": video_bytes, ... }
    """
    videos = {}
    total = len(emotion_urls)
    done = 0

    for emotion, emo_url in emotion_urls.items():
        logger.info(f"[EXPR_GEN] Interpolating neutral → {emotion}...")
        video_bytes = interpolate_expression(neutral_url, emo_url, emotion)
        if video_bytes:
            videos[emotion] = video_bytes
            logger.info(f"[EXPR_GEN] {emotion} video: {len(video_bytes)} bytes")
        else:
            logger.warning(f"[EXPR_GEN] Failed to interpolate {emotion}")
        done += 1
        if on_progress:
            on_progress("video", done, total, f"Interpolated {emotion}")

    return videos


# ==================== Frame Extraction ====================

def extract_frames_from_video(video_bytes: bytes, num_frames: int = 8) -> list[np.ndarray]:
    """Extract evenly-spaced frames from video bytes using OpenCV."""
    # Write to temp file (OpenCV needs file path)
    tmp_path = f"/tmp/expr_video_{uuid.uuid4().hex[:8]}.mp4"
    if os.name == "nt":
        tmp_path = os.path.join(os.environ.get("TEMP", "."), f"expr_video_{uuid.uuid4().hex[:8]}.mp4")

    try:
        with open(tmp_path, "wb") as f:
            f.write(video_bytes)

        cap = cv2.VideoCapture(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames == 0:
            return []

        # Evenly spaced indices (skip first and last few frames for stability)
        margin = max(2, total_frames // 20)
        usable = total_frames - 2 * margin
        indices = [margin + int(i * usable / (num_frames - 1)) for i in range(num_frames)]

        frames = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if ret:
                # Convert BGR to RGB
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frames.append(frame_rgb)

        cap.release()
        return frames

    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ==================== Server-side Chroma Key ====================

def _remove_bg_frame(frame_rgb: np.ndarray, frame_size: int = 480) -> Image.Image | None:
    """
    Remove background from a single video frame using BiRefNet.
    Returns RGBA PIL Image or None.
    """
    try:
        # Encode frame as PNG → base64 → upload to fal.ai
        img = Image.fromarray(frame_rgb)
        img = img.resize((frame_size, frame_size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        img_url = upload_to_fal(b64)

        # BiRefNet background removal
        result = fal_client.subscribe(
            "fal-ai/birefnet/v2",
            arguments={"image_url": img_url, "operating_resolution": "1024x1024"},
        )
        out_url = result.get("image", {}).get("url")
        if not out_url:
            return None

        resp = _http.get(out_url, timeout=30)
        return Image.open(io.BytesIO(resp.content)).convert("RGBA")

    except Exception as e:
        logger.warning(f"[EXPR_GEN] BiRefNet frame removal failed: {e}")
        return None


def video_to_animated_webp(
    video_bytes: bytes,
    num_frames: int = 20,
    frame_size: int = 480,
    duration_ms: int = 60,
) -> bytes | None:
    """
    Convert video to animated WebP with transparent background.
    Extracts frames, removes background via BiRefNet (parallel), assembles animated WebP.
    """
    from concurrent.futures import ThreadPoolExecutor

    frames_rgb = extract_frames_from_video(video_bytes, num_frames)
    if not frames_rgb:
        logger.warning("[EXPR_GEN] No frames extracted from video")
        return None

    logger.info(f"[EXPR_GEN] Removing backgrounds from {len(frames_rgb)} frames via BiRefNet...")

    # Parallel BiRefNet calls (much faster than sequential)
    pil_frames = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(_remove_bg_frame, frame, frame_size)
            for frame in frames_rgb
        ]
        for future in futures:  # maintain frame order
            result = future.result()
            if result:
                pil_frames.append(result)

    if len(pil_frames) < 2:
        logger.warning(f"[EXPR_GEN] Only {len(pil_frames)} frames after bg removal, need at least 2")
        return None

    # Assemble animated WebP
    buf = io.BytesIO()
    pil_frames[0].save(
        buf,
        format="WEBP",
        save_all=True,
        append_images=pil_frames[1:],
        duration=duration_ms,
        loop=0,  # infinite loop
        quality=85,
        allow_mixed=True,
    )
    return buf.getvalue()


def upload_webp_to_cloudinary(webp_bytes: bytes, user_id: str, name: str) -> str:
    """Upload animated WebP to Cloudinary. Returns URL or empty string."""
    _ensure_cloudinary()
    try:
        b64 = base64.b64encode(webp_bytes).decode()
        data_uri = f"data:image/webp;base64,{b64}"
        result = cloudinary.uploader.upload(
            data_uri,
            public_id=f"soullink/expressions/{user_id}/{name}",
            resource_type="image",
            overwrite=True,
        )
        return result.get("secure_url", "")
    except Exception as e:
        logger.error(f"[EXPR_GEN] WebP upload failed: {e}")
        return ""


# ==================== Cloudinary Upload ====================

def _ensure_cloudinary():
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    api_key = os.getenv("CLOUDINARY_API_KEY", "")
    api_secret = os.getenv("CLOUDINARY_API_SECRET", "")
    if cloud_name and api_key and api_secret:
        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret,
            secure=True,
        )


def upload_sprite_sheet(sheet_bytes: bytes, user_id: str, sheet_type: str) -> str:
    """Upload sprite sheet to Cloudinary. Returns URL or empty string."""
    _ensure_cloudinary()
    try:
        b64 = base64.b64encode(sheet_bytes).decode()
        data_uri = f"data:image/webp;base64,{b64}"
        public_id = f"soullink/expressions/{user_id}/{sheet_type}_{uuid.uuid4().hex[:8]}"
        result = cloudinary.uploader.upload(
            data_uri,
            public_id=public_id,
            resource_type="image",
        )
        return result.get("secure_url", "")
    except Exception as e:
        logger.error(f"[EXPR_GEN] Cloudinary upload failed: {e}")
        return ""


# ==================== Video Upload ====================

def upload_video_to_cloudinary(video_bytes: bytes, user_id: str, name: str) -> str:
    """Upload video to Cloudinary. Returns URL or empty string."""
    _ensure_cloudinary()
    try:
        # Write to temp file (Cloudinary needs file path for video)
        tmp_path = os.path.join(os.environ.get("TEMP", "/tmp"), f"expr_{uuid.uuid4().hex[:8]}.mp4")
        with open(tmp_path, "wb") as f:
            f.write(video_bytes)

        result = cloudinary.uploader.upload(
            tmp_path,
            resource_type="video",
            public_id=f"soullink/expressions/{user_id}/{name}",
            overwrite=True,
        )
        os.unlink(tmp_path)
        return result.get("secure_url", "")
    except Exception as e:
        logger.error(f"[EXPR_GEN] Video upload failed: {e}")
        return ""


def upload_image_to_cloudinary(b64_data: str, user_id: str, name: str) -> str:
    """Upload base64 image to Cloudinary. Returns URL or empty string."""
    _ensure_cloudinary()
    try:
        data_uri = f"data:image/png;base64,{b64_data}"
        result = cloudinary.uploader.upload(
            data_uri,
            public_id=f"soullink/expressions/{user_id}/{name}",
            overwrite=True,
        )
        return result.get("secure_url", "")
    except Exception as e:
        logger.error(f"[EXPR_GEN] Image upload failed: {e}")
        return ""


# ==================== Neutral Image Background Removal ====================

def remove_background(b64_data: str) -> str | None:
    """Remove background from image using fal.ai BiRefNet. Returns b64 or None."""
    try:
        img_url = upload_to_fal(b64_data)
        result = fal_client.subscribe(
            "fal-ai/birefnet/v2",
            arguments={"image_url": img_url, "operating_resolution": "1024x1024"},
        )
        out_url = result.get("image", {}).get("url")
        if out_url:
            resp = _http.get(out_url, timeout=30)
            return base64.b64encode(resp.content).decode()
    except Exception as e:
        logger.error(f"[EXPR_GEN] Background removal failed: {e}")
    return None


# ==================== Prompt Optimization ====================

BG_SUFFIX = ", simple clean solid white background"


import re as _re

# Keywords that trigger full-body generation — remove for upper body portraits
_LOWER_BODY_PATTERNS = _re.compile(
    r',?\s*(?:She (?:is often seen|wears|carries)|He (?:is often seen|wears|carries))'
    r'.*$',
    _re.IGNORECASE | _re.DOTALL,
)

_LOWER_BODY_WORDS = _re.compile(
    r'\b(?:shorts|pants|skirt|socks|stockings|shoes|boots|heels|sandals|'
    r'leather shoes|white socks|leggings|trousers|weapon|scepter|sword|'
    r'carries a|full body|standing|legs|thigh|feet)\b',
    _re.IGNORECASE,
)


def _strip_lower_body(appearance: str) -> str:
    """Remove lower-body clothing/weapon descriptions to keep Venice focused on upper body."""
    # Cut from "She is often seen..." / "He wears..." onwards
    result = _LOWER_BODY_PATTERNS.sub('', appearance).strip()

    # Also remove individual lower-body keywords in remaining sentences
    sentences = result.split('.')
    filtered = []
    for s in sentences:
        if not _LOWER_BODY_WORDS.search(s):
            filtered.append(s)
    result = '.'.join(filtered).strip()

    # Clean up trailing punctuation
    result = result.rstrip('., ')
    return result if len(result) > 20 else appearance


# ==================== Main Pipeline ====================

# FLUX img2img for consistent emotion variants
FLUX_IMG2IMG_MODEL = "fal-ai/flux/dev/image-to-image"
FLUX_EMOTION_STRENGTH = 0.75  # enough to change expression, preserve character identity


def _generate_emotion_img2img(
    neutral_url: str,
    emotion: str,
    appearance: str,
    style_prefix: str,
    retries: int = 1,
) -> str | None:
    """
    Generate emotion keyframe via FLUX img2img using neutral as base.
    Preserves character identity while changing facial expression.
    Returns base64 or None.
    """
    emo_desc = EMOTION_PROMPTS.get(emotion, "")
    prompt = (
        f"{style_prefix}{appearance}, {emo_desc}, "
        f"upper body portrait, same character same outfit same pose"
        f"{BG_SUFFIX}"
    )

    for attempt in range(retries + 1):
        try:
            result = fal_client.subscribe(
                FLUX_IMG2IMG_MODEL,
                arguments={
                    "image_url": neutral_url,
                    "prompt": prompt,
                    "strength": FLUX_EMOTION_STRENGTH,
                    "num_inference_steps": 28,
                    "guidance_scale": 3.5,
                    "num_images": 1,
                    "output_format": "png",
                    "enable_safety_checker": False,
                    "image_size": {"width": 768, "height": 768},
                },
            )

            images = result.get("images", [])
            if not images:
                logger.warning(f"[EXPR_GEN] FLUX img2img no images for {emotion} (attempt {attempt+1})")
                continue

            img_url = images[0].get("url") if isinstance(images[0], dict) else images[0]
            if not img_url:
                continue

            # Download and convert to base64
            resp = _http.get(img_url, timeout=30)
            resp.raise_for_status()
            b64 = base64.b64encode(resp.content).decode()

            if _is_black_image(b64):
                logger.warning(f"[EXPR_GEN] FLUX black image for {emotion} (attempt {attempt+1})")
                continue

            return b64

        except Exception as e:
            logger.error(f"[EXPR_GEN] FLUX img2img error for {emotion} (attempt {attempt+1}): {e}")

    return None


def generate_expression_set(
    appearance: str,
    user_id: str,
    style: str = "anime",
    generate_chibi: bool = False,
    generate_full: bool = True,
    on_progress: Callable | None = None,
) -> dict:
    """
    Full pipeline: generate character expression animated WebPs.

    Returns:
        {
            "webpUrls": { "neutral": "url.webp", "happy": "url.webp", ... },
            "neutralImage": "url.png",
        }
    """
    if FAL_KEY:
        os.environ["FAL_KEY"] = FAL_KEY

    config = STYLE_CONFIGS.get(style, STYLE_CONFIGS["anime"])

    # Strip lower-body descriptions so Venice focuses on upper body
    upper_appearance = _strip_lower_body(appearance)
    logger.info(f"[EXPR_GEN] Upper body appearance: {upper_appearance[:100]}...")

    # Step 1a: Generate neutral keyframe via Venice (text-to-image)
    if on_progress:
        on_progress("keyframes", 0, 8, "Generating neutral keyframe...")

    neutral_prompt = f"{config['prefix']}{upper_appearance}, calm relaxed expression, gentle slight smile, upper body portrait{BG_SUFFIX}"
    neutral_b64 = _generate_keyframe_venice(neutral_prompt, config["venice_model"])
    if not neutral_b64:
        logger.error("[EXPR_GEN] Failed to generate neutral keyframe")
        return {}

    keyframes_b64 = {"neutral": neutral_b64}
    if on_progress:
        on_progress("keyframes", 1, 8, "Generated neutral")

    # Step 1b: Upload neutral to fal.ai for img2img reference
    neutral_fal_url = upload_to_fal(neutral_b64)
    logger.info(f"[EXPR_GEN] Neutral uploaded for img2img reference: {neutral_fal_url}")

    # Step 1c: Generate emotion keyframes via FLUX img2img (character-consistent)
    for i, emo in enumerate(EMOTIONS):
        logger.info(f"[EXPR_GEN] Generating {emo} via img2img from neutral...")
        b64 = _generate_emotion_img2img(
            neutral_fal_url, emo, upper_appearance, config["prefix"]
        )
        if b64:
            keyframes_b64[emo] = b64
        else:
            # Fallback: Venice text-to-image (inconsistent but better than nothing)
            logger.warning(f"[EXPR_GEN] img2img failed for {emo}, falling back to Venice")
            emo_desc = EMOTION_PROMPTS[emo]
            fallback_prompt = f"{config['prefix']}{upper_appearance}, {emo_desc}, upper body portrait{BG_SUFFIX}"
            b64 = _generate_keyframe_venice(fallback_prompt, config["venice_model"])
            if b64:
                keyframes_b64[emo] = b64
        if on_progress:
            on_progress("keyframes", i + 2, 8, f"Generated {emo}")

    # Step 2: Upload keyframes to fal.ai (neutral already uploaded)
    if on_progress:
        on_progress("upload_keyframes", 0, 1, "Uploading keyframes...")

    fal_urls = {"neutral": neutral_fal_url}
    for emo, b64 in keyframes_b64.items():
        if emo == "neutral":
            continue  # already uploaded
        fal_urls[emo] = upload_to_fal(b64)

    if on_progress:
        on_progress("upload_keyframes", 1, 1, "Keyframes uploaded")

    # Step 3: Generate idle videos → convert to animated WebP with transparency
    # Parallel: submit all Wan jobs at once, then collect results
    from concurrent.futures import ThreadPoolExecutor, as_completed

    total_webps = len(fal_urls)
    if on_progress:
        on_progress("video", 0, total_webps, "Creating animations (parallel)...")

    def _generate_one_webp(emo: str, url: str) -> tuple[str, str | None]:
        """Generate video + convert to WebP for one emotion. Returns (emo, webp_url)."""
        motion = IDLE_MOTION_PROMPTS.get(emo)
        logger.info(f"[EXPR_GEN] Generating idle video for {emo}...")
        video_bytes = interpolate_expression(url, url, f"{emo}_idle", motion_prompt=motion)
        if not video_bytes:
            return (emo, None)
        logger.info(f"[EXPR_GEN] Converting {emo} video to animated WebP...")
        webp_bytes = video_to_animated_webp(video_bytes, num_frames=16, frame_size=480, duration_ms=180)
        if not webp_bytes:
            return (emo, None)
        webp_url = upload_webp_to_cloudinary(webp_bytes, user_id, f"{emo}_anim")
        if webp_url:
            logger.info(f"[EXPR_GEN] {emo} WebP uploaded: {len(webp_bytes)} bytes")
        return (emo, webp_url)

    webp_urls = {}
    done = 0
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(_generate_one_webp, emo, url): emo
            for emo, url in fal_urls.items()
        }
        for future in as_completed(futures):
            emo, webp_url = future.result()
            if webp_url:
                webp_urls[emo] = webp_url
            done += 1
            if on_progress:
                on_progress("video", done, total_webps, f"Animated: {emo}")

    # Step 4: Upload neutral image (with background removed)
    if on_progress:
        on_progress("finalize", 0, 1, "Processing neutral image...")

    neutral_image_url = ""
    nobg = remove_background(keyframes_b64["neutral"])
    if nobg:
        neutral_image_url = upload_image_to_cloudinary(nobg, user_id, "neutral_nobg")
    else:
        neutral_image_url = upload_image_to_cloudinary(keyframes_b64["neutral"], user_id, "neutral")

    if on_progress:
        on_progress("finalize", 1, 1, "Complete!")

    return {
        "webpUrls": webp_urls,
        "neutralImage": neutral_image_url,
    }
