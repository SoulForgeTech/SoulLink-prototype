'use client';

/**
 * Guest mode banner — shown at top of chat area.
 * Displays usage counters and a register CTA.
 */

import { useAppSelector, useAppDispatch } from '@/store';
import { openUpgradeModal } from '@/store/guestSlice';

export default function GuestBanner() {
  const dispatch = useAppDispatch();
  const isGuest = useAppSelector((s) => s.guest.isGuest);
  const usage = useAppSelector((s) => s.guest.usage);
  const limits = useAppSelector((s) => s.guest.limits);
  const language = useAppSelector((s) => s.settings.language);

  if (!isGuest) return null;

  const isZh = language === 'zh-CN';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '8px 16px',
        margin: '8px 12px 0',
        background: 'rgba(30, 40, 60, 0.65)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '12px',
        fontSize: '0.78rem',
        color: 'rgba(255, 255, 255, 0.9)',
        flexWrap: 'wrap',
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {isZh ? '🎁 试用模式' : '🎁 Trial Mode'}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.7)' }}>
        {isZh ? '文字' : 'Text'} {usage.text}/{limits.text}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.7)' }}>
        {isZh ? '语音' : 'Voice'} {usage.voice}/{limits.voice}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.7)' }}>
        {isZh ? '图片' : 'Image'} {usage.image}/{limits.image}
      </span>
      <button
        onClick={() => dispatch(openUpgradeModal('feature_locked'))}
        style={{
          padding: '4px 14px',
          borderRadius: '8px',
          border: 'none',
          background: '#6BA3D6',
          color: 'white',
          fontSize: '0.72rem',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(107,163,214,0.3)',
        }}
      >
        {isZh ? '立即注册' : 'Sign Up'}
      </button>
    </div>
  );
}
