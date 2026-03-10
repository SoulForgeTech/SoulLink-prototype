'use client';

/**
 * Mini games grid panel.
 *
 * Renders as a fixed dropdown panel (slides from right).
 * Uses original CSS classes: games-panel-dropdown, games-panel-header,
 * games-grid, game-tile, game-tile-emoji, game-tile-name.
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { closePanel, openGame } from '@/store/uiSlice';
import { MINI_GAMES } from '@/lib/constants';
import { useT } from '@/hooks/useT';
import type { GameId } from '@/types';

// ==================== Component ====================

export default function GamesPanel() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((s) => s.ui.panels.games);
  const t = useT();

  const handleClose = useCallback(() => {
    dispatch(closePanel('games'));
  }, [dispatch]);

  const handleOpenGame = useCallback(
    (gameId: GameId) => {
      dispatch(openGame(gameId));
    },
    [dispatch],
  );

  return (
    <div
      className={`games-panel-dropdown${isOpen ? ' open' : ''}`}
      style={{
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      }}
    >
      {/* Header — uses .games-panel-header CSS */}
      <div className="games-panel-header">
        <span>{t('games.title')}</span>
        <button onClick={handleClose} aria-label="Close">✕</button>
      </div>

      {/* Game cards grid — uses .games-grid CSS (2 columns) */}
      <div className="games-grid">
        {MINI_GAMES.map((game) => {
          const gameName = t(`games.${game.id}`);

          return (
            <div
              key={game.id}
              className="game-tile"
              onClick={() => handleOpenGame(game.id)}
            >
              <span className="game-tile-emoji">{game.emoji}</span>
              <span className="game-tile-name">{gameName || game.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
