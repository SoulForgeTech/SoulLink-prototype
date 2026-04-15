'use client';

import { useState } from 'react';
import { useAppSelector } from '@/store';

interface ExpressionGuideBannerProps {
  onSetup: () => void;
}

export default function ExpressionGuideBanner({ onSetup }: ExpressionGuideBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const expressions = useAppSelector((s) => s.settings.characterExpressions);
  const isGuest = useAppSelector((s) => s.guest.isGuest);

  // Don't show if already has expressions or dismissed
  if (expressions?.videos || expressions?.idleVideos || dismissed) return null;

  return (
    <div style={{
      margin: '0 12px 8px',
      padding: '12px 16px',
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(124,77,255,0.15), rgba(68,138,255,0.1))',
      border: '1px solid rgba(124,77,255,0.2)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <span style={{ fontSize: 24 }}>✨</span>
      <div style={{ flex: 1 }}>
        <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: 0 }}>
          Bring your companion to life!
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, margin: '2px 0 0' }}>
          Create animated expressions for your character
        </p>
      </div>
      <button
        onClick={onSetup}
        style={{
          padding: '8px 14px',
          borderRadius: 10,
          border: 'none',
          background: '#7c4dff',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Create
      </button>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
          fontSize: 16, cursor: 'pointer', padding: '4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
