'use client';

/**
 * TestReminder — personality test reminder popup.
 *
 * Shows for users who skipped the personality test.
 * Provides a "Take the Test" button and a "Maybe Later" dismiss option.
 */

import { useState } from 'react';

interface TestReminderProps {
  /** Called when user clicks "Take the Test" */
  onTakeTest: () => void;
  /** Called when user dismisses the reminder */
  onDismiss: () => void;
}

export default function TestReminder({
  onTakeTest,
  onDismiss,
}: TestReminderProps) {
  const [isClosing, setIsClosing] = useState(false);

  function handleDismiss() {
    setIsClosing(true);
    setTimeout(() => {
      onDismiss();
    }, 300);
  }

  function handleTakeTest() {
    setIsClosing(true);
    setTimeout(() => {
      onTakeTest();
    }, 300);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: '16px',
        paddingRight: '16px',
        transition: 'opacity 0.3s',
        opacity: isClosing ? 0 : 1,
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={handleDismiss}
      />

      {/* Popup card */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '24rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          borderRadius: '24px',
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.1)',
          padding: '32px',
          textAlign: 'center',
          backdropFilter: 'blur(24px)',
          transition: 'all 0.3s',
          transform: isClosing ? 'scale(0.95)' : 'scale(1)',
          opacity: isClosing ? 0 : 1,
        }}
      >
        {/* Icon */}
        <div style={{ fontSize: '3rem' }}>{'\u{1F52E}'}</div>

        {/* Title */}
        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
          Discover Your Soul Match
        </h3>

        {/* Description */}
        <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
          Take a quick personality test so your companion can truly understand
          you.
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '12px', paddingTop: '8px' }}>
          <button
            onClick={handleDismiss}
            style={{
              flex: 1,
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              paddingLeft: '16px',
              paddingRight: '16px',
              paddingTop: '12px',
              paddingBottom: '12px',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'rgba(255,255,255,0.6)',
              transition: 'background 0.2s',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          >
            Maybe Later
          </button>
          <button
            onClick={handleTakeTest}
            style={{
              flex: 1,
              borderRadius: '12px',
              background: 'linear-gradient(to right, #6BA3D6, #5A8DB8)',
              paddingLeft: '16px',
              paddingRight: '16px',
              paddingTop: '12px',
              paddingBottom: '12px',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'white',
              boxShadow: '0 10px 15px -3px rgba(107,163,214,0.25)',
              transition: 'all 0.2s',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Take the Test
          </button>
        </div>
      </div>
    </div>
  );
}
