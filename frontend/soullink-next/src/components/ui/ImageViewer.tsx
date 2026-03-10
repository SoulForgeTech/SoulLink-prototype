'use client';

/**
 * Fullscreen image viewer overlay.
 *
 * Uses original CSS class: .image-viewer-overlay
 * Supports pinch/scroll zoom and pan (drag to move).
 * Click backdrop to close.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { close } from '@/store/imageViewerSlice';

export default function ImageViewer() {
  const dispatch = useAppDispatch();
  const { isOpen, currentSrc } = useAppSelector((state) => state.imageViewer);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });

  // Reset state when image changes
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
  }, [isOpen, currentSrc]);

  // Scroll wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => {
      const next = prev - e.deltaY * 0.002;
      return Math.min(Math.max(next, 0.5), 5);
    });
  }, []);

  // Mouse drag for pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale <= 1) return;
      e.preventDefault();
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      translateStart.current = { ...translate };
    },
    [scale, translate],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      setTranslate({
        x: translateStart.current.x + (e.clientX - dragStart.current.x),
        y: translateStart.current.y + (e.clientY - dragStart.current.y),
      });
    },
    [dragging],
  );

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // Touch events for pinch zoom
  const lastTouchDist = useRef<number | null>(null);
  const touchStart = useRef({ x: 0, y: 0 });

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
      } else if (e.touches.length === 1 && scale > 1) {
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        translateStart.current = { ...translate };
        setDragging(true);
      }
    },
    [scale, translate],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && lastTouchDist.current !== null) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const delta = dist / lastTouchDist.current;
        lastTouchDist.current = dist;
        setScale((prev) => Math.min(Math.max(prev * delta, 0.5), 5));
      } else if (e.touches.length === 1 && dragging) {
        setTranslate({
          x: translateStart.current.x + (e.touches[0].clientX - touchStart.current.x),
          y: translateStart.current.y + (e.touches[0].clientY - touchStart.current.y),
        });
      }
    },
    [dragging],
  );

  const handleTouchEnd = useCallback(() => {
    lastTouchDist.current = null;
    setDragging(false);
  }, []);

  // Close on backdrop click (not on image drag)
  const didDrag = useRef(false);
  const handleBackdropClick = useCallback(() => {
    if (!didDrag.current) {
      dispatch(close());
    }
    didDrag.current = false;
  }, [dispatch]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch(close());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, dispatch]);

  if (!isOpen || !currentSrc) return null;

  return (
    <div
      className="image-viewer-overlay active"
      style={{
        cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-out',
      }}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
      onMouseDown={(e) => {
        if (scale > 1) {
          handleMouseDown(e);
          didDrag.current = false;
        }
      }}
      onMouseMove={(e) => {
        if (dragging) {
          didDrag.current = true;
          handleMouseMove(e);
        }
      }}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={currentSrc}
        alt="Full view"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
          userSelect: 'none',
        }}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
