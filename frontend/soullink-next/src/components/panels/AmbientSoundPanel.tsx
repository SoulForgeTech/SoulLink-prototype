'use client';

/**
 * Ambient sound mixer panel.
 *
 * Renders as a fixed dropdown panel (slides from right).
 * Uses original CSS classes: ambient-panel-dropdown, ambient-panel-header,
 * ambient-header-controls, ambient-master-btn, ambient-panel-body,
 * ambient-categories, ambient-cat-label, ambient-cat-grid, ambient-tile,
 * ambient-tile-emoji, ambient-tile-body, ambient-tile-name, ambient-tile-vol.
 */

import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { closePanel } from '@/store/uiSlice';
import { AMBIENT_SOUNDS } from '@/lib/constants';
import { useAmbientSound } from '@/hooks/useAmbientSound';
import { useT } from '@/hooks/useT';
import type { AmbientSoundDef } from '@/types';

// ==================== Types ====================

type Category = AmbientSoundDef['category'];

// ==================== Component ====================

export default function AmbientSoundPanel() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((s) => s.ui.panels.ambientSound);
  const t = useT();

  const {
    toggleSound,
    setVolume,
    toggleMaster,
    isSoundActive,
    getVolume,
    masterPlaying,
    activeSoundCount,
  } = useAmbientSound();

  // Group sounds by category
  const grouped = useMemo(() => {
    const groups: Record<Category, AmbientSoundDef[]> = {
      rain: [],
      nature: [],
      urban: [],
      noise: [],
    };
    for (const sound of AMBIENT_SOUNDS) {
      groups[sound.category].push(sound);
    }
    return groups;
  }, []);

  const handleClose = useCallback(() => {
    dispatch(closePanel('ambientSound'));
  }, [dispatch]);

  // Build dynamic classes for the panel
  const panelClasses = [
    'ambient-panel-dropdown',
    isOpen ? 'open' : '',
    masterPlaying ? 'is-playing' : '',
    activeSoundCount > 0 ? 'has-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={panelClasses}
      style={{
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      }}
    >
      {/* Header — uses .ambient-panel-header CSS */}
      <div className="ambient-panel-header">
        <span>{t('ambient.no_sounds')}</span>
        <div className="ambient-header-controls">
          <button
            className="ambient-master-btn"
            onClick={toggleMaster}
            title={masterPlaying ? 'Pause all' : 'Play all'}
          >
            <svg className="ambient-icon-play" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            <svg className="ambient-icon-pause" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
          <button onClick={handleClose} aria-label="Close">✕</button>
        </div>
      </div>

      {/* Body — uses .ambient-panel-body CSS */}
      <div className="ambient-panel-body">
        <div className="ambient-categories">
          {(Object.keys(grouped) as Category[]).map((cat) => {
            const sounds = grouped[cat];
            if (sounds.length === 0) return null;

            const catLabel = t(`ambient.cat.${cat}`);

            return (
              <div key={cat}>
                <div className="ambient-cat-label">{catLabel}</div>
                <div className="ambient-cat-grid">
                  {sounds.map((sound) => {
                    const isActive = isSoundActive(sound.id);
                    const volume = getVolume(sound.id);
                    const soundLabel = t(`ambient.sound.${sound.id}`);

                    return (
                      <div
                        key={sound.id}
                        className={`ambient-tile${isActive ? ' active' : ''}`}
                        onClick={() => toggleSound(sound.id, sound.src)}
                      >
                        <span className="ambient-tile-emoji">{sound.emoji}</span>
                        <div className="ambient-tile-body">
                          <div className="ambient-tile-name">
                            {soundLabel || sound.id}
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={Math.round(volume * 100)}
                            onChange={(e) => {
                              e.stopPropagation();
                              setVolume(sound.id, Number(e.target.value) / 100);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="ambient-tile-vol"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
