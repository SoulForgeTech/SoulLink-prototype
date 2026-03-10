'use client';

import { useAppSelector } from '@/store';

/**
 * Full-screen loading overlay.
 * Reads visibility, text, and progress from uiSlice loading state.
 */
export default function LoadingOverlay() {
  const { visible, text, showProgress, percent } = useAppSelector(
    (state) => state.ui.loading,
  );

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 15, 26, 0.85)',
        backdropFilter: 'blur(8px)',
        animation: 'modalFadeIn 0.2s ease-out',
      }}
    >
      {/* Spinner */}
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          borderWidth: '3px',
          borderStyle: 'solid',
          borderColor: 'rgba(255,255,255,0.2)',
          borderTopColor: '#6BA3D6',
          animation: 'spin 0.8s linear infinite',
        }}
      />

      {/* Text */}
      {text && (
        <p style={{
          marginTop: '16px',
          fontSize: '0.875rem',
          color: 'rgba(255,255,255,0.8)',
          textAlign: 'center',
          paddingLeft: '24px',
          paddingRight: '24px',
          maxWidth: '20rem',
        }}>
          {text}
        </p>
      )}

      {/* Progress Bar */}
      {showProgress && (
        <div style={{
          marginTop: '16px',
          width: '192px',
          height: '6px',
          borderRadius: '9999px',
          background: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
        }}>
          <div
            style={{
              height: '100%',
              borderRadius: '9999px',
              transition: 'all 0.3s ease-out',
              width: `${Math.min(percent, 100)}%`,
              background: 'linear-gradient(90deg, #6BA3D6, #9DC4E6)',
            }}
          />
        </div>
      )}
    </div>
  );
}
