#!/usr/bin/env python3
"""
Process background images for SoulLink:
1. Crop portrait images to landscape (center crop, 3:2 ratio)
2. Resize all to 1920px wide (JPEG quality=85)
3. Generate 200px wide thumbnails in Background/thumbnails/
"""
import os
import shutil
import tempfile
from PIL import Image

BG_DIR = os.path.join(os.path.dirname(__file__), "Background")
THUMB_DIR = os.path.join(BG_DIR, "thumbnails")
TARGET_WIDTH = 1920
THUMB_WIDTH = 200
JPEG_QUALITY = 85

def process_image(filepath):
    """Process a single background image."""
    img = Image.open(filepath)
    w, h = img.size
    filename = os.path.basename(filepath)

    # Step 1: If portrait (h > w), center-crop to landscape 3:2
    if h > w:
        new_h = int(w * 2 / 3)  # 3:2 ratio
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
        print(f"  Cropped portrait {w}x{h} -> {img.size[0]}x{img.size[1]}")

    # Step 2: Resize to TARGET_WIDTH
    w, h = img.size
    if w > TARGET_WIDTH:
        new_h = int(h * TARGET_WIDTH / w)
        img = img.resize((TARGET_WIDTH, new_h), Image.LANCZOS)
        print(f"  Resized to {img.size[0]}x{img.size[1]}")

    # Step 3: Save (overwrite original via temp file to avoid lock issues)
    # Convert to RGB if RGBA
    if img.mode == 'RGBA':
        img = img.convert('RGB')
    # Close the original image file handle first
    img_copy = img.copy()
    img.close()
    # Save to temp file, then replace original
    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.jpg', dir=os.path.dirname(filepath))
    os.close(tmp_fd)
    img_copy.save(tmp_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
    try:
        os.replace(tmp_path, filepath)
    except OSError:
        # Windows fallback: delete original first
        os.remove(filepath)
        os.rename(tmp_path, filepath)
    img = img_copy  # use the copy for thumbnail generation
    size_kb = os.path.getsize(filepath) / 1024
    print(f"  Saved: {size_kb:.0f} KB")

    # Step 4: Generate thumbnail
    thumb_h = int(img.size[1] * THUMB_WIDTH / img.size[0])
    thumb = img.resize((THUMB_WIDTH, thumb_h), Image.LANCZOS)
    thumb_path = os.path.join(THUMB_DIR, filename)
    thumb.save(thumb_path, 'JPEG', quality=80, optimize=True)
    thumb_kb = os.path.getsize(thumb_path) / 1024
    print(f"  Thumbnail: {THUMB_WIDTH}x{thumb_h}, {thumb_kb:.0f} KB")

def process_bg_png():
    """Generate thumbnail for the default bg.png."""
    bg_path = os.path.join(os.path.dirname(__file__), "bg.png")
    if not os.path.exists(bg_path):
        print("bg.png not found, skipping")
        return

    img = Image.open(bg_path)
    if img.mode == 'RGBA':
        img = img.convert('RGB')

    w, h = img.size
    thumb_h = int(h * THUMB_WIDTH / w)
    thumb = img.resize((THUMB_WIDTH, thumb_h), Image.LANCZOS)
    thumb_path = os.path.join(THUMB_DIR, "bg.jpg")
    thumb.save(thumb_path, 'JPEG', quality=80, optimize=True)
    thumb_kb = os.path.getsize(thumb_path) / 1024
    print(f"bg.png thumbnail: {THUMB_WIDTH}x{thumb_h}, {thumb_kb:.0f} KB")

def main():
    # Create thumbnails dir
    os.makedirs(THUMB_DIR, exist_ok=True)

    # Process all background images
    files = sorted([f for f in os.listdir(BG_DIR)
                    if f.lower().endswith(('.jpg', '.jpeg', '.png'))
                    and f != 'thumbnails'])

    print(f"Processing {len(files)} background images...\n")

    for f in files:
        filepath = os.path.join(BG_DIR, f)
        if os.path.isfile(filepath):
            print(f"[{f}]")
            process_image(filepath)
            print()

    # Process bg.png thumbnail
    print("[bg.png - thumbnail only]")
    process_bg_png()

    print(f"\nDone! {len(files)} images processed, thumbnails in {THUMB_DIR}")

if __name__ == "__main__":
    main()
