'use client';

import { useRef, useEffect, useCallback } from 'react';

/**
 * Hook to render a video onto a canvas with real-time green screen removal.
 * Replaces green pixels (chroma key) with transparency.
 */
export function useChromaKey(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
) {
  const rafRef = useRef<number>(0);

  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.paused || video.ended) {
      // Keep requesting frames even when paused (for last frame display)
      if (enabled) rafRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Match canvas size to video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 480;
      canvas.height = video.videoHeight || 480;
    }

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get pixel data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Chroma key: remove only pure green screen pixels (strict threshold)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Only target pixels that are clearly green screen:
      // green must be dominant and high, red+blue must be low
      // Remove green screen — wider tolerance for Venice's impure greens
      // Covers bright green, yellow-green, dark green variants
      const maxRB = Math.max(r, b);
      if (g > 80 && g > maxRB && (g - maxRB) > 20) {
        const greenness = (g - maxRB) / g;
        data[i + 3] = Math.max(0, Math.round(255 - greenness * 600));
      }
    }

    ctx.putImageData(imageData, 0, 0);
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [videoRef, canvasRef, enabled]);

  // Start/stop render loop
  useEffect(() => {
    if (!enabled) return;

    const video = videoRef.current;
    if (!video) return;

    const startRendering = () => {
      rafRef.current = requestAnimationFrame(renderFrame);
    };

    // Render when video plays
    video.addEventListener('play', startRendering);
    // Also render first frame when loaded
    video.addEventListener('loadeddata', () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (canvas && ctx && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Apply chroma key to first frame too
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (g > 100 && g > r * 2.0 && g > b * 2.0 && r < 150 && b < 150) {
            const greenness = (g - Math.max(r, b)) / 255;
            data[i + 3] = Math.max(0, Math.round(255 - greenness * 500));
          }
        }
        ctx.putImageData(imageData, 0, 0);
      }
    });

    // If video is already playing, start now
    if (!video.paused) startRendering();

    return () => {
      cancelAnimationFrame(rafRef.current);
      video.removeEventListener('play', startRendering);
    };
  }, [enabled, videoRef, canvasRef, renderFrame]);
}
