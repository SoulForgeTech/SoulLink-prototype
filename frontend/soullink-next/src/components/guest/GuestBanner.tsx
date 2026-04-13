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
    <>
      {/* Inject style to remove header bottom border-radius when guest banner is shown */}
      <style>{`.chat-header { border-bottom-left-radius: 0 !important; border-bottom-right-radius: 0 !important; box-shadow: none !important; }`}</style>
      <div
        style={{
          position: 'absolute',
          top: 'var(--chat-header-height, 72px)',
          left: 0,
          right: 0,
          zIndex: 19,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '5px 12px',
          /* Same glassmorphism as ChatHeader */
          background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%) padding-box, linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.08) 100%) border-box',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          /* Only bottom border-radius — flush with header top */
          borderRadius: '0 0 20px 20px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          fontSize: '0.68rem',
          color: 'rgba(255,255,255,0.8)',
          textShadow: '0 1px 3px rgba(0,0,0,0.25)',
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
    </>
  );
}
