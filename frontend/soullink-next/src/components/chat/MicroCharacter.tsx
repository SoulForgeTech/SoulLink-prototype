'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { setCurrentEmotion } from '@/store/chatSlice';
import { useExpressionVideo, type ExpressionVideos } from '@/hooks/useExpressionVideo';
import { useChromaKey } from '@/hooks/useChromaKey';
import { canAccessExpressions } from '@/lib/featureFlags';

interface MicroCharacterProps {
  onHide?: () => void;
}

const CHIBI_RENDER_SIZE = 120;

export default function MicroCharacter({ onHide }: MicroCharacterProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showMenu, setShowMenu] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);

  const dispatch = useAppDispatch();
  const currentEmotion = useAppSelector((s) => s.chat.currentEmotion) || 'neutral';
  const expressions = useAppSelector((s) => s.settings.characterExpressions);
  const displayMode = useAppSelector((s) => s.settings.characterDisplayMode);
  const userEmail = useAppSelector((s) => s.auth.user?.email);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.emotion) dispatch(setCurrentEmotion(detail.emotion));
    };
    window.addEventListener('test-emotion-change', handler);
    return () => window.removeEventListener('test-emotion-change', handler);
  }, [dispatch]);

  const videoConfig: ExpressionVideos | null = expressions?.videos
    ? {
        videos: expressions.videos as Record<string, string>,
        idleVideos: expressions.idleVideos as Record<string, string> | undefined,
        neutralImage: expressions.neutralImage as string | undefined,
      }
    : null;

  useExpressionVideo(videoRef, videoConfig, currentEmotion);

  // Chroma key: render video onto canvas with green removed
  useChromaKey(videoRef, canvasRef, true);

  const handlePointerDown = useCallback(() => {
    longPressTimerRef.current = window.setTimeout(() => setShowMenu(true), 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    // Reserved for future expand functionality
  }, []);

  if (!canAccessExpressions(userEmail)) return null;
  if (displayMode === 'hidden' || !videoConfig) return null;

  return (
    <>
      <div className="micro-character-container">
        <div
          className="micro-character-inner"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ width: CHIBI_RENDER_SIZE, height: CHIBI_RENDER_SIZE, position: 'relative' }}
        >
          {/* Hidden video — feeds chroma key canvas */}
          <video
            ref={videoRef}
            style={{ display: 'none' }}
            muted
            playsInline
            preload="none"
            crossOrigin="anonymous"
          />

          {/* Canvas — chroma key output, transparent background */}
          <canvas
            ref={canvasRef}
            style={{ width: CHIBI_RENDER_SIZE, height: CHIBI_RENDER_SIZE, display: 'block' }}
          />
        </div>
      </div>

      {showMenu && (
        <div className="micro-character-menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="micro-character-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setShowMenu(false); onHide?.(); }}>Hide</button>
            <button onClick={() => setShowMenu(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
