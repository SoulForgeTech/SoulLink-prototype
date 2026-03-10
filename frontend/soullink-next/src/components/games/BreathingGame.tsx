'use client';

/**
 * Breathing exercise game.
 *
 * - Animated circle that expands (inhale) and contracts (exhale).
 * - 4-second inhale, 4-second exhale cycle.
 * - Uses breatheIn/breatheOut keyframe animations from globals.css.
 * - Text overlay: "Breathe In" / "Breathe Out".
 * - Start/Stop toggle button.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppSelector } from '@/store';

// ==================== Constants ====================

/** Duration of each phase in milliseconds */
const PHASE_DURATION_MS = 4000;

type Phase = 'inhale' | 'exhale';

// ==================== Component ====================

export default function BreathingGame() {
  const language = useAppSelector((s) => s.settings.language);
  const isZh = language === 'zh-CN';

  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>('inhale');
  const [cycles, setCycles] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Phase label
  const phaseText = (() => {
    if (!isRunning) {
      return isZh ? '\u70B9\u51FB\u5F00\u59CB' : 'Press Start';
    }
    if (phase === 'inhale') {
      return isZh ? '\u5438\u6C14...' : 'Breathe In...';
    }
    return isZh ? '\u547C\u6C14...' : 'Breathe Out...';
  })();

  // Animation style for the circle
  const circleAnimation = (() => {
    if (!isRunning) return {};
    return {
      animation:
        phase === 'inhale'
          ? `breatheIn ${PHASE_DURATION_MS}ms ease-in-out forwards`
          : `breatheOut ${PHASE_DURATION_MS}ms ease-in-out forwards`,
    };
  })();

  // Circle colour based on phase
  const circleGradient =
    phase === 'inhale'
      ? 'linear-gradient(to bottom right, rgba(107,163,214,0.4), rgba(45,212,191,0.4))'
      : 'linear-gradient(to bottom right, rgba(168,85,247,0.4), rgba(107,163,214,0.4))';

  const start = useCallback(() => {
    setIsRunning(true);
    setPhase('inhale');
    setCycles(0);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
    setPhase('inhale');
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Phase cycling
  useEffect(() => {
    if (!isRunning) return;

    timerRef.current = setInterval(() => {
      setPhase((prev) => {
        if (prev === 'inhale') {
          return 'exhale';
        } else {
          setCycles((c) => c + 1);
          return 'inhale';
        }
      });
    }, PHASE_DURATION_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '32px', padding: '0 16px' }}>
      {/* Breathing circle */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Outer glow */}
        <div
          style={{
            position: 'absolute',
            width: '208px',
            height: '208px',
            borderRadius: '50%',
            background: circleGradient,
            filter: 'blur(24px)',
            opacity: 0.5,
            transition: 'all 1s',
            ...circleAnimation,
          }}
        />

        {/* Main circle */}
        <div
          style={{
            position: 'relative',
            width: '160px',
            height: '160px',
            borderRadius: '50%',
            background: circleGradient,
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.5s',
            ...circleAnimation,
          }}
        >
          {/* Phase text */}
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: '1rem', fontWeight: 500, textAlign: 'center', padding: '0 16px' }}>
            {phaseText}
          </span>
        </div>
      </div>

      {/* Cycle counter */}
      {isRunning && cycles > 0 && (
        <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.4)' }}>
          {cycles} {isZh ? '\u6B21\u5FAA\u73AF' : cycles === 1 ? 'cycle' : 'cycles'}
        </p>
      )}

      {/* Start / Stop button */}
      <button
        onClick={isRunning ? stop : start}
        style={{
          paddingLeft: '32px',
          paddingRight: '32px',
          paddingTop: '10px',
          paddingBottom: '10px',
          borderRadius: '9999px',
          fontSize: '0.875rem',
          fontWeight: 500,
          transition: 'all 0.2s',
          border: 'none',
          cursor: 'pointer',
          background: isRunning ? 'rgba(255,255,255,0.1)' : 'var(--primary-color)',
          color: isRunning ? 'rgba(255,255,255,0.7)' : 'white',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isRunning ? 'rgba(255,255,255,0.15)' : 'var(--primary-light)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isRunning ? 'rgba(255,255,255,0.1)' : 'var(--primary-color)';
        }}
      >
        {isRunning
          ? isZh
            ? '\u505C\u6B62'
            : 'Stop'
          : isZh
            ? '\u5F00\u59CB'
            : 'Start'}
      </button>
    </div>
  );
}
