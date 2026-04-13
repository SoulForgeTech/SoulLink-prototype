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
        gap: 12,
        padding: '6px 16px',
        background: 'rgba(107, 163, 214, 0.1)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(107, 163, 214, 0.15)',
        fontSize: '0.75rem',
        color: '#4a5568',
        flexWrap: 'wrap',
      }}
    >
      <span>
        {isZh ? '🎁 试用模式' : '🎁 Trial Mode'}
      </span>
      <span style={{ color: '#718096' }}>
        {isZh ? '文字' : 'Text'} {usage.text}/{limits.text}
      </span>
      <span style={{ color: '#718096' }}>
        {isZh ? '语音' : 'Voice'} {usage.voice}/{limits.voice}
      </span>
      <span style={{ color: '#718096' }}>
        {isZh ? '图片' : 'Image'} {usage.image}/{limits.image}
      </span>
      <button
        onClick={() => dispatch(openUpgradeModal('feature_locked'))}
        style={{
          padding: '3px 12px',
          borderRadius: '6px',
          border: 'none',
          background: '#6BA3D6',
          color: 'white',
          fontSize: '0.7rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {isZh ? '立即注册' : 'Sign Up'}
      </button>
    </div>
  );
}
