'use client';

/**
 * Voice recording indicator bar.
 *
 * Shown above the chat input area when the user is recording a voice message.
 * Displays:
 *   - Cancel (X) button
 *   - Pulsing red recording dot
 *   - Duration counter in M:SS format
 *   - Send button
 *
 * Accepts recording state and callbacks as props from the parent (page.tsx)
 * which owns the useVoiceRecording hook instance.
 */

// ==================== Helpers ====================

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ==================== Types ====================

interface VoiceRecordingBarProps {
  isRecording: boolean;
  isUploading: boolean;
  duration: number;
  cancelRecording: () => void;
  stopRecording: () => void;
}

// ==================== Component ====================

export default function VoiceRecordingBar({
  isRecording,
  isUploading,
  duration,
  cancelRecording,
  stopRecording,
}: VoiceRecordingBarProps) {
  if (!isRecording && !isUploading) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      paddingLeft: '16px',
      paddingRight: '16px',
      paddingTop: '10px',
      paddingBottom: '10px',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%)',
      backdropFilter: 'blur(40px) saturate(180%)',
      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      borderTop: '1px solid rgba(255,255,255,0.25)',
      borderTopLeftRadius: '20px',
      borderTopRightRadius: '20px',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.15)',
    }}>
      {/* Cancel button */}
      <button
        onClick={cancelRecording}
        disabled={isUploading}
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.6)',
          transition: 'all 0.2s',
          border: 'none',
          cursor: isUploading ? 'not-allowed' : 'pointer',
          opacity: isUploading ? 0.4 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isUploading) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
        }}
        aria-label="Cancel recording"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Recording dot + duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
        {/* Pulsing red dot */}
        {isRecording && (
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#ef4444',
              animation: 'recBlink 1s ease-in-out infinite',
            }}
          />
        )}

        {/* Loading spinner when uploading */}
        {isUploading && (
          <span
            style={{
              width: '16px',
              height: '16px',
              borderWidth: '2px',
              borderStyle: 'solid',
              borderColor: 'rgba(255,255,255,0.3)',
              borderTopColor: 'var(--primary-color)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        )}

        {/* Duration or uploading text */}
        <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
          {isUploading ? 'Sending...' : formatDuration(duration)}
        </span>
      </div>

      {/* Send button */}
      <button
        onClick={stopRecording}
        disabled={isUploading || duration < 1}
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--primary-color)',
          color: 'white',
          transition: 'all 0.2s',
          border: 'none',
          cursor: (isUploading || duration < 1) ? 'not-allowed' : 'pointer',
          opacity: (isUploading || duration < 1) ? 0.4 : 1,
        }}
        aria-label="Send recording"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </div>
  );
}
