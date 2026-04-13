'use client';

/**
 * GuestLockOverlay — wraps content with a semi-transparent lock for guest users.
 * Shows the content greyed out underneath with a "Sign up" CTA on top.
 */

import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal } from '@/store/uiSlice';

interface Props {
  children: React.ReactNode;
}

export default function GuestLockOverlay({ children }: Props) {
  const dispatch = useAppDispatch();
  const isGuest = useAppSelector((s) => s.guest.isGuest);
  const language = useAppSelector((s) => s.settings.language);
  const isZh = language === 'zh-CN';

  if (!isGuest) return <>{children}</>;

  return (
    <div style={{ position: 'relative', minHeight: 200 }}>
      {/* Greyed out content underneath */}
      <div style={{ opacity: 0.35, pointerEvents: 'none', filter: 'grayscale(30%)' }}>
        {children}
      </div>
      {/* Lock overlay on top */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 10,
        background: 'rgba(255,255,255,0.5)',
        backdropFilter: 'blur(2px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        borderRadius: 12, gap: 8,
      }}>
        <div style={{ fontSize: '1.5rem' }}>🔒</div>
        <p style={{ fontSize: '0.85rem', color: '#4a5568', fontWeight: 600, margin: 0 }}>
          {isZh ? '注册后解锁' : 'Sign up to unlock'}
        </p>
        <button
          onClick={() => {
            dispatch(closeModal('settings'));
            window.location.href = '/login';
          }}
          style={{
            padding: '8px 24px', borderRadius: 8, border: 'none',
            background: '#6BA3D6', color: 'white',
            fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {isZh ? '立即注册' : 'Sign Up'}
        </button>
      </div>
    </div>
  );
}
