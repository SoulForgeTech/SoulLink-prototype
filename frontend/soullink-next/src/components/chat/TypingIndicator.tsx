'use client';

/**
 * Typing indicator (three bouncing dots).
 *
 * Shown when the AI is processing a request (before streaming begins).
 * Displays the companion avatar alongside animated bouncing dots.
 * Matches original index.html .typing-indicator styles exactly.
 */

import { useAppSelector } from '@/store';

export default function TypingIndicator() {
  const companionAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const companionName = useAppSelector((s) => s.settings.companionName);

  return (
    <div
      className="typing-indicator visible"
      style={{ animation: 'bubbleAppear 0.3s ease-out both' }}
    >
      {/* Companion avatar — uses .message-avatar CSS class */}
      <div className="message-avatar" style={{ overflow: 'hidden' }}>
        {companionAvatar ? (
          <img
            src={companionAvatar}
            alt={companionName || 'AI'}
            width={45}
            height={45}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(135deg, rgba(107,163,214,0.6), rgba(107,163,214,0.3))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '0.85rem',
              fontWeight: 600,
              borderRadius: '50%',
            }}
          >
            {(companionName || 'AI')[0]}
          </div>
        )}
      </div>

      {/* Bouncing dots bubble — matches original .typing-bubble */}
      <div className="typing-bubble">
        <div className="typing-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
