'use client';

import { useEffect, useState } from 'react';

/**
 * Toast notification component.
 * Auto-dismisses after 3.5 seconds by default.
 * Positioned at bottom center with fade in/out animation.
 *
 * All props are optional with sensible defaults so the component
 * can be rendered without any props (self-contained).
 */
export default function Toast({
  message = '',
  visible = false,
  onDismiss = () => {},
  duration = 3500,
}: {
  message?: string;
  visible?: boolean;
  onDismiss?: () => void;
  duration?: number;
} = {}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => setShow(true));
      const timer = setTimeout(() => {
        setShow(false);
        setTimeout(onDismiss, 300); // Wait for fade-out before removing
      }, duration);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '32px',
        left: '50%',
        zIndex: 9999,
        pointerEvents: 'none',
        transform: 'translateX(-50%)',
      }}
    >
      <div
        style={{
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '12px',
          paddingBottom: '12px',
          borderRadius: '12px',
          fontSize: '0.875rem',
          fontWeight: 500,
          color: 'white',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
          transition: 'all 0.3s',
          pointerEvents: 'auto',
          background: 'rgba(30, 30, 50, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.15)',
          opacity: show ? 1 : 0,
          transform: show ? 'translateY(0)' : 'translateY(12px)',
        }}
      >
        {message}
      </div>
    </div>
  );
}
