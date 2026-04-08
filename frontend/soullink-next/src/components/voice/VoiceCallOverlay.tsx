'use client';

/**
 * Full-screen voice call UI overlay.
 *
 * Shows a gradient overlay with the companion's avatar,
 * an animated glowing ring (state-dependent), call duration timer,
 * status text, and an end-call button.
 *
 * Matches original index.html voice call styles exactly:
 *   - Background: gradient (not blur)
 *   - Avatar ring: 160px with state-specific glow colors
 *   - States: listening (cyan), thinking (pink), speaking (purple)
 */

import { useMemo } from 'react';
import { useAppSelector } from '@/store';
import { useVoiceCallContext } from '@/contexts/VoiceCallContext';
import type { VoiceCallState } from '@/types';

// ==================== Helpers ====================

function formatCallTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Ring style per call state — matches original .voice-call-avatar-ring states */
function getRingStyle(state: VoiceCallState): React.CSSProperties {
  switch (state) {
    case 'listening':
      return {
        borderColor: 'rgba(0, 210, 255, 0.7)',
        background: 'rgba(0, 210, 255, 0.08)',
        boxShadow: '0 0 24px rgba(0, 210, 255, 0.25), 0 0 48px rgba(0, 210, 255, 0.1)',
        animation: 'vcGlowListen 2.5s ease-in-out infinite',
      };
    case 'processing':
      return {
        borderColor: 'rgba(245, 130, 200, 0.75)',
        background: 'rgba(245, 130, 200, 0.08)',
        boxShadow: '0 0 24px rgba(245, 130, 200, 0.3), 0 0 48px rgba(245, 130, 200, 0.12)',
        animation: 'vcGlowThink 1.4s ease-in-out infinite',
      };
    case 'speaking':
      return {
        borderColor: 'rgba(161, 140, 209, 0.8)',
        background: 'rgba(161, 140, 209, 0.08)',
        boxShadow: '0 0 28px rgba(161, 140, 209, 0.35), 0 0 56px rgba(161, 140, 209, 0.15)',
        animation: 'vcGlowSpeak 1.8s ease-in-out infinite',
      };
    case 'connecting':
      return {
        borderColor: 'rgba(255,255,255,0.3)',
        background: 'transparent',
        animation: 'pulse 2s ease-in-out infinite',
      };
    default:
      return {
        borderColor: 'rgba(255,255,255,0.2)',
        background: 'transparent',
      };
  }
}

/** Map call state to status text */
function getStatusText(
  state: VoiceCallState,
  t: (key: string) => string,
): string {
  switch (state) {
    case 'connecting':
      return t('voicecall.status.connecting');
    case 'listening':
      return t('voicecall.status.listening');
    case 'processing':
      return t('voicecall.status.thinking');
    case 'speaking':
      return t('voicecall.status.speaking');
    default:
      return '';
  }
}

// ==================== Component ====================

export default function VoiceCallOverlay() {
  // Use shared context — start() was already called from the phone button's
  // click handler (user gesture context), so AudioContext is 'running'.
  // We only need stop/isActive/callState/callSeconds here for rendering.
  const { stop, interrupt, isActive, callState, callSeconds } = useVoiceCallContext();

  const companionName = useAppSelector((s) => s.settings.companionName);
  const companionAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const language = useAppSelector((s) => s.settings.language);

  // Minimal inline i18n fallback
  const t = useMemo(() => {
    const translations: Record<string, Record<string, string>> = {
      en: {
        'voicecall.status.connecting': 'Connecting...',
        'voicecall.status.listening': 'Listening...',
        'voicecall.status.thinking': 'Thinking...',
        'voicecall.status.speaking': 'Speaking... Tap to interrupt',
      },
      'zh-CN': {
        'voicecall.status.connecting': '\u8FDE\u63A5\u4E2D...',
        'voicecall.status.listening': '\u6B63\u5728\u542C...',
        'voicecall.status.thinking': '\u601D\u8003\u4E2D...',
        'voicecall.status.speaking': '\u6B63\u5728\u8BF4... \u70B9\u51FB\u6253\u65AD',
      },
    };
    const dict = translations[language] ?? translations.en;
    return (key: string) => dict[key] ?? key;
  }, [language]);

  if (!isActive) return null;

  const ringStyle = getRingStyle(callState);
  const statusText = getStatusText(callState, t);

  return (
    /* .voice-call-overlay — matches original */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        display: 'flex',
        flexDirection: 'column',
        transition: 'opacity 0.4s',
      }}
    >
      {/* .voice-call-bg — gradient background matching original */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(160deg, #0f0f1a 0%, #1a1a3e 40%, #2d1b4e 100%)',
        }}
      />

      {/* .voice-call-content */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px 72px',
          gap: 24,
        }}
      >
        {/* Timer */}
        <span
          style={{
            position: 'absolute',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '0.9rem',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatCallTime(callSeconds)}
        </span>

        {/* .voice-call-avatar-ring — 160px matching original */}
        {/* Tap to interrupt when AI is speaking */}
        <div
          onClick={callState === 'speaking' ? interrupt : undefined}
          style={{
            width: 160,
            height: 160,
            borderRadius: '50%',
            border: '3px solid',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            transition: 'all 0.5s',
            cursor: callState === 'speaking' ? 'pointer' : 'default',
            ...ringStyle,
          }}
        >
          {companionAvatar ? (
            <img
              src={companionAvatar}
              alt={companionName}
              style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.05)',
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}
        </div>

        {/* .voice-call-name */}
        <h2
          style={{
            color: '#fff',
            fontSize: '1.5rem',
            fontWeight: 600,
            margin: 0,
          }}
        >
          {companionName || 'Companion'}
        </h2>

        {/* .voice-call-status */}
        <p
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: '0.95rem',
            minHeight: '1.4em',
            transition: 'color 0.3s',
            margin: 0,
          }}
        >
          {statusText}
        </p>

        {/* .voice-call-hangup — matches original (64px, red) */}
        <div style={{ display: 'flex', gap: 32, alignItems: 'center', marginTop: 24 }}>
          <button
            onClick={stop}
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#ef4444',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s, transform 0.2s',
              boxShadow: '0 4px 20px rgba(239, 68, 68, 0.4)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#dc2626';
              e.currentTarget.style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#ef4444';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            aria-label="End call"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
