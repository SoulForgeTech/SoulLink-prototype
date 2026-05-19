'use client';

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal } from '@/store/uiSlice';
import { setCompanionName } from '@/store/settingsSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { updateSettings } from '@/lib/api/user';

// ==================== Inline Style Constants ====================

// Shell material via .diary-modal-scrim + .diary-paper-panel (see diary.css).
const overlayStyle: CSSProperties = {
  zIndex: 10000,
};

const modalContentStyle: CSSProperties = {
  borderRadius: '20px',
  width: '90%',
  maxWidth: '500px',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  animation: 'modalScaleIn 0.25s ease',
  padding: '24px',
};

const modalHeaderTitleStyle: CSSProperties = {
  fontSize: '1.2rem',
  fontWeight: 600,
  color: 'var(--ink)',
  textAlign: 'center',
  marginBottom: 4,
};

const formInputStyle: CSSProperties = {
  padding: '10px 14px',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--ink-line)',
  borderRadius: 0,
  color: 'var(--ink)',
  fontSize: '0.95rem',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

const modalFooterStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  marginTop: 16,
};

const btnSecondaryStyle: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '2px',
  fontSize: '0.95rem',
  fontWeight: 500,
  background: 'transparent',
  border: '1px solid var(--ink-line)',
  color: 'var(--ink-soft)',
  cursor: 'pointer',
  flex: 1,
};

const btnPrimaryStyle: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '2px',
  fontSize: '0.95rem',
  fontWeight: 500,
  background: 'var(--seal)',
  border: 'none',
  color: '#FFFAF0',
  cursor: 'pointer',
  flex: 1,
};

// ==================== Component ====================

/**
 * Companion rename modal.
 * Shows a text input (max 20 chars) with Cancel + Save buttons.
 * Enter key saves.
 *
 * Self-contained: reads companionName from Redux and dispatches
 * setCompanionName on save.
 * Uses inline styles matching the original index.html glassmorphism CSS.
 */
export default function RenameModal() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const isOpen = useAppSelector((state) => state.ui.modals.rename);
  const currentName = useAppSelector((state) => state.settings.companionName);
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hover state for primary button
  const [primaryHover, setPrimaryHover] = useState(false);

  // Reset name when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, currentName]);

  const handleClose = useCallback(() => {
    dispatch(closeModal('rename'));
  }, [dispatch]);

  const isGuest = useAppSelector((s) => s.guest.isGuest);

  const handleSave = useCallback(() => {
    if (isGuest) {
      handleClose();
      import('@/store/guestSlice').then(({ openUpgradeModal }) => {
        dispatch(openUpgradeModal('feature_locked'));
      });
      return;
    }
    const trimmed = name.trim();
    if (trimmed && trimmed.length <= 20) {
      dispatch(setCompanionName(trimmed));
      updateSettings(authFetch, { companion_name: trimmed }).catch((err) => {
        console.error('Failed to save companion name:', err);
      });
      handleClose();
    }
  }, [name, dispatch, handleClose, authFetch, isGuest]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  if (!isOpen) return null;

  const pronoun = 'her'; // TODO: read gender from settings when available

  return (
    <div
      className="diary-modal-scrim diary-scope"
      style={overlayStyle}
      onClick={handleClose}
    >
      {/* Modal Content */}
      <div
        className="diary-paper-panel"
        style={modalContentStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <h3 style={modalHeaderTitleStyle}>
          Give {pronoun} a name
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--ink-soft)', textAlign: 'center', marginBottom: 20 }}>
          Max 20 characters
        </p>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          onKeyDown={handleKeyDown}
          maxLength={20}
          placeholder="Enter a name..."
          style={formInputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderBottomColor = 'var(--seal)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderBottomColor = 'var(--ink-line)';
          }}
        />

        {/* Character count */}
        <div style={{ textAlign: 'right', marginTop: 6, fontSize: '0.75rem', color: 'var(--ink-faint)' }}>
          {name.length}/20
        </div>

        {/* Buttons */}
        <div style={modalFooterStyle}>
          <button
            onClick={handleClose}
            style={btnSecondaryStyle}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            onMouseEnter={() => setPrimaryHover(true)}
            onMouseLeave={() => setPrimaryHover(false)}
            style={{
              ...btnPrimaryStyle,
              opacity: !name.trim() ? 0.4 : 1,
              cursor: !name.trim() ? 'not-allowed' : 'pointer',
              transform: primaryHover ? 'translateY(-1px)' : 'none',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
