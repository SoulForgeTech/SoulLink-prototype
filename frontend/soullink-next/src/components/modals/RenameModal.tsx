'use client';

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal } from '@/store/uiSlice';
import { setCompanionName } from '@/store/settingsSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { updateSettings } from '@/lib/api/user';

// ==================== Inline Style Constants ====================

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background: 'rgba(255,255,255,0.1)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalContentStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.6)',
  borderRadius: '20px',
  background: 'rgba(255,255,255,0.78)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  width: '90%',
  maxWidth: '500px',
  maxHeight: '85vh',
  boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  color: '#1a202c',
  animation: 'modalScaleIn 0.25s ease',
  position: 'relative',
  padding: '24px',
};

const modalHeaderTitleStyle: CSSProperties = {
  fontSize: '1.2rem',
  fontWeight: 600,
  color: '#1a202c',
  textAlign: 'center',
  marginBottom: 4,
};

const formInputStyle: CSSProperties = {
  padding: '10px 14px',
  background: 'rgba(255,255,255,0.5)',
  border: '1px solid rgba(0,0,0,0.1)',
  borderRadius: '8px',
  color: '#1a202c',
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
  borderRadius: '8px',
  fontSize: '0.95rem',
  fontWeight: 500,
  background: 'rgba(0,0,0,0.04)',
  border: '1px solid rgba(0,0,0,0.1)',
  color: '#4a5568',
  cursor: 'pointer',
  flex: 1,
};

const btnPrimaryStyle: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '8px',
  fontSize: '0.95rem',
  fontWeight: 500,
  background: '#6BA3D6',
  border: 'none',
  color: 'white',
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
    const trimmed = name.trim();
    if (trimmed && trimmed.length <= 20) {
      dispatch(setCompanionName(trimmed));
      // Guest: only save to Redux/localStorage, skip API
      if (!isGuest) {
        updateSettings(authFetch, { companion_name: trimmed }).catch((err) => {
          console.error('Failed to save companion name:', err);
        });
      }
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
      style={overlayStyle}
      onClick={handleClose}
    >
      {/* Modal Content */}
      <div
        style={modalContentStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <h3 style={modalHeaderTitleStyle}>
          Give {pronoun} a name
        </h3>
        <p style={{ fontSize: '0.875rem', color: '#718096', textAlign: 'center', marginBottom: 20 }}>
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
            e.currentTarget.style.borderColor = '#6BA3D6';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(107,163,214,0.15)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />

        {/* Character count */}
        <div style={{ textAlign: 'right', marginTop: 6, fontSize: '0.75rem', color: '#a0aec0' }}>
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
              background: primaryHover ? '#5A92C5' : '#6BA3D6',
              opacity: !name.trim() ? 0.4 : 1,
              cursor: !name.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
