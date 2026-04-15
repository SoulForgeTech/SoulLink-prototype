'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

export interface SpriteSheetConfig {
  spriteSheetUrl: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  emotions: string[];
  framesPerEmotion: number;
}

type AnimState = 'idle' | 'transition' | 'blink';

interface AnimationState {
  currentEmotion: string;
  state: AnimState;
  frameIndex: number;
}

const DEFAULT_FRAME_INTERVAL = 90; // ms between frames during transition (8 frames x 90ms = ~0.7s)
const BLINK_FRAME_INTERVAL = 75;   // ms between frames during blink (faster)
const BLINK_MIN_DELAY = 3000;      // min ms between blinks
const BLINK_MAX_DELAY = 5000;      // max ms between blinks

export function useSpriteAnimation(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  config: SpriteSheetConfig | null,
  emotion: string,
  renderWidth: number,
  renderHeight: number
) {
  const spriteImageRef = useRef<HTMLImageElement | null>(null);
  const animStateRef = useRef<AnimationState>({
    currentEmotion: 'neutral',
    state: 'idle',
    frameIndex: 3, // start at last frame (idle pose)
  });
  const transitionTimerRef = useRef<number | null>(null);
  const blinkTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load sprite sheet image
  useEffect(() => {
    if (!config?.spriteSheetUrl) {
      setIsLoaded(false);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      spriteImageRef.current = img;
      setIsLoaded(true);
    };
    img.onerror = () => {
      console.error('Failed to load sprite sheet:', config.spriteSheetUrl);
      setIsLoaded(false);
    };
    img.src = config.spriteSheetUrl;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [config?.spriteSheetUrl]);

  // Get row index for a given emotion
  const getEmotionRow = useCallback((emotionName: string): number => {
    if (!config) return 0;
    const idx = config.emotions.indexOf(emotionName);
    return idx >= 0 ? idx : 0; // fallback to first row (neutral)
  }, [config]);

  // Draw a specific frame on the canvas
  const drawFrame = useCallback((emotionName: string, frameIdx: number) => {
    const canvas = canvasRef.current;
    const img = spriteImageRef.current;
    if (!canvas || !img || !config) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const row = getEmotionRow(emotionName);
    const col = Math.min(frameIdx, config.framesPerEmotion - 1);

    const sx = col * config.frameWidth;
    const sy = row * config.frameHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      img,
      sx, sy, config.frameWidth, config.frameHeight,
      0, 0, canvas.width, canvas.height
    );
  }, [canvasRef, config, getEmotionRow]);

  // Play transition sequence: frame 0 → 1 → 2 → 3 for the new emotion
  const playTransition = useCallback((targetEmotion: string) => {
    if (transitionTimerRef.current) {
      clearInterval(transitionTimerRef.current);
    }

    const anim = animStateRef.current;
    anim.state = 'transition';
    anim.currentEmotion = targetEmotion;
    anim.frameIndex = 0;

    drawFrame(targetEmotion, 0);

    transitionTimerRef.current = window.setInterval(() => {
      anim.frameIndex++;
      if (anim.frameIndex >= (config?.framesPerEmotion ?? 4)) {
        // Transition complete — settle on last frame
        anim.frameIndex = (config?.framesPerEmotion ?? 4) - 1;
        anim.state = 'idle';
        if (transitionTimerRef.current) {
          clearInterval(transitionTimerRef.current);
          transitionTimerRef.current = null;
        }
        drawFrame(targetEmotion, anim.frameIndex);
        return;
      }
      drawFrame(targetEmotion, anim.frameIndex);
    }, DEFAULT_FRAME_INTERVAL);
  }, [config, drawFrame]);

  // Play blink sequence
  const playBlink = useCallback(() => {
    const anim = animStateRef.current;
    if (anim.state !== 'idle') return; // don't blink during transition

    if (!config || !config.emotions.includes('blink')) return;

    anim.state = 'blink';
    let blinkFrame = 0;

    drawFrame('blink', 0);

    const blinkInterval = window.setInterval(() => {
      blinkFrame++;
      if (blinkFrame >= (config.framesPerEmotion)) {
        // Blink done — return to current emotion idle
        anim.state = 'idle';
        clearInterval(blinkInterval);
        drawFrame(anim.currentEmotion, (config.framesPerEmotion) - 1);
        return;
      }
      drawFrame('blink', blinkFrame);
    }, BLINK_FRAME_INTERVAL);
  }, [config, drawFrame]);

  // Schedule random blinks
  const scheduleNextBlink = useCallback(() => {
    if (blinkTimerRef.current) {
      clearTimeout(blinkTimerRef.current);
    }
    const delay = BLINK_MIN_DELAY + Math.random() * (BLINK_MAX_DELAY - BLINK_MIN_DELAY);
    blinkTimerRef.current = window.setTimeout(() => {
      playBlink();
      scheduleNextBlink();
    }, delay);
  }, [playBlink]);

  // Handle emotion changes
  useEffect(() => {
    if (!isLoaded || !config) return;

    const anim = animStateRef.current;
    if (emotion !== anim.currentEmotion) {
      playTransition(emotion);
    }
  }, [emotion, isLoaded, config, playTransition]);

  // Initial draw + start blink cycle
  useEffect(() => {
    if (!isLoaded || !config) return;

    // Draw initial idle frame
    const anim = animStateRef.current;
    anim.currentEmotion = emotion;
    anim.state = 'idle';
    anim.frameIndex = config.framesPerEmotion - 1;
    drawFrame(emotion, anim.frameIndex);

    // Start blink cycle
    scheduleNextBlink();

    return () => {
      if (transitionTimerRef.current) clearInterval(transitionTimerRef.current);
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isLoaded, config, drawFrame, scheduleNextBlink]);

  // Update canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    // Redraw after resize
    if (isLoaded) {
      const anim = animStateRef.current;
      drawFrame(anim.currentEmotion, anim.frameIndex);
    }
  }, [renderWidth, renderHeight, canvasRef, isLoaded, drawFrame]);

  return {
    isLoaded,
    playTransition,
    playBlink,
  };
}
