'use client';

/**
 * Color Mix game.
 *
 * Tap/drag to create glowing color blobs that blend together
 * using mix-blend-mode: screen on a dark background.
 * Matches the original index.html implementation.
 */

import { useCallback, useRef, useEffect } from 'react';

const GLOW_COLORS = [
  { r: 0, g: 200, b: 255 },   // cyan
  { r: 120, g: 80, b: 255 },  // purple
  { r: 255, g: 50, b: 150 },  // pink
  { r: 50, g: 220, b: 130 },  // green
  { r: 255, g: 140, b: 50 },  // orange
  { r: 80, g: 120, b: 255 },  // blue
  { r: 255, g: 60, b: 80 },   // red
  { r: 200, g: 50, b: 255 },  // magenta
];

const MAX_ELEMENTS = 60;

export default function ColorMixGame() {
  const areaRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<HTMLDivElement[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      elementsRef.current = [];
    };
  }, []);

  const addBlob = useCallback((x: number, y: number) => {
    const area = areaRef.current;
    if (!area) return;

    const col = GLOW_COLORS[Math.floor(Math.random() * GLOW_COLORS.length)];
    const rgba = `rgba(${col.r},${col.g},${col.b},`;

    // Outer glow (large, blurry)
    const outerSize = 200 + Math.random() * 200;
    const outer = document.createElement('div');
    outer.style.cssText = `
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      filter: blur(40px);
      mix-blend-mode: screen;
      animation: colorBlobFade 10s ease forwards;
      width: ${outerSize}px;
      height: ${outerSize}px;
      left: ${x - outerSize / 2}px;
      top: ${y - outerSize / 2}px;
      background: ${rgba}0.6);
    `;
    area.appendChild(outer);

    // Inner core (smaller, brighter)
    const coreSize = outerSize * 0.4;
    const core = document.createElement('div');
    core.style.cssText = `
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      filter: blur(15px);
      mix-blend-mode: screen;
      animation: colorBlobFade 10s ease forwards;
      width: ${coreSize}px;
      height: ${coreSize}px;
      left: ${x - coreSize / 2}px;
      top: ${y - coreSize / 2}px;
      background: ${rgba}0.9);
    `;
    area.appendChild(core);

    // Ambient pulse
    const pulseSize = outerSize * 2;
    const pulse = document.createElement('div');
    pulse.style.cssText = `
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      filter: blur(80px);
      mix-blend-mode: screen;
      animation: colorBlobFade 10s ease forwards;
      width: ${pulseSize}px;
      height: ${pulseSize}px;
      left: ${x - pulseSize / 2}px;
      top: ${y - pulseSize / 2}px;
      background: ${rgba}0.3);
    `;
    area.appendChild(pulse);

    elementsRef.current.push(outer, core, pulse);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      outer.remove();
      core.remove();
      pulse.remove();
      elementsRef.current = elementsRef.current.filter(
        (el) => el !== outer && el !== core && el !== pulse,
      );
    }, 10000);

    // Limit total elements
    while (elementsRef.current.length > MAX_ELEMENTS) {
      const old = elementsRef.current.shift();
      old?.remove();
    }
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      addBlob(e.clientX - rect.left, e.clientY - rect.top);
    },
    [addBlob],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const touch = e.touches[0];
      addBlob(touch.clientX - rect.left, touch.clientY - rect.top);
    },
    [addBlob],
  );

  return (
    <>
      <style>{`
        @keyframes colorBlobFade {
          0% { opacity: 1; transform: scale(0.5); }
          20% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.2); }
        }
      `}</style>
      <div
        ref={areaRef}
        onClick={handleClick}
        onTouchMove={handleTouchMove}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: '#000',
          cursor: 'crosshair',
          touchAction: 'none',
        }}
      >
        {/* Instruction text */}
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
          Tap or drag to create colors
        </div>
      </div>
    </>
  );
}
