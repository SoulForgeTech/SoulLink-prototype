'use client';

/**
 * Image cropper modal with circular crop mask.
 *
 * Features (matching original index.html):
 *   - Drag to pan
 *   - Scroll wheel to zoom
 *   - Pinch-to-zoom on touch devices
 *   - Frosted glass overlay background
 *   - Circular crop mask with export to JPEG blob
 *
 * Reads imageSrc from store (ui.cropImageSrc).
 * On confirm, exports cropped circular image as blob URL
 * and dispatches setCroppedAvatarUrl.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal, setCroppedAvatarUrl } from '@/store/uiSlice';

// Dynamic crop radius: 84% of half the canvas size (8% margin from each edge)
// Matches the original index.html which uses canvasSize * 0.42
function getCropRadius(canvasSize: number): number {
  return Math.floor(canvasSize * 0.42);
}

export default function CropModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((s) => s.ui.modals.crop);
  const imageSrc = useAppSelector((s) => s.ui.cropImageSrc);
  const language = useAppSelector((s) => s.settings.language);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(100);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState(300);

  // Pinch zoom refs
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(100);

  const isZh = language === 'zh-CN';

  // Helper: clamp zoom to [50, 300] — allow zooming out so image can be smaller than circle
  const clampZoom = useCallback((val: number) => Math.max(50, Math.min(300, Math.round(val))), []);

  // Compute canvas size from container
  const updateCanvasSize = useCallback(() => {
    if (containerRef.current) {
      const w = containerRef.current.clientWidth;
      setCanvasSize(w || 300);
    }
  }, []);

  // Load image when modal opens
  useEffect(() => {
    if (!isOpen || !imageSrc) return;

    setZoom(100);
    setOffset({ x: 0, y: 0 });
    setImageLoaded(false);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImageLoaded(true);
      requestAnimationFrame(updateCanvasSize);
    };
    img.src = imageSrc;
  }, [isOpen, imageSrc, updateCanvasSize]);

  // Draw image on canvas
  const drawImage = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvasSize;
    canvas.width = size;
    canvas.height = size;

    ctx.clearRect(0, 0, size, size);

    const scale = zoom / 100;
    const aspect = img.width / img.height;
    let drawW: number, drawH: number;

    if (aspect > 1) {
      drawH = size * scale;
      drawW = drawH * aspect;
    } else {
      drawW = size * scale;
      drawH = drawW / aspect;
    }

    const drawX = (size - drawW) / 2 + offset.x;
    const drawY = (size - drawH) / 2 + offset.y;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }, [zoom, offset, canvasSize]);

  // Draw overlay with circular mask — brighter circle, lighter outer dim
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const size = canvasSize;
    overlay.width = size;
    overlay.height = size;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const radius = getCropRadius(size);

    ctx.clearRect(0, 0, size, size);
    // Lighter overlay outside the circle (was 0.55, now 0.4)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, size, size);

    // Cut out the circle (transparent center)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.fill();

    // Bright white circle border
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
  }, [canvasSize]);

  // Redraw when zoom/offset/size changes
  useEffect(() => {
    if (imageLoaded) {
      drawImage();
      drawOverlay();
    }
  }, [imageLoaded, drawImage, drawOverlay]);

  // ---- Mouse handlers for pan ----
  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  }, [offset]);

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: offsetStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // ---- Scroll wheel zoom (matches original: deltaY → ±8%) ----
  const handleWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -8 : 8;
    setZoom((prev) => clampZoom(prev + delta));
  }, [clampZoom]);

  // ---- Touch handlers for pan + pinch zoom ----
  const handleTouchStart = useCallback((e: ReactTouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartZoom.current = zoom;
      setDragging(false);
    } else if (e.touches.length === 1) {
      // Single finger pan
      setDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      offsetStart.current = { ...offset };
    }
  }, [offset, zoom]);

  const handleTouchMove = useCallback((e: ReactTouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch move
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const newZoom = pinchStartZoom.current * (dist / pinchStartDist.current);
      setZoom(clampZoom(newZoom));
    } else if (dragging && e.touches.length === 1) {
      // Single finger pan
      setOffset({
        x: offsetStart.current.x + (e.touches[0].clientX - dragStart.current.x),
        y: offsetStart.current.y + (e.touches[0].clientY - dragStart.current.y),
      });
    }
  }, [dragging, clampZoom]);

  const handleTouchEnd = useCallback(() => setDragging(false), []);

  const handleClose = useCallback(() => {
    dispatch(closeModal('crop'));
  }, [dispatch]);

  // Export cropped circular image
  const handleConfirm = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;

    const size = canvasSize;
    const radius = getCropRadius(size);
    const exportSize = radius * 2;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportSize;
    exportCanvas.height = exportSize;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // Clip to circle
    ctx.beginPath();
    ctx.arc(exportSize / 2, exportSize / 2, radius, 0, Math.PI * 2);
    ctx.clip();

    // Calculate draw params matching the canvas
    const scale = zoom / 100;
    const aspect = img.width / img.height;
    let drawW: number, drawH: number;
    if (aspect > 1) {
      drawH = size * scale;
      drawW = drawH * aspect;
    } else {
      drawW = size * scale;
      drawH = drawW / aspect;
    }

    const drawX = (size - drawW) / 2 + offset.x;
    const drawY = (size - drawH) / 2 + offset.y;

    const cropLeft = size / 2 - radius;
    const cropTop = size / 2 - radius;

    ctx.drawImage(img, drawX - cropLeft, drawY - cropTop, drawW, drawH);

    exportCanvas.toBlob(
      (blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          dispatch(setCroppedAvatarUrl(url));
          handleClose();
        }
      },
      'image/jpeg',
      0.9,
    );
  }, [zoom, offset, canvasSize, dispatch, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="crop-modal-overlay active"
      onClick={handleClose}
      style={{
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div
        className="crop-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)',
        }}
      >
        {/* Header */}
        <div className="crop-modal-header">
          <span>{isZh ? '\u88C1\u526A\u56FE\u7247' : 'Crop Image'}</span>
          <button onClick={handleClose}>&#10005;</button>
        </div>

        {/* Canvas container */}
        <div
          ref={containerRef}
          className="crop-canvas-container"
          style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <canvas ref={canvasRef} />
          <canvas ref={overlayRef} style={{ pointerEvents: 'none' }} />
        </div>

        {/* Zoom controls */}
        <div className="crop-controls">
          <input
            type="range"
            min={50}
            max={300}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <span className="crop-zoom-label">{zoom}%</span>
        </div>

        {/* Footer buttons */}
        <div className="crop-modal-btns">
          <button className="crop-btn-cancel" onClick={handleClose}>
            {isZh ? '\u53D6\u6D88' : 'Cancel'}
          </button>
          <button
            className="crop-btn-confirm"
            onClick={handleConfirm}
            style={{ opacity: imageLoaded ? 1 : 0.4 }}
          >
            {isZh ? '\u786E\u8BA4' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
