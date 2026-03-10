'use client';

/**
 * Glass click ripple effect — matches the original index.html IIFE.
 *
 * Attaches a global mousedown/touchstart listener that spawns a radial-gradient
 * ripple on any glass element (.chat-header, .sidebar, .input-wrapper,
 * .new-chat-btn, .send-btn, .modal-btn.primary, .liquid-glass-btn).
 *
 * Mount this component once near the root layout.
 */

import { useEffect } from 'react';

const GLASS_SELECTOR =
  '.chat-header, .sidebar, .input-wrapper, .new-chat-btn, .send-btn, .modal-btn.primary, .liquid-glass-btn';

function spawnRipple(e: MouseEvent | TouchEvent) {
  const target = e.target as HTMLElement;
  const panel = target.closest(GLASS_SELECTOR) as HTMLElement | null;
  if (!panel) return;

  const rect = panel.getBoundingClientRect();

  let clientX: number;
  let clientY: number;

  if ('touches' in e && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else if ('clientX' in e) {
    clientX = e.clientX;
    clientY = e.clientY;
  } else {
    clientX = rect.left + rect.width / 2;
    clientY = rect.top + rect.height / 2;
  }

  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const ripple = document.createElement('div');
  ripple.className = 'glass-ripple';
  Object.assign(ripple.style, {
    position: 'absolute',
    left: x + 'px',
    top: y + 'px',
    width: '0',
    height: '0',
    borderRadius: '50%',
    background:
      'radial-gradient(circle, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 40%, transparent 70%)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: '2',
    opacity: '1',
  });

  // Ensure panel can contain absolute child
  const pos = getComputedStyle(panel).position;
  if (pos === 'static') panel.style.position = 'relative';
  const prevOverflow = panel.style.overflow;
  panel.style.overflow = 'hidden';
  panel.appendChild(ripple);

  // Animate: expand + fade
  const size = Math.max(rect.width, rect.height) * 2;
  const anim = ripple.animate(
    [
      { width: '0px', height: '0px', opacity: 0.8 },
      { width: size + 'px', height: size + 'px', opacity: 0 },
    ],
    {
      duration: 1800,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards',
    },
  );

  anim.onfinish = () => {
    ripple.remove();
    if (prevOverflow !== undefined) panel.style.overflow = prevOverflow;
  };
}

export default function GlassRipple() {
  useEffect(() => {
    document.addEventListener('mousedown', spawnRipple);
    document.addEventListener('touchstart', spawnRipple, { passive: true });

    return () => {
      document.removeEventListener('mousedown', spawnRipple);
      document.removeEventListener('touchstart', spawnRipple);
    };
  }, []);

  return null;
}
