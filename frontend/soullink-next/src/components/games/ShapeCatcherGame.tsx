'use client';

/**
 * Shape Catcher game.
 *
 * Shapes float up from the bottom — tap to catch them.
 * Matches the original index.html implementation.
 *
 * Uses native DOM elements (like original) instead of React state
 * re-renders to avoid click event issues with 60fps reconciliation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const SHAPE_TYPES = ['circle', 'square', 'triangle', 'diamond'] as const;
const COLORS = [
  '#9DC4E6', '#f472b6', '#60a5fa', '#34d399',
  '#fbbf24', '#f87171', '#38bdf8', '#fb923c',
];

function svgShape(type: string, color: string, size: number): string {
  const s = size;
  if (type === 'circle')
    return `<svg width="${s}" height="${s}" viewBox="0 0 40 40" style="pointer-events:none"><circle cx="20" cy="20" r="18" fill="${color}"/></svg>`;
  if (type === 'square')
    return `<svg width="${s}" height="${s}" viewBox="0 0 40 40" style="pointer-events:none"><rect x="4" y="4" width="32" height="32" rx="6" fill="${color}"/></svg>`;
  if (type === 'triangle')
    return `<svg width="${s}" height="${s}" viewBox="0 0 40 40" style="pointer-events:none"><polygon points="20,2 38,36 2,36" fill="${color}"/></svg>`;
  // diamond
  return `<svg width="${s}" height="${s}" viewBox="0 0 40 40" style="pointer-events:none"><polygon points="20,2 38,20 20,38 2,20" fill="${color}"/></svg>`;
}

interface ShapeEntry {
  id: number;
  el: HTMLDivElement;
  y: number;
  x: number;
  speed: number;
  drift: number;
  caught: boolean;
}

export default function ShapeCatcherGame() {
  const areaRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<ShapeEntry[]>([]);
  const [score, setScore] = useState(0);
  const nextIdRef = useRef(0);
  const rafRef = useRef<number>(0);
  const spawnRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Spawn shapes as native DOM elements (matches original index.html approach)
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;

    spawnRef.current = setInterval(() => {
      const rect = area.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const type = SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)];
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const size = 28 + Math.random() * 28;
      const x = Math.random() * (rect.width - size);
      const id = nextIdRef.current++;

      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = `${x}px`;
      el.style.top = `${rect.height}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.cursor = 'pointer';
      el.style.filter = 'drop-shadow(0 0 6px rgba(255,255,255,0.3))';
      el.style.transition = 'filter 0.15s';
      el.innerHTML = svgShape(type, color, size);

      el.addEventListener('click', () => {
        const shape = shapesRef.current.find((s) => s.id === id);
        if (shape && !shape.caught) {
          shape.caught = true;
          setScore((prev) => prev + 1);
          el.style.pointerEvents = 'none';
          el.style.animation = 'shapeCaught 0.5s ease-out forwards';
          setTimeout(() => {
            el.remove();
            shapesRef.current = shapesRef.current.filter((s) => s.id !== id);
          }, 500);
        }
      });

      area.appendChild(el);

      shapesRef.current.push({
        id,
        el,
        y: rect.height,
        x,
        speed: 0.4 + Math.random() * 0.6,
        drift: (Math.random() - 0.5) * 0.4,
        caught: false,
      });
    }, 500);

    return () => {
      if (spawnRef.current) clearInterval(spawnRef.current);
      // Clean up all shape elements
      shapesRef.current.forEach((s) => s.el.remove());
      shapesRef.current = [];
    };
  }, []);

  // Animation loop — direct DOM updates (no React re-render)
  useEffect(() => {
    let lastTime = performance.now();

    function animate(now: number) {
      const dt = Math.min(now - lastTime, 50);
      lastTime = now;

      for (let i = shapesRef.current.length - 1; i >= 0; i--) {
        const s = shapesRef.current[i];
        if (s.caught) continue;

        s.y -= s.speed * (dt / 16);
        s.x += s.drift * (dt / 16);
        s.el.style.top = `${s.y}px`;
        s.el.style.left = `${s.x}px`;

        // Remove if off-screen
        if (s.y < -60) {
          s.el.remove();
          shapesRef.current.splice(i, 1);
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      <style>{`
        @keyframes shapeCaught {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
      <div
        ref={areaRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #0f0f23 0%, #1a1a2e 100%)',
        }}
      >
        {/* Score */}
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.6)',
            fontSize: '1rem',
            fontWeight: 600,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          Score: {score}
        </div>

        {/* Instruction */}
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.3)',
            fontSize: '0.8rem',
            pointerEvents: 'none',
          }}
        >
          Tap shapes to catch them
        </div>
      </div>
    </>
  );
}
