'use client';

/**
 * Ambient sound manager hook.
 *
 * - Manages multiple HTMLAudioElement instances, each looping.
 * - Per-sound volume control (0.0 - 1.0).
 * - Master play/pause to toggle all active sounds at once.
 * - Persists state (including src URLs) to localStorage so sounds
 *   can be recreated and resumed after page reload.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ==================== Constants ====================

const STORAGE_KEY = 'soullink_ambient_sounds';

// ==================== Types ====================

export interface AmbientSoundState {
  /** Sound ID -> whether it is toggled on */
  active: Record<string, boolean>;
  /** Sound ID -> volume (0.0 - 1.0) */
  volumes: Record<string, number>;
  /** Sound ID -> audio src URL (persisted so we can recreate after reload) */
  srcs: Record<string, string>;
  /** Master play/pause */
  masterPlaying: boolean;
}

interface UseAmbientSoundReturn {
  /** Toggle a specific sound on/off */
  toggleSound: (soundId: string, src: string) => void;
  /** Set the volume for a specific sound */
  setVolume: (soundId: string, volume: number) => void;
  /** Master play/pause toggle */
  toggleMaster: () => void;
  /** Whether a specific sound is currently active */
  isSoundActive: (soundId: string) => boolean;
  /** Get the volume for a specific sound */
  getVolume: (soundId: string) => number;
  /** Whether master is playing */
  masterPlaying: boolean;
  /** Count of active sounds */
  activeSoundCount: number;
}

// ==================== localStorage helpers ====================

function loadState(): AmbientSoundState {
  if (typeof window === 'undefined') {
    return { active: {}, volumes: {}, srcs: {}, masterPlaying: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Backward compat: ensure srcs field exists
      if (!parsed.srcs) parsed.srcs = {};
      return parsed;
    }
  } catch {
    // corrupted data
  }
  return { active: {}, volumes: {}, srcs: {}, masterPlaying: false };
}

function saveState(state: AmbientSoundState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

// ==================== Hook ====================

export function useAmbientSound(): UseAmbientSoundReturn {
  const [state, setState] = useState<AmbientSoundState>(loadState);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});

  // Persist state changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(audioElementsRef.current).forEach((audio) => {
        audio.pause();
        audio.src = '';
      });
      audioElementsRef.current = {};
    };
  }, []);

  /** Get or create an HTMLAudioElement for a sound */
  const getOrCreateAudio = useCallback(
    (soundId: string, src: string, volume: number): HTMLAudioElement => {
      let audio = audioElementsRef.current[soundId];
      if (!audio) {
        audio = new Audio(src);
        audio.loop = true;
        audio.preload = 'auto';
        audio.volume = volume;
        audioElementsRef.current[soundId] = audio;
      }
      return audio;
    },
    [],
  );

  const toggleSound = useCallback(
    (soundId: string, src: string) => {
      setState((prev) => {
        const wasActive = prev.active[soundId] ?? false;
        const newActive = { ...prev.active, [soundId]: !wasActive };
        const newSrcs = { ...prev.srcs, [soundId]: src };
        const vol = prev.volumes[soundId] ?? 0.5;

        const audio = getOrCreateAudio(soundId, src, vol);

        if (!wasActive) {
          // Turning on — auto-play immediately and set master to playing
          audio.volume = vol;
          audio.play().catch(() => {});
          return { ...prev, active: newActive, srcs: newSrcs, masterPlaying: true };
        } else {
          // Turning off
          audio.pause();
          audio.currentTime = 0;
          // If no sounds left active, pause master
          const stillActive = Object.entries(newActive).some(([, v]) => v);
          return { ...prev, active: newActive, srcs: newSrcs, masterPlaying: stillActive ? prev.masterPlaying : false };
        }
      });
    },
    [getOrCreateAudio],
  );

  const setVolume = useCallback((soundId: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));

    setState((prev) => ({
      ...prev,
      volumes: { ...prev.volumes, [soundId]: clamped },
    }));

    const audio = audioElementsRef.current[soundId];
    if (audio) {
      audio.volume = clamped;
    }
  }, []);

  const toggleMaster = useCallback(() => {
    setState((prev) => {
      const newPlaying = !prev.masterPlaying;

      Object.entries(prev.active).forEach(([id, isActive]) => {
        if (!isActive) return;

        const vol = prev.volumes[id] ?? 0.5;
        const src = prev.srcs[id];

        // Recreate audio element if it doesn't exist (e.g. after page reload)
        let audio = audioElementsRef.current[id];
        if (!audio && src) {
          audio = getOrCreateAudio(id, src, vol);
        }
        if (!audio) return;

        if (newPlaying) {
          audio.volume = vol;
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      });

      return { ...prev, masterPlaying: newPlaying };
    });
  }, [getOrCreateAudio]);

  const isSoundActive = useCallback(
    (soundId: string): boolean => {
      return state.active[soundId] ?? false;
    },
    [state.active],
  );

  const getVolume = useCallback(
    (soundId: string): number => {
      return state.volumes[soundId] ?? 0.5;
    },
    [state.volumes],
  );

  const activeSoundCount = Object.values(state.active).filter(Boolean).length;

  return {
    toggleSound,
    setVolume,
    toggleMaster,
    isSoundActive,
    getVolume,
    masterPlaying: state.masterPlaying,
    activeSoundCount,
  };
}
