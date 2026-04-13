'use client';

/**
 * Guest mode banner — attached below ChatHeader.
 *
 * Design: header has no bottom border-radius when guest mode is active.
 * Banner sits flush below, with its own bottom border-radius,
 * creating one seamless rounded container visually.
 *
 * Must be rendered as a sibling right after ChatHeader in the page,
 * with absolute positioning matching header's width.
 */

import { useAppSelector } from '@/store';

export default function GuestBanner() {
  const isGuest = useAppSelector((s) => s.guest.isGuest);
  const usage = useAppSelector((s) => s.guest.usage);
  const limits = useAppSelector((s) => s.guest.limits);
  const language = useAppSelector((s) => s.settings.language);

  if (!isGuest) return null;

  const isZh = language === 'zh-CN';

  return (
      <div
        style={{
          position: 'absolute',
          /* Push up to fully overlap header's bottom rounded area */
          top: 'calc(var(--chat-header-height, 72px) - 28px)',
          left: -2,
          right: -2,
          zIndex: 15, /* Below header (20) so header rounds show on top */
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '34px 16px 6px',  /* Extra top padding to account for overlap */
          background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%) padding-box, linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 100%) border-box',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderRadius: '0 0 28px 28px',
          border: '1px solid rgba(255,255,255,0.15)',
          borderTop: 'none',
          boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
          fontSize: '0.68rem',
          color: 'rgba(255,255,255,0.85)',
          textShadow: '0 1px 3px rgba(0,0,0,0.2)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600 }}>{isZh ? '🎁 体验中' : '🎁 Trial'}</span>
        <span style={{ opacity: 0.8 }}>
          {isZh
            ? `消息 ${limits.text - usage.text} · 语音 ${limits.voice - usage.voice} · 图片 ${limits.image - usage.image}`
            : `Text ${limits.text - usage.text} · Voice ${limits.voice - usage.voice} · Image ${limits.image - usage.image}`}
        </span>
        <span style={{ opacity: 0.5, fontSize: '0.6rem' }}>
          {isZh ? '注册免费解锁全部功能' : 'Sign up to unlock all'}
        </span>
        <button onClick={() => { window.location.href = '/login'; }} style={{
          padding: '2px 10px', borderRadius: 5, border: 'none',
          background: 'rgba(107,163,214,0.9)', color: 'white', fontSize: '0.62rem',
          fontWeight: 600, cursor: 'pointer',
        }}>{isZh ? '免费注册' : 'Sign Up'}</button>
      </div>
  );
}
