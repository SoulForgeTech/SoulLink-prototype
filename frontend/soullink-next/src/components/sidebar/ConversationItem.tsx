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
  const currentId = useAppSelector((s) => s.conversations.currentId);
  const isActive = currentId === conversation.id;

  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
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
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          paddingLeft: '12px',
          paddingRight: '12px',
          paddingTop: '10px',
          paddingBottom: '10px',
          borderRadius: '12px',
          cursor: 'pointer',
          transition: 'all 0.2s',
          userSelect: 'none',
          background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
          boxShadow: isActive ? 'inset 0 0 0 1px rgba(255,255,255,0.15)' : 'none',
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
          }
        }}
        onMouseLeave={(e) => {
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
              background: 'rgba(255,255,255,0.1)',
              color: 'white',
              fontSize: '0.875rem',
              borderRadius: '6px',
              paddingLeft: '8px',
              paddingRight: '8px',
              paddingTop: '4px',
              paddingBottom: '4px',
              border: '1px solid rgba(255,255,255,0.2)',
              outline: 'none',
            }}
          />
        ) : (
          <>
            <span style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'rgba(255,255,255,0.9)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {conversation.title || 'New Chat'}
            </span>
            {lastMessagePreview && (
              <span style={{
                fontSize: '0.75rem',
                color: 'rgba(255,255,255,0.4)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {lastMessagePreview}
              </span>
            )}
          </>
        )}
      </div>

      {/* Context menu */}
      {showMenu && (
        <>
          {/* Invisible backdrop to close menu */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
            onClick={handleMenuBackdropClick}
          />
          <div
            style={{
              position: 'fixed',
              zIndex: 50,
              minWidth: '140px',
              paddingTop: '4px',
              paddingBottom: '4px',
              borderRadius: '12px',
              background: 'rgba(26,26,46,0.95)',
              border: '1px solid rgba(255,255,255,0.15)',
              backdropFilter: 'blur(24px)',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
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
                color: 'rgba(255,255,255,0.8)',
                transition: 'background 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              onClick={handleRenameStart}
            >
              <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Rename
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
                color: '#f87171',
                transition: 'background 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              onClick={handleDelete}
            >
              <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}
