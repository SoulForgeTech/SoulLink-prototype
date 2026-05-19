'use client';

/**
 * Single conversation item in the sidebar list.
 *
 * Shows the conversation title and a truncated last message preview.
 * Active conversation is highlighted. Supports right-click / long-press
 * context menu for rename and delete operations.
 */

import { useState, useCallback, useRef, type MouseEvent, type TouchEvent } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { setCurrentId, removeConversation, updateConversation } from '@/store/conversationsSlice';
import { clearMessages, setMessages } from '@/store/chatSlice';
import { setSidebarOpen } from '@/store/uiSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useT } from '@/hooks/useT';
import { getConversation } from '@/lib/api/conversations';
import type { Conversation } from '@/types';

interface ConversationItemProps {
  conversation: Conversation;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
}

export default function ConversationItem({
  conversation,
  onDelete,
  onRename,
}: ConversationItemProps) {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const t = useT();
  const currentId = useAppSelector((s) => s.conversations.currentId);
  const isActive = currentId === conversation.id;

  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);

  // ---- Click to select + load messages from API ----
  const handleClick = useCallback(async () => {
    if (isRenaming) return;
    if (currentId === conversation.id) return; // already selected
    dispatch(clearMessages());
    dispatch(setCurrentId(conversation.id));
    // Close sidebar on mobile after selection.
    dispatch(setSidebarOpen(false));
    // Load messages from API
    try {
      const data = await getConversation(authFetch, conversation.id);
      dispatch(setMessages(data.messages || []));
    } catch (err) {
      console.error('Failed to load conversation messages:', err);
    }
  }, [dispatch, authFetch, conversation.id, isRenaming, currentId]);

  // ---- Right-click context menu ----
  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setMenuPos({ x: e.clientX, y: e.clientY });
      setShowMenu(true);
    },
    [],
  );

  // ---- Always-visible ⋯ menu button (so delete is discoverable) ----
  const handleMenuButtonClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setMenuPos({ x: e.clientX, y: e.clientY });
      setShowMenu(true);
    },
    [],
  );

  // ---- Long press for mobile ----
  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      longPressTimer.current = setTimeout(() => {
        const touch = e.touches[0];
        setMenuPos({ x: touch.clientX, y: touch.clientY });
        setShowMenu(true);
      }, 500);
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // ---- Context menu actions ----
  const handleRenameStart = useCallback(() => {
    setShowMenu(false);
    setIsRenaming(true);
    setRenameValue(conversation.title);
  }, [conversation.title]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.id, trimmed);
      dispatch(updateConversation({ id: conversation.id, title: trimmed }));
    }
    setIsRenaming(false);
  }, [renameValue, conversation.id, conversation.title, onRename, dispatch]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleRenameSubmit();
      } else if (e.key === 'Escape') {
        setIsRenaming(false);
      }
    },
    [handleRenameSubmit],
  );

  const handleDelete = useCallback(() => {
    setShowMenu(false);
    onDelete(conversation.id);
    dispatch(removeConversation(conversation.id));
  }, [conversation.id, onDelete, dispatch]);

  // ---- Close menu when clicking outside ----
  const handleMenuBackdropClick = useCallback(() => {
    setShowMenu(false);
  }, []);

  // Truncate the last message to a reasonable preview length.
  const lastMessagePreview = conversation.last_message
    ? conversation.last_message.length > 50
      ? conversation.last_message.slice(0, 50) + '...'
      : conversation.last_message
    : '';

  return (
    <>
      <div
        ref={itemRef}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          paddingLeft: '12px',
          paddingRight: '36px', // room for the ⋯ button
          paddingTop: '10px',
          paddingBottom: '10px',
          borderRadius: '12px',
          cursor: 'pointer',
          transition: 'all 0.2s',
          userSelect: 'none',
          background: isActive ? 'rgba(184, 49, 47, 0.10)' : 'transparent',
          boxShadow: isActive ? 'inset 2px 0 0 var(--seal)' : 'none',
        }}
        onMouseEnter={(e) => {
          setIsHovered(true);
          if (!isActive) {
            e.currentTarget.style.background = 'rgba(26, 26, 28, 0.05)';
          }
        }}
        onMouseLeave={(e) => {
          setIsHovered(false);
          if (!isActive) {
            e.currentTarget.style.background = 'transparent';
          }
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.6)',
              color: 'var(--ink)',
              fontSize: '0.875rem',
              borderRadius: '6px',
              paddingLeft: '8px',
              paddingRight: '8px',
              paddingTop: '4px',
              paddingBottom: '4px',
              border: '1px solid var(--ink-line)',
              outline: 'none',
            }}
          />
        ) : (
          <>
            <span style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {conversation.title || 'New Chat'}
            </span>
            {lastMessagePreview && (
              <span style={{
                fontSize: '0.75rem',
                color: 'var(--ink-faint)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {lastMessagePreview}
              </span>
            )}
          </>
        )}

        {/* ⋯ menu trigger — always present so Rename/Delete are discoverable.
            Subtle by default (opacity 0.4), prominent on row hover or while
            menu is open. Right-click + long-press still work as before. */}
        {!isRenaming && (
          <button
            type="button"
            onClick={handleMenuButtonClick}
            aria-label={t('chat.more_actions')}
            title={t('chat.more_actions')}
            style={{
              position: 'absolute',
              top: '50%',
              right: '8px',
              transform: 'translateY(-50%)',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              border: 'none',
              background: 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--ink-soft)',
              opacity: showMenu || isHovered ? 1 : 0.4,
              transition: 'opacity 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(26, 26, 28, 0.10)';
              e.currentTarget.style.color = 'var(--ink)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--ink-soft)';
            }}
          >
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        )}
      </div>

      {/* Context menu — paper material per CLAUDE.md (.diary-paper-panel,
          no fork). Tokens (--ink / --seal) resolve via the .diary-scope
          on #app. */}
      {showMenu && (
        <>
          {/* Invisible backdrop to close menu */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
            onClick={handleMenuBackdropClick}
          />
          <div
            className="diary-paper-panel"
            style={{
              position: 'fixed',
              zIndex: 51,
              minWidth: '160px',
              paddingTop: '4px',
              paddingBottom: '4px',
              borderRadius: 'var(--r-md)',
              left: `${menuPos.x}px`,
              top: `${menuPos.y}px`,
              transform: 'translate(-10%, 0)',
            }}
          >
            <button
              style={{
                width: '100%',
                textAlign: 'left',
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '8px',
                paddingBottom: '8px',
                fontSize: '0.875rem',
                color: 'var(--ink)',
                transition: 'background 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(26, 26, 28, 0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onClick={handleRenameStart}
            >
              <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {t('chat.rename')}
            </button>
            <button
              style={{
                width: '100%',
                textAlign: 'left',
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '8px',
                paddingBottom: '8px',
                fontSize: '0.875rem',
                color: 'var(--seal)',
                transition: 'background 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184, 49, 47, 0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onClick={handleDelete}
            >
              <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {t('chat.delete')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
