'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { setCurrentEmotion } from '@/store/chatSlice';
import { useExpressionWebP } from '@/hooks/useExpressionWebP';
import { canAccessExpressions } from '@/lib/featureFlags';

interface MicroCharacterProps {
  onHide?: () => void;
}

const CHIBI_RENDER_SIZE = 120;

export default function MicroCharacter({ onHide }: MicroCharacterProps) {
  const imgRef = useRef<HTMLImageElement>(null);
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

  const webpUrls = expressions?.webpUrls || null;

  useExpressionWebP(imgRef, webpUrls, currentEmotion);

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
  if (displayMode === 'hidden' || !webpUrls) return null;

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
          <img
            ref={imgRef}
            style={{
              width: CHIBI_RENDER_SIZE,
              height: CHIBI_RENDER_SIZE,
              display: 'block',
              objectFit: 'contain',
            }}
            alt=""
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
