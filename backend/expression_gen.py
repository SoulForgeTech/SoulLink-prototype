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
SEEDANCE_MODEL = "bytedance/seedance-2.0/fast/image-to-video"

FRAMES_PER_EMOTION = 8
SEEDANCE_DURATION = "4"  # string required by API
SEEDANCE_RESOLUTION = "480p"

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

def interpolate_expression(
    neutral_url: str,
    emotion_url: str,
    emotion: str,
) -> bytes | None:
    """
    Use Seedance 2.0 Fast to interpolate neutral→emotion.
    Returns video bytes or None.
    """
    prompt = (
        "Smooth facial expression transition, the character gradually changes expression, "
        "subtle natural movement, same character same pose same angle same background"
    )

    try:
        result = fal_client.subscribe(
            SEEDANCE_MODEL,
            arguments={
                "prompt": prompt,
                "image_url": neutral_url,
                "end_image_url": emotion_url,
                "resolution": SEEDANCE_RESOLUTION,
                "duration": SEEDANCE_DURATION,
                "aspect_ratio": "1:1",
                "generate_audio": False,
            },
        )

        video_url = result.get("video", {}).get("url")
        if not video_url:
            logger.error(f"[EXPR_GEN] Seedance no video URL for {emotion}: {result}")
            return None

        resp = _http.get(video_url, timeout=120)
        return resp.content

    except Exception as e:
        logger.error(f"[EXPR_GEN] Seedance error for {emotion}: {e}")
        return None


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


# ==================== Sprite Sheet Assembly ====================

def assemble_sprite_sheet(
    neutral_frame: np.ndarray,
    emotion_frames: dict[str, list[np.ndarray]],
    frame_width: int = 480,
    frame_height: int = 480,
) -> bytes:
    """
    Assemble a sprite sheet from extracted frames.
    Layout: 8 columns (frames) x 8 rows (7 emotions + 1 neutral)
    Returns WebP image bytes.
    """
    cols = FRAMES_PER_EMOTION
    rows = len(EMOTIONS) + 1  # 7 emotions + neutral

    sheet = Image.new("RGB", (cols * frame_width, rows * frame_height), (0, 0, 0))

    # Emotion rows (0-6)
    for row_idx, emotion in enumerate(EMOTIONS):
        frames = emotion_frames.get(emotion, [])
        for col_idx in range(cols):
            if col_idx < len(frames):
                frame = frames[col_idx]
                img = Image.fromarray(frame)
                img = img.resize((frame_width, frame_height), Image.LANCZOS)
                sheet.paste(img, (col_idx * frame_width, row_idx * frame_height))

    # Neutral row (last row) — single frame repeated
    neutral_img = Image.fromarray(neutral_frame)
    neutral_img = neutral_img.resize((frame_width, frame_height), Image.LANCZOS)
    for col_idx in range(cols):
        sheet.paste(neutral_img, (col_idx * frame_width, (rows - 1) * frame_height))

    # Encode as WebP
    buf = io.BytesIO()
    sheet.save(buf, format="WEBP", quality=85)
    return buf.getvalue()


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


# ==================== Main Pipeline ====================

GREEN_SUFFIX = ", solid bright green background, #00FF00 chroma key background"

def generate_expression_set(
    appearance: str,
    user_id: str,
    style: str = "anime",
    generate_chibi: bool = False,
    generate_full: bool = True,
    on_progress: Callable | None = None,
) -> dict:
    """
    Full pipeline: generate character expression videos.

    Returns:
        {
            "videos": { "happy": "url.mp4", ... },
            "idleVideos": { "neutral": "url.mp4", "happy": "url.mp4", ... },
            "neutralImage": "url.png",
        }
    """
    if FAL_KEY:
        os.environ["FAL_KEY"] = FAL_KEY

    config = STYLE_CONFIGS.get(style, STYLE_CONFIGS["anime"])

    # Step 1: Generate green screen keyframes (neutral + 7 emotions)
    if on_progress:
        on_progress("keyframes", 0, 8, "Generating keyframes...")

    keyframes_b64 = {}
    all_emotions = ["neutral"] + EMOTIONS
    for i, emo in enumerate(all_emotions):
        emo_desc = "calm relaxed expression, gentle slight smile" if emo == "neutral" else EMOTION_PROMPTS[emo]
        prompt = f"{config['prefix']}{appearance}, {emo_desc}, upper body portrait{GREEN_SUFFIX}"
        b64 = _generate_keyframe_venice(prompt, config["venice_model"])
        if b64:
            keyframes_b64[emo] = b64
        if on_progress:
            on_progress("keyframes", i + 1, 8, f"Generated {emo}")

    if "neutral" not in keyframes_b64:
        logger.error("[EXPR_GEN] Failed to generate neutral keyframe")
        return {}

    # Step 2: Upload keyframes to fal.ai
    if on_progress:
        on_progress("upload_keyframes", 0, 1, "Uploading keyframes...")

    fal_urls = {}
    for emo, b64 in keyframes_b64.items():
        fal_urls[emo] = upload_to_fal(b64)

    if on_progress:
        on_progress("upload_keyframes", 1, 1, "Keyframes uploaded")

    # Step 3: Generate idle loop videos (same start+end frame) for each emotion
    if on_progress:
        on_progress("video", 0, len(fal_urls), "Creating idle animations...")

    idle_videos = {}
    done = 0
    for emo, url in fal_urls.items():
        logger.info(f"[EXPR_GEN] Generating idle video: {emo}...")
        video_bytes = interpolate_expression(url, url, f"{emo}_idle")
        if video_bytes:
            # Upload to Cloudinary
            video_url = upload_video_to_cloudinary(video_bytes, user_id, f"{emo}_idle")
            if video_url:
                idle_videos[emo] = video_url
        done += 1
        if on_progress:
            on_progress("video", done, len(fal_urls), f"Idle: {emo}")

    # Step 4: Generate transition videos (neutral → each emotion)
    if on_progress:
        on_progress("video", 0, len(EMOTIONS), "Creating transition videos...")

    transition_videos = {}
    done = 0
    for emo in EMOTIONS:
        if emo not in fal_urls or "neutral" not in fal_urls:
            continue
        logger.info(f"[EXPR_GEN] Generating transition: neutral → {emo}...")
        video_bytes = interpolate_expression(fal_urls["neutral"], fal_urls[emo], f"transition_{emo}")
        if video_bytes:
            video_url = upload_video_to_cloudinary(video_bytes, user_id, f"{emo}_transition")
            if video_url:
                transition_videos[emo] = video_url
        done += 1
        if on_progress:
            on_progress("video", done, len(EMOTIONS), f"Transition: {emo}")

    # Step 5: Upload neutral image (with background removed)
    if on_progress:
        on_progress("upload_sheet", 0, 1, "Processing neutral image...")

    neutral_image_url = ""
    nobg = remove_background(keyframes_b64["neutral"])
    if nobg:
        neutral_image_url = upload_image_to_cloudinary(nobg, user_id, "neutral_nobg")
    else:
        neutral_image_url = upload_image_to_cloudinary(keyframes_b64["neutral"], user_id, "neutral")

    if on_progress:
        on_progress("upload_sheet", 1, 1, "Complete!")

    return {
        "videos": transition_videos,
        "idleVideos": idle_videos,
        "neutralImage": neutral_image_url,
    }
