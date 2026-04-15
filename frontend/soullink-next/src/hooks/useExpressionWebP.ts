'use client';

import { useEffect, useRef } from 'react';

/**
 * Hook to display animated WebP expressions.
 * Simply updates the img src when emotion changes.
 * Animated WebP loops automatically — no playback control needed.
 */
export function useExpressionWebP(
  imgRef: React.RefObject<HTMLImageElement | null>,
  webpUrls: Record<string, string> | null,
  emotion: string,
) {
  const currentEmotionRef = useRef<string>('');

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !webpUrls) return;

    const url = webpUrls[emotion] || webpUrls['neutral'];
    if (!url) return;

    // Avoid unnecessary reloads if emotion hasn't changed
    if (emotion === currentEmotionRef.current) return;
    currentEmotionRef.current = emotion;

    img.src = url;
  }, [emotion, webpUrls, imgRef]);
}
