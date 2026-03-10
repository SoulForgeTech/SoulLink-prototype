'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal } from '@/store/uiSlice';
import { useT } from '@/hooks/useT';

// ==================== Inline Style Constants ====================

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px',
  animation: 'modalFadeIn 0.25s ease-out',
};

const glassOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
};

const modalContentStyle: CSSProperties = {
  position: 'relative',
  borderRadius: '16px',
  padding: '24px',
  width: '100%',
  maxWidth: '20rem',
  textAlign: 'center',
  animation: 'modalScaleIn 0.25s ease-out',
};

const titleStyle: CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  marginBottom: '4px',
};

const descriptionStyle: CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  marginBottom: '20px',
};

const qrContainerStyle: CSSProperties = {
  marginLeft: 'auto',
  marginRight: 'auto',
  width: '192px',
  height: '192px',
  borderRadius: '12px',
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  marginBottom: '20px',
};

const qrImageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  padding: '8px',
};

const closeBtnBaseStyle: CSSProperties = {
  width: '100%',
  padding: '10px 0',
  borderRadius: '12px',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#ffffff',
  background: '#6BA3D6',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

// ==================== Component ====================

/**
 * WeChat community popup modal.
 * Shows the WeChat QR code with a title, description, and "Got it" close button.
 */
export default function CommunityPopup() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.modals.community);
  const t = useT();

  const [btnHover, setBtnHover] = useState(false);

  const handleClose = useCallback(() => {
    dispatch(closeModal('community'));
  }, [dispatch]);

  if (!isOpen) return null;

  return (
    <div
      style={overlayStyle}
      onClick={handleClose}
    >
      {/* Overlay */}
      <div className="glass-overlay" style={glassOverlayStyle} />

      {/* Modal Content */}
      <div
        className="glass-modal"
        style={modalContentStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <h3 style={titleStyle}>{t('community.popup.title')}</h3>
        <p style={descriptionStyle}>
          {t('community.popup.desc')}
        </p>

        {/* QR Code */}
        <div style={qrContainerStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/wechat-qr.png"
            alt="WeChat QR Code"
            style={qrImageStyle}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).parentElement!.innerHTML =
                '<span style="color:#9ca3af;font-size:0.875rem">QR Code</span>';
            }}
          />
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={{
            ...closeBtnBaseStyle,
            filter: btnHover ? 'brightness(1.1)' : 'none',
          }}
        >
          {t('community.popup.close')}
        </button>
      </div>
    </div>
  );
}
