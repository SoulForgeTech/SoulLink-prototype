'use client';

/**
 * Zen Sand garden game.
 *
 * Canvas-based zen garden — draw patterns in sand with mouse/touch.
 * Matches the original index.html implementation.
 */

import { useCallback, useEffect, useRef } from 'react';

export default function ZenSandGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      fillSandBackground(canvas);
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const fillSandBackground = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Sand base color
    ctx.fillStyle = '#d4b896';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add subtle grain texture
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 20;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const getPos = useCallback(
    (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
      const rect = canvas.getBoundingClientRect();
      if ('touches' in e) {
        const touch = e.touches[0];
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      }
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
    },
    [],
  );

  const drawStroke = useCallback(
    (fromX: number, fromY: number, toX: number, toY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Main sand trail (darker groove)
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = 'rgba(160, 130, 90, 0.8)';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Inner lighter line (sand displacement)
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = 'rgba(220, 200, 170, 0.6)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Edge highlights (raised sand on edges)
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const perpX = Math.cos(angle + Math.PI / 2) * 5;
      const perpY = Math.sin(angle + Math.PI / 2) * 5;

      ctx.beginPath();
      ctx.moveTo(fromX + perpX, fromY + perpY);
      ctx.lineTo(toX + perpX, toY + perpY);
      ctx.strokeStyle = 'rgba(230, 215, 190, 0.4)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(fromX - perpX, fromY - perpY);
      ctx.lineTo(toX - perpX, toY - perpY);
      ctx.strokeStyle = 'rgba(230, 215, 190, 0.4)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    },
    [],
  );

  // Mouse/touch handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onStart = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      isDrawing.current = true;
      lastPos.current = getPos(e, canvas);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!isDrawing.current || !lastPos.current) return;
      const pos = getPos(e, canvas);
      drawStroke(lastPos.current.x, lastPos.current.y, pos.x, pos.y);
      lastPos.current = pos;
    };

    const onEnd = () => {
      isDrawing.current = false;
      lastPos.current = null;
    };

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('mouseleave', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);
    canvas.addEventListener('touchcancel', onEnd);

    return () => {
      canvas.removeEventListener('mousedown', onStart);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseup', onEnd);
      canvas.removeEventListener('mouseleave', onEnd);
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('touchcancel', onEnd);
    };
  }, [getPos, drawStroke]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) fillSandBackground(canvas);
  }, [fillSandBackground]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 1,
          position: 'relative',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            cursor: 'crosshair',
            touchAction: 'none',
          }}
        />
      </div>

      {/* Clear button */}
      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={handleClear}
          style={{
            padding: '8px 24px',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(255,255,255,0.15)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 500,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
          }}
        >
          Clear Canvas
        </button>
      </div>
    </div>
  );
}
