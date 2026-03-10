/**
 * Extract dominant color from a wallpaper/background image
 * and apply it to the --user-bubble-color CSS variable.
 *
 * Matches original index.html extractWallpaperColor() exactly:
 *   1. Downscale image to 50x50 canvas for speed
 *   2. Average all pixel RGB channels
 *   3. Lighten 55% toward white for bubble use
 *   4. Set --user-bubble-color CSS variable as "R, G, B"
 */
export function extractWallpaperColor(src: string): void {
  if (typeof window === 'undefined') return;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    const canvas = document.createElement('canvas');
    const size = 50; // sample at small size for speed
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let r = 0,
      g = 0,
      b = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);

    // Lighten for bubble use: blend 55% toward white
    const lr = Math.round(r + (255 - r) * 0.55);
    const lg = Math.round(g + (255 - g) * 0.55);
    const lb = Math.round(b + (255 - b) * 0.55);

    document.documentElement.style.setProperty(
      '--user-bubble-color',
      `${lr}, ${lg}, ${lb}`,
    );
  };
  img.src = src;
}
