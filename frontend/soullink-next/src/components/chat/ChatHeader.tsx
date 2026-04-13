'use client';

/**
 * Chat header bar.
 *
 * Shows the companion avatar, name (clickable to rename), online status,
 * model indicator badge, and action buttons for ambient sound, games,
 * and background picker.
 *
 * On mobile, includes a hamburger menu button to open the sidebar.
 * Uses chat-header glassmorphism class from globals.css.
 *
 * All inline styles match the original monolithic index.html CSS values exactly.
 */

import { useCallback, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { toggleSidebar, openModal, togglePanel } from '@/store/uiSlice';
import { useT } from '@/hooks/useT';

// ==================== Styles (matching original CSS) ====================

/** .chat-header positioning + layout + glassmorphism (inline to avoid Turbopack stripping)
 *  NOTE: padding/gap/borderRadius are NOT set here — they come from globals.css
 *  media queries so mobile can override them without !important battles.
 */
const headerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 20,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  /* Glassmorphism — duplicated inline to bypass Turbopack CSS transform issues */
  border: '1px solid transparent',
  background: `linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.05) 100%) padding-box, linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.25) 20%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.04) 65%, rgba(255,255,255,0.10) 85%, rgba(255,255,255,0.18) 100%) border-box`,
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  boxShadow: '0 2px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.12)',
};

/** All direct children need relative z-index to sit above the ::after overlay */
const aboveOverlay: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
};

/** .companion-avatar — size controlled by CSS class for responsive overrides */
const avatarStyle: React.CSSProperties = {
  borderRadius: '50%',
  objectFit: 'cover',
  border: '3px solid rgba(255,255,255,0.9)',
  boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
  cursor: 'pointer',
  transition: 'all 0.2s',
  flexShrink: 0,
};

/** .companion-avatar (initial letter fallback) */
const avatarPlaceholderStyle: React.CSSProperties = {
  ...avatarStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--primary-color, #6BA3D6)',
  color: 'white',
  fontSize: '1rem',
  fontWeight: 600,
};

/** Companion name — matches original .companion-info h2
 *  fontSize not set here — controlled by CSS .companion-info h2 for responsive.
 */
const nameStyle: React.CSSProperties = {
  fontSize: '1.15rem',
  fontWeight: 600,
  color: '#2d3748',
  textShadow: '0 1px 3px rgba(255, 255, 255, 0.8)',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  textAlign: 'left',
  lineHeight: 1.3,
};

/** Status container */
const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 2,
};

/** Green dot — matches original .status-dot */
const statusDotStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#4ade80',
  boxShadow: '0 0 10px rgba(74, 222, 128, 0.8)',
  animation: 'statusPulse 2s ease-in-out infinite',
};

/** Status text — matches original .companion-status */
const statusTextStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  color: 'rgba(255,255,255,0.75)',
};

/** Model indicator — matches original .model-indicator */
const modelBadgeStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  padding: '2px 8px',
  background: 'rgba(255,255,255,0.2)',
  color: 'rgba(255,255,255,0.9)',
  borderRadius: 10,
  marginLeft: 6,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
  border: 'none',
};

/** Right-side action buttons container */
const actionsContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  ...aboveOverlay,
};

/** Each action button: bg-picker-btn style — padding/borderRadius via CSS for responsive */
const actionBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.2)',
  border: 'none',
  cursor: 'pointer',
  color: 'white',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s',
  flexShrink: 0,
};

/** Mobile menu button — no background box, just a clean icon.
 *  display is NOT set here: CSS .mobile-menu-btn controls visibility
 *  (none on desktop, flex on mobile via media query).
 */
const menuBtnStyle: React.CSSProperties = {
  ...aboveOverlay,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'white',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s',
  flexShrink: 0,
  padding: 0,
};

// ==================== Component ====================

