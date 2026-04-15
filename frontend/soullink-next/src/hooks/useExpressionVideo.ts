'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

export interface ExpressionVideos {
  videos: Record<string, string>;
  idleVideos?: Record<string, string>;
  neutralImage?: string;
}

export function useExpressionVideo(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  config: ExpressionVideos | null,
  emotion: string,
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const currentEmotionRef = useRef<string>('');
  const configRef = useRef(config);
  configRef.current = config;
  const initializedRef = useRef(false);

  useEffect(() => {
    setIsLoaded(!!config?.videos || !!config?.idleVideos);
  }, [config]);

  // Play idle video for a given emotion (loop)
  const playIdle = useCallback((emo: string) => {
    const video = videoRef.current;
    const cfg = configRef.current;
    if (!video || !cfg) return;

    const idleUrl = cfg.idleVideos?.[emo];
    const transitionUrl = cfg.videos?.[emo];
    const url = idleUrl || transitionUrl;

    if (url) {
      video.src = url;
      video.loop = true;
      video.load();
      video.play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  }, [videoRef]);

  // Handle emotion change + initial mount
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !config) return;
    if (emotion === currentEmotionRef.current && initializedRef.current) return;

    currentEmotionRef.current = emotion;
    initializedRef.current = true;

    // If there's a transition video, play it once first
    const transitionUrl = config.videos?.[emotion];
    const idleUrl = config.idleVideos?.[emotion];

    if (transitionUrl && emotion !== 'neutral') {
      // Play transition once, then switch to idle on ended
      video.loop = false;
      video.src = transitionUrl;
      video.load();
      video.play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    } else if (idleUrl) {
      // No transition, go straight to idle loop
      video.src = idleUrl;
      video.loop = true;
      video.load();
      video.play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  }, [emotion, config, videoRef]);

  // On transition end → switch to idle loop
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.onended = () => {
      if (video.loop) return; // already looping
      const emo = currentEmotionRef.current;
      playIdle(emo);
    };

    return () => { video.onended = null; };
  }, [videoRef, playIdle]);

  return { isPlaying, isLoaded, playEmotion: playIdle };
}
