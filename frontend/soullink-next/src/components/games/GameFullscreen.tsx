'use client';

/**
 * Game fullscreen wrapper.
 *
 * - Provides a consistent full-screen layout for all mini-games.
 * - Header with game name and exit button.
 * - Game content area renders the appropriate game component.
 * - Reads game state from the UI slice (gameFullscreen).
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { closeGame } from '@/store/uiSlice';
import type { GameId } from '@/types';

import BreathingGame from './BreathingGame';
import BubblePopGame from './BubblePopGame';
import ColorMixGame from './ColorMixGame';
import ShapeCatcherGame from './ShapeCatcherGame';
import ZenSandGame from './ZenSandGame';

// ==================== Game name map ====================

const GAME_TITLES: Record<GameId, { en: string; zh: string }> = {
  breathing: { en: 'Breathing Exercise', zh: '\u547C\u5438\u7EC3\u4E60' },
  bubbles: { en: 'Bubble Pop', zh: '\u6CE1\u6CE1\u6D88\u9664' },
  zen: { en: 'Zen Sand', zh: '\u7981\u6C99\u753B' },
  colormix: { en: 'Color Mix', zh: '\u989C\u8272\u6DF7\u5408' },
  shapes: { en: 'Shape Catcher', zh: '\u6355\u6349\u5F62\u72B6' },
};

// ==================== Game content renderer ====================

function GameContent({ gameId }: { gameId: GameId }) {
  switch (gameId) {
    case 'breathing':
      return <BreathingGame />;
    case 'bubbles':
      return <BubblePopGame />;
    case 'zen':
      return <ZenSandGame />;
    case 'colormix':
      return <ColorMixGame />;
    case 'shapes':
      return <ShapeCatcherGame />;
    default:
      return null;
  }
}

// ==================== Component ====================

export default function GameFullscreen() {
  const dispatch = useAppDispatch();
  const { isActive, gameId } = useAppSelector((s) => s.ui.gameFullscreen);
  const language = useAppSelector((s) => s.settings.language);
  const isZh = language === 'zh-CN';

  const handleExit = useCallback(() => {
    dispatch(closeGame());
  }, [dispatch]);

  if (!isActive || !gameId) return null;

  const title = isZh
    ? GAME_TITLES[gameId]?.zh
    : GAME_TITLES[gameId]?.en;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', flexDirection: 'column', background: 'var(--bg-dark)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '16px', paddingRight: '16px', paddingTop: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
          {title || gameId}
        </h2>
        <button
          onClick={handleExit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            paddingLeft: '12px',
            paddingRight: '12px',
            paddingTop: '6px',
            paddingBottom: '6px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.6)',
            fontSize: '0.75rem',
            fontWeight: 500,
            transition: 'all 0.2s',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          {isZh ? '\u9000\u51FA' : 'Exit'}
        </button>
      </div>

      {/* Game content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <GameContent gameId={gameId} />
      </div>
    </div>
  );
}