export default function ChatHeader() {
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.settings.language);
  const companionName = useAppSelector((s) => s.settings.companionName);
  const companionAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const model = useAppSelector((s) => s.settings.model);

  const t = useT();

  // ---- Derive a short model display name ----
  const modelBadge = (() => {
    if (!model) return '';
    if (model.includes('gemini')) return 'Gemini';
    if (model.includes('grok')) return 'Grok';
    if (model.includes('claude')) return 'Claude';
    if (model.includes('gpt')) return 'GPT';
    return model.split('-')[0] || model;
  })();

  // ---- Hover states for action buttons ----
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [avatarHovered, setAvatarHovered] = useState(false);

  // ---- Actions ----
  const handleMenuClick = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const handleAvatarClick = useCallback(() => {
    dispatch(openModal({ modal: 'companionAvatar' }));
  }, [dispatch]);

  const handleNameClick = useCallback(() => {
    dispatch(openModal({ modal: 'rename' }));
  }, [dispatch]);

  const handleModelClick = useCallback(() => {
    dispatch(openModal({ modal: 'settings', tab: 'advanced' }));
  }, [dispatch]);

  const handleAmbientClick = useCallback(() => {
    dispatch(togglePanel('ambientSound'));
  }, [dispatch]);

  const handleGamesClick = useCallback(() => {
    dispatch(togglePanel('games'));
  }, [dispatch]);

  const handleBackgroundClick = useCallback(() => {
    dispatch(togglePanel('backgroundPicker'));
  }, [dispatch]);

  // ---- Dynamic avatar style for hover ----
  const currentAvatarStyle: React.CSSProperties = avatarHovered
    ? { ...avatarStyle, transform: 'scale(1.08)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }
    : avatarStyle;

  const currentAvatarPlaceholderStyle: React.CSSProperties = avatarHovered
    ? { ...avatarPlaceholderStyle, transform: 'scale(1.08)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }
    : avatarPlaceholderStyle;

  return (
    <header className="chat-header" style={headerStyle}>
      {/* Mobile menu button */}
      <button
        onClick={handleMenuClick}
        style={{
          ...menuBtnStyle,
          display: undefined, // let CSS media query control
          color: hoveredBtn === 'menu' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
        }}
        className="mobile-menu-btn"
        onMouseEnter={() => setHoveredBtn('menu')}
        onMouseLeave={() => setHoveredBtn(null)}
        aria-label="Open menu"
      >
        <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Companion avatar */}
      <div
        style={aboveOverlay}
        onClick={handleAvatarClick}
        onMouseEnter={() => setAvatarHovered(true)}
        onMouseLeave={() => setAvatarHovered(false)}
      >
        {companionAvatar ? (
          <img
            src={companionAvatar}
            alt={companionName || 'Companion'}
            className="companion-avatar"
            width={50}
            height={50}
            style={currentAvatarStyle}
          />
        ) : (
          <div className="companion-avatar" style={currentAvatarPlaceholderStyle}>
            {(companionName || 'AI')[0]}
          </div>
        )}
      </div>

      {/* Companion info */}
      <div style={{ ...aboveOverlay, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={handleNameClick}
            style={nameStyle}
          >
            {companionName || 'AI Companion'}
          </button>

          {/* Model badge */}
          {modelBadge && (
            <button
              onClick={handleModelClick}
              style={modelBadgeStyle}
            >
              {modelBadge}
            </button>
          )}
        </div>

        {/* Online status */}
        <div style={statusRowStyle}>
          <span style={statusDotStyle} />
          <span style={statusTextStyle}>{t('chat.online')}</span>
        </div>
      </div>

      {/* Right side action buttons */}
      <div style={actionsContainerStyle}>
        {/* Ambient Sound (music note) — original Feather icon */}
        <ActionButton
          id="ambient"
          label="Ambient Sound"
          hoveredBtn={hoveredBtn}
          setHoveredBtn={setHoveredBtn}
          onClick={handleAmbientClick}
          isFirst
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </ActionButton>

        {/* Games — original game controller icon */}
        <ActionButton
          id="games"
          label="Games"
          hoveredBtn={hoveredBtn}
          setHoveredBtn={setHoveredBtn}
          onClick={handleGamesClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <line x1="6" y1="12" x2="10" y2="12" />
            <line x1="8" y1="10" x2="8" y2="14" />
            <circle cx="15" cy="11" r="1" />
            <circle cx="18" cy="13" r="1" />
          </svg>
        </ActionButton>

        {/* Background picker — original image/landscape icon */}
        <ActionButton
          id="bg"
          label="Background"
          hoveredBtn={hoveredBtn}
          setHoveredBtn={setHoveredBtn}
          onClick={handleBackgroundClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </ActionButton>
      </div>
    </header>
  );
}

// ==================== Guest Banner (inline, below header) ====================

function GuestBannerInline() {
  const isGuest = useAppSelector((s) => s.guest.isGuest);
  const usage = useAppSelector((s) => s.guest.usage);
  const limits = useAppSelector((s) => s.guest.limits);
  const language = useAppSelector((s) => s.settings.language);

  if (!isGuest) return null;
  const isZh = language === 'zh-CN';

  return (
    <div className="chat-header-guest-banner" style={{
      position: 'absolute',
      top: 'var(--chat-header-height, 72px)',
      left: 0, right: 0,
      zIndex: 19,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: '5px 12px',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 100%) padding-box, linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.08) 100%) border-box',
      backdropFilter: 'blur(40px) saturate(180%)',
      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      fontSize: '0.7rem',
      color: 'rgba(255,255,255,0.8)',
      textShadow: '0 1px 3px rgba(0,0,0,0.3)',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 600 }}>{isZh ? '🎁 试用模式' : '🎁 Trial'}</span>
      <span style={{ opacity: 0.8 }}>
        {isZh ? '文字' : 'Text'} {usage.text}/{limits.text}
        <span style={{ opacity: 0.5, marginLeft: 2 }}>({isZh ? '2h重置' : '2h reset'})</span>
      </span>
      <span style={{ opacity: 0.8 }}>{isZh ? '语音' : 'Voice'} {usage.voice}/{limits.voice}</span>
      <span style={{ opacity: 0.8 }}>{isZh ? '图片' : 'Image'} {usage.image}/{limits.image}</span>
      <button onClick={() => { window.location.href = '/login'; }} style={{
        padding: '2px 10px', borderRadius: 6, border: 'none',
        background: '#6BA3D6', color: 'white', fontSize: '0.66rem',
        fontWeight: 600, cursor: 'pointer',
      }}>{isZh ? '注册解锁' : 'Sign Up'}</button>
    </div>
  );
}

// Export for use by parent — render as sibling of ChatHeader in the chat page
export { GuestBannerInline };

// ==================== Action button sub-component ====================

function ActionButton({
  id,
  label,
  hoveredBtn,
  setHoveredBtn,
  onClick,
  children,
  isFirst = false,
}: {
  id: string;
  label: string;
  hoveredBtn: string | null;
  setHoveredBtn: (id: string | null) => void;
  onClick: () => void;
  children: React.ReactNode;
  isFirst?: boolean;
}) {
  const isHovered = hoveredBtn === id;

  return (
    <button
      onClick={onClick}
      className="bg-picker-btn"
      style={{
        ...actionBtnStyle,
        ...(isFirst ? { marginLeft: 'auto' } : {}),
        background: isHovered ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.2)',
        transform: isHovered ? 'scale(1.05)' : 'none',
      }}
      onMouseEnter={() => setHoveredBtn(id)}
      onMouseLeave={() => setHoveredBtn(null)}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
