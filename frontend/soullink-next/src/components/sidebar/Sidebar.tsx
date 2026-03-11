'use client';

/**
 * Left sidebar component.
 *
 * Contains:
 *   - Header: SoulLink logo (wave emoji) + language toggle + mobile close button
 *   - New Chat button (new-chat-btn liquid-glass-btn)
 *   - Scrollable conversation list
 *   - Bottom links: Personality Test, User Guide, Changelog, About & Feedback
 *   - User section: avatar, name, email, logout
 *
 * On mobile, slides in from the left with an overlay backdrop.
 * Uses sidebar glassmorphism style matching the original index.html.
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/store';
import { setSidebarOpen, openModal } from '@/store/uiSlice';
import { setCurrentId, addConversation } from '@/store/conversationsSlice';
import { clearMessages } from '@/store/chatSlice';
import { setLanguage } from '@/store/settingsSlice';
import { logout } from '@/store/authSlice';
import { resetTest, setRetake } from '@/store/personalitySlice';
import ConversationItem from './ConversationItem';
import { useT } from '@/hooks/useT';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { updateSettings } from '@/lib/api/user';
import { createConversation } from '@/lib/api/conversations';
import type { Language } from '@/types';

// ==================== Props ====================

interface SidebarProps {
  /** Callback when a conversation is deleted via the API. */
  onDeleteConversation: (id: string) => void;
  /** Callback when a conversation is renamed via the API. */
  onRenameConversation: (id: string, newTitle: string) => void;
}

// ==================== Component ====================

export default function Sidebar({
  onDeleteConversation,
  onRenameConversation,
}: SidebarProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const authFetch = useAuthFetch();
  const language = useAppSelector((s) => s.settings.language);
  const mobileOpen = useAppSelector((s) => s.ui.sidebar.mobileOpen);
  const conversations = useAppSelector((s) => s.conversations.items);
  const user = useAppSelector((s) => s.auth.user);

  const t = useT();

  // ---- Actions ----

  const handleCloseMobile = useCallback(() => {
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const handleNewChat = useCallback(async () => {
    dispatch(clearMessages());
    dispatch(setSidebarOpen(false));
    try {
      const { conversation } = await createConversation(authFetch);
      dispatch(addConversation(conversation));
      dispatch(setCurrentId(conversation.id));
    } catch {
      // API failed — fall back to null ID (backend will create on first message)
      dispatch(setCurrentId(null));
    }
  }, [dispatch, authFetch]);

  const handleToggleLanguage = useCallback(() => {
    const next: Language = language === 'en' ? 'zh-CN' : 'en';
    dispatch(setLanguage(next));
    // Sync language preference to backend
    updateSettings(authFetch, { language: next }).catch(() => {});
  }, [dispatch, language, authFetch]);

  const handleLogout = useCallback(() => {
    dispatch(logout());
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, [dispatch]);

  const handleOpenChangelog = useCallback(() => {
    dispatch(openModal({ modal: 'changelog' }));
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const handleOpenAbout = useCallback(() => {
    dispatch(openModal({ modal: 'about' }));
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const handleOpenPersonalityTest = useCallback(() => {
    dispatch(setSidebarOpen(false));
    // Reset personality state and mark as retake so onboarding stops after results
    // (questions → tarot → results → back to chat)
    dispatch(resetTest());
    dispatch(setRetake(true));
    router.push('/onboarding');
  }, [dispatch, router]);

  const handleOpenSettings = useCallback(() => {
    dispatch(openModal({ modal: 'settings' }));
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  // ---- User avatar ----
  const userInitial = user?.name?.[0]?.toUpperCase() || '?';
  const avatarColor = user?.avatar_color || '#6BA3D6';

  // ---- Render ----
  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 40,
          }}
          className="sidebar-mobile-overlay"
          onClick={handleCloseMobile}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}
        style={{
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        }}
      >
        {/* ---- Header ---- */}
        <div className="sidebar-header">
          <span className="sidebar-logo">{'\uD83D\uDCAB'}</span>
          <span className="sidebar-title">SoulLink</span>
          <button onClick={handleToggleLanguage} className="lang-toggle-btn"
            title={language === 'en' ? 'Switch to Chinese' : '\u5207\u6362\u5230\u82F1\u6587'}>
            {language === 'en' ? '\u4E2D\u6587' : 'EN'}
          </button>
          <button onClick={handleCloseMobile} className="sidebar-close-btn" aria-label="Close sidebar">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ---- New Chat button (direct flex child of sidebar for proper stretch) ---- */}
        <button
          onClick={handleNewChat}
          className="new-chat-btn liquid-glass-btn"
          style={{ position: 'relative', zIndex: 1 }}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('sidebar.newchat')}
        </button>

        {/* ---- Conversation list ---- */}
        <div
          className="conversations-list"
          style={{
            flex: 1,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {conversations.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: 'rgba(255,255,255,0.3)',
                fontSize: '0.8rem',
                paddingTop: 32,
                paddingBottom: 32,
              }}
            >
              {t('sidebar.no_conversations')}
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                onDelete={onDeleteConversation}
                onRename={onRenameConversation}
              />
            ))
          )}
        </div>

        {/* ---- Bottom links ---- */}
        <div
          style={{
            padding: '4px 12px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <SidebarLink icon={'\u2728'} label={t('sidebar.test')} onClick={handleOpenPersonalityTest} />
          <SidebarLink icon={'\uD83D\uDCD6'} label={t('sidebar.guide')} onClick={() => dispatch(setSidebarOpen(false))} />
          <SidebarLink icon={'\uD83D\uDCCB'} label={t('sidebar.changelog')} onClick={handleOpenChangelog} />
          <SidebarLink icon={'\uD83D\uDD14'} label={t('sidebar.about')} onClick={handleOpenAbout} />
        </div>

        {/* ---- User section / footer ---- */}
        <div
          style={{
            padding: 16,
            borderTop: '1px solid rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Avatar — matches original .user-avatar (40px, border, shadow) — click opens settings */}
          <div
            onClick={handleOpenSettings}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              backgroundColor: avatarColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#fff',
              flexShrink: 0,
              border: '2px solid rgba(255, 255, 255, 0.6)',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
              cursor: 'pointer',
            }}
          >
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.name}
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              userInitial
            )}
          </div>

          {/* Name & email — matches original .user-name / .user-email — click opens settings */}
          <div onClick={handleOpenSettings} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
            <div
              style={{
                fontSize: '0.9rem',
                fontWeight: 500,
                color: '#ffffff',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user?.name || 'Guest'}
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: 'rgba(255,255,255,0.6)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user?.email || ''}
            </div>
          </div>

          {/* Logout — matches original .logout-btn (styled text button) */}
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.9)',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              transition: 'all 0.2s',
            }}
            title={t('sidebar.logout')}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
            }}
          >
            {t('sidebar.logout')}
          </button>
        </div>
      </aside>

      {/* Add responsive override: on md+ screens use relative positioning */}
      <style>{`
        @media (min-width: 768px) {
          aside.sidebar {
            position: relative !important;
            z-index: 10 !important;
            transform: none !important;
          }
        }
        @media (max-width: 767.9px) {
          aside.sidebar {
            border-radius: 0 !important;
          }
        }
      `}</style>
    </>
  );
}

// ==================== Sidebar Link sub-component ====================

function SidebarLink({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 16px',
        color: 'rgba(255,255,255,0.6)',
        fontSize: 13,
        borderRadius: 8,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
      }}
    >
      <span style={{ marginRight: 8 }}>{icon}</span>
      {label}
    </button>
  );
}
