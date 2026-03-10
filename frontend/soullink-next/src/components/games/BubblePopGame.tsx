'use client';

/**
 * Bubble Pop game.
 *
 * - Random bubbles appear on screen at intervals.
 * - Click/tap a bubble to pop it (scale-out animation).
 * - Score counter tracks total pops.
 * - Bubbles that are not popped fade out after a few seconds.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppSelector } from '@/store';

// ==================== Constants ====================

/** Max number of bubbles on screen at once */
const MAX_BUBBLES = 12;
/** Interval (ms) between spawning new bubbles */
const SPAWN_INTERVAL_MS = 800;
/** Time (ms) before an un-popped bubble disappears */
const BUBBLE_LIFETIME_MS = 4000;
/** Min bubble size in px */
const MIN_SIZE = 36;
/** Max bubble size in px */
const MAX_SIZE = 72;

// ==================== Types ====================

interface Bubble {
  id: number;
  x: number; // percentage (0-90)
  y: number; // percentage (0-85)
  size: number; // px
  color: string;
  popped: boolean;
  createdAt: number;
}

// ==================== Helpers ====================

const BUBBLE_COLORS = [
  'rgba(107, 163, 214, 0.6)', // primary
  'rgba(79, 209, 197, 0.6)',  // teal
  'rgba(139, 92, 246, 0.6)',  // purple
  'rgba(236, 72, 153, 0.6)',  // pink
  'rgba(251, 191, 36, 0.6)',  // amber
  'rgba(52, 211, 153, 0.6)',  // emerald
];

let nextId = 0;

function createBubble(): Bubble {
  return {
    id: nextId++,
    x: Math.random() * 85 + 2,
    y: Math.random() * 75 + 5,
    size: Math.random() * (MAX_SIZE - MIN_SIZE) + MIN_SIZE,
    color: BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)],
    popped: false,
    createdAt: Date.now(),
  };
}

// ==================== Component ====================

export default function BubblePopGame() {
  const language = useAppSelector((s) => s.settings.language);
  const isZh = language === 'zh-CN';

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [score, setScore] = useState(0);
  const spawnRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Spawn bubbles at regular intervals
  useEffect(() => {
    spawnRef.current = setInterval(() => {
      setBubbles((prev) => {
        // Remove expired + popped bubbles, add new one
        const alive = prev.filter(
          (b) => !b.popped && Date.now() - b.createdAt < BUBBLE_LIFETIME_MS,
        );
        if (alive.length >= MAX_BUBBLES) return alive;
        return [...alive, createBubble()];
      });
    }, SPAWN_INTERVAL_MS);

    return () => {
      if (spawnRef.current) clearInterval(spawnRef.current);
    };
  }, []);

  // Periodically clean up expired bubbles
  useEffect(() => {
    cleanupRef.current = setInterval(() => {
      setBubbles((prev) =>
        prev.filter(
          (b) => !b.popped && Date.now() - b.createdAt < BUBBLE_LIFETIME_MS,
        ),
      );
    }, 1000);

    return () => {
      if (cleanupRef.current) clearInterval(cleanupRef.current);
    };
  }, []);

  const handlePop = useCallback((id: number) => {
    setBubbles((prev) =>
      prev.map((b) => (b.id === id ? { ...b, popped: true } : b)),
    );
    setScore((s) => s + 1);

    // Remove the popped bubble after the animation
    setTimeout(() => {
      setBubbles((prev) => prev.filter((b) => b.id !== id));
    }, 300);
  }, []);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', userSelect: 'none' }}>
      {/* Score display */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        background: 'rgba(0,0,0,0.3)',
        backdropFilter: 'blur(4px)',
        borderRadius: '9999px',
        paddingLeft: '16px',
        paddingRight: '16px',
        paddingTop: '6px',
        paddingBottom: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
          {isZh ? '\u5F97\u5206' : 'Score'}
        </span>
        <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'white', fontVariantNumeric: 'tabular-nums' }}>
          {score}
        </span>
      </div>

      {/* Bubbles */}
      {bubbles.map((bubble) => {
        const opacity =
          1 -
          Math.max(
            0,
            (Date.now() - bubble.createdAt - BUBBLE_LIFETIME_MS * 0.7) /
              (BUBBLE_LIFETIME_MS * 0.3),
          );

        return (
          <button
            key={bubble.id}
            onClick={() => !bubble.popped && handlePop(bubble.id)}
            style={{
              position: 'absolute',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer',
              outline: 'none',
              padding: 0,
              left: `${bubble.x}%`,
              top: `${bubble.y}%`,
              width: bubble.size,
              height: bubble.size,
              backgroundColor: bubble.color,
              opacity: bubble.popped ? 0 : Math.max(0.2, opacity),
              transform: bubble.popped ? 'scale(1.5)' : 'scale(1)',
              transition: bubble.popped
                ? 'transform 0.3s ease-out, opacity 0.3s ease-out'
                : 'transform 0.2s ease',
              boxShadow: `0 0 ${bubble.size / 3}px ${bubble.color},
                          inset 0 -${bubble.size / 4}px ${bubble.size / 3}px rgba(255,255,255,0.15)`,
              animation: bubble.popped
                ? 'none'
                : `pulse-soft 2s ease-in-out infinite`,
            }}
            aria-label="Pop bubble"
          >
            {/* Shine highlight */}
            <div
              style={{
                position: 'absolute',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.3)',
                width: bubble.size * 0.3,
                height: bubble.size * 0.2,
                top: bubble.size * 0.15,
                left: bubble.size * 0.2,
                filter: 'blur(2px)',
              }}
            />
          </button>
        );
      })}

      {/* Instructions */}
      {score === 0 && bubbles.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.3)' }}>
            {isZh
              ? '\u70B9\u51FB\u6CE1\u6CE1\u6765\u6D88\u9664\u5B83\u4EEC'
              : 'Tap bubbles to pop them!'}
          </p>
        </div>
      )}
    </div>
  );
}
