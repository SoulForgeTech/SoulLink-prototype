'use client';

/**
 * Single message bubble — uses CSS classes from globals.css to match original index.html.
 *
 * CSS classes used: .message, .message.user, .message.assistant,
 * .message-content, .message-avatar, .avatar-spacer
 */

import { useState, useCallback, useRef, useMemo, type KeyboardEvent } from 'react';
import { useAppSelector } from '@/store';
import { renderMarkdown } from '@/lib/markdown';

// ==================== Image Edit Overlay ====================

export function ImageEditOverlay({
  imageSrc,
  onEdit,
}: {
  imageSrc: string;
  onEdit: (imageDataUrl: string, prompt: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    setShowInput(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onEdit(imageSrc, trimmed);
    setPrompt('');
    setShowInput(false);
  }, [prompt, imageSrc, onEdit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        setShowInput(false);
        setPrompt('');
      }
    },
    [handleSubmit],
  );

  return (
    <>
      {/* Edit button */}
      <button
        onClick={handleOpen}
        title="Edit image"
        style={{
          position: 'absolute', right: '6px', bottom: '6px',
          background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '8px',
          padding: '4px 8px', cursor: 'pointer', color: '#fff',
          fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px',
          opacity: 0, transition: 'opacity 0.2s',
          backdropFilter: 'blur(4px)',
        }}
        className="img-edit-btn"
      >
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
        Edit
      </button>

      {/* Inline prompt input */}
      {showInput && (
        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
            padding: '8px', borderRadius: '0 0 12px 12px',
            display: 'flex', gap: '6px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { setShowInput(false); setPrompt(''); }}
            style={{
              background: 'none', border: 'none', padding: '4px',
              color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
            title="Cancel"
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the edit..."
            style={{
              flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px', padding: '6px 10px', color: '#fff', fontSize: '0.8rem',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim()}
            style={{
              background: prompt.trim() ? '#6BA3D6' : 'rgba(255,255,255,0.1)',
              border: 'none', borderRadius: '8px', padding: '6px 12px',
              color: '#fff', fontSize: '0.8rem', cursor: prompt.trim() ? 'pointer' : 'default',
              flexShrink: 0,
            }}
          >
            Go
          </button>
        </div>
      )}
    </>
  );
}

// ==================== Types ====================

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{ name: string; isImage?: boolean; dataUrl?: string; url?: string }>;
  imageUrls?: string[];
  audioUrl?: string;
  audioDuration?: number;
  showAvatar?: boolean;
  animationIndex?: number;
  dangerousHtml?: string;
  className?: string;
  /** Callback for TTS playback */
  onTTS?: (text: string) => void;
  /** Callback for image editing — receives image data URL/URL + edit prompt */
  onImageEdit?: (imageDataUrl: string, prompt: string) => void;
}

// ==================== Voice Waveform ====================

function VoiceWaveform({ audioUrl, duration }: { audioUrl: string; duration: number }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlay = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.addEventListener('ended', () => setIsPlaying(false));
    }
    if (isPlaying) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [audioUrl, isPlaying]);

  const bars = useMemo(() => {
    const count = Math.max(8, Math.min(20, Math.round(duration * 3)));
    return Array.from({ length: count }, (_, i) => {
      const h = 4 + Math.sin(i * 0.8 + 1) * 6 + Math.random() * 6;
      return Math.round(h);
    });
  }, [duration]);

  const fmt = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '120px' }}>
      <button
        onClick={handlePlay}
        style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, color: 'inherit',
        }}
      >
        {isPlaying ? (
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '20px', flex: 1 }}>
        {bars.map((h, i) => (
          <div
            key={i}
            style={{
              width: '3px', borderRadius: '9999px', background: 'currentColor', opacity: 0.5,
              height: `${h}px`,
              animation: isPlaying ? `vmBarAnim 0.4s ease-in-out ${i * 0.05}s infinite alternate` : undefined,
              ['--bar-h' as string]: `${h}px`,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: '0.75rem', opacity: 0.6, flexShrink: 0 }}>{fmt(duration)}</span>
    </div>
  );
}

// ==================== Component ====================

export default function MessageBubble({
  role,
  content,
  attachments,
  imageUrls,
  audioUrl,
  audioDuration,
  showAvatar = false,
  animationIndex = 0,
  dangerousHtml,
  className = '',
  onTTS,
  onImageEdit,
}: MessageBubbleProps) {
  const companionAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const companionName = useAppSelector((s) => s.settings.companionName);
  const userBubbleColor = useAppSelector((s) => s.settings.userBubbleColor);
  const user = useAppSelector((s) => s.auth.user);

  // User avatar: avatar_url (Cloudinary) or avatar (legacy) or color initial
  const userAvatar = user?.avatar_url || user?.avatar;
  const userInitial = (user?.name || 'U').charAt(0).toUpperCase();
  const userAvatarColor = user?.avatar_color || '#6BA3D6';

  const isUser = role === 'user';
  const isVoice = !!audioUrl;

  // Dynamic user bubble color override (only needed when custom color is set)
  const userColorStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!isUser || !userBubbleColor) return undefined;
    const hex = userBubbleColor.replace('#', '');
    if (hex.length !== 6) return undefined;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return {
      background: `rgba(${r}, ${g}, ${b}, 1)`,
      borderColor: `rgba(${r}, ${g}, ${b}, 0.25)`,
    };
  }, [isUser, userBubbleColor]);

  // Rendered HTML
  const html = useMemo(() => {
    if (dangerousHtml) return dangerousHtml;
    if (isVoice) return '';
    return renderMarkdown(content || '');
  }, [content, dangerousHtml, isVoice]);

  const imageAttachments = attachments?.filter((a) => a.isImage && (a.dataUrl || a.url)) || [];

  // Determine if animation should be skipped (animationIndex < 0 means no-animate)
  const noAnimate = animationIndex < 0;

  return (
    <div
      className={`message ${role} ${className}`}
      style={noAnimate ? { opacity: 1, transform: 'none', animation: 'none' } : undefined}
    >
      {/* AI Avatar */}
      {!isUser && showAvatar && (
        <div className="message-avatar" style={{ overflow: 'hidden' }}>
          {companionAvatar ? (
            <img
              src={companionAvatar}
              alt={companionName || 'AI'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(135deg, rgba(107,163,214,0.6), rgba(107,163,214,0.3))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: '0.85rem', fontWeight: 600,
              }}
            >
              {(companionName || 'AI')[0]}
            </div>
          )}
        </div>
      )}

      {/* Avatar spacer for non-first bubbles in a group */}
      {!isUser && !showAvatar && (
        <div className="avatar-spacer" />
      )}

      {/* User Avatar — row-reverse makes this appear on the right */}
      {isUser && (
        <div className="message-avatar" style={{ overflow: 'hidden' }}>
          {userAvatar ? (
            <img
              src={userAvatar}
              alt={user?.name || 'User'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%', height: '100%',
                background: userAvatarColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: '0.85rem', fontWeight: 600,
              }}
            >
              {userInitial}
            </div>
          )}
        </div>
      )}

      {/* Bubble — CSS class handles glass effect, radius, etc. */}
      <div className="message-content" style={userColorStyle ? { ...userColorStyle, position: 'relative' } : { position: 'relative' }}>
        {/* Image attachments (user) */}
        {imageAttachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: content ? '8px' : 0 }}>
            {imageAttachments.map((att, i) => {
              const src = att.dataUrl || att.url || '';
              return (
                <div key={i} className="img-edit-wrap" style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={src}
                    alt={att.name}
                    style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '12px', objectFit: 'cover', cursor: 'pointer' }}
                  />
                  {onImageEdit && src && (
                    <ImageEditOverlay imageSrc={src} onEdit={onImageEdit} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Voice message */}
        {isVoice && audioUrl && (
          <VoiceWaveform audioUrl={audioUrl} duration={audioDuration || 0} />
        )}

        {/* Text content — markdown */}
        {!isVoice && html && (
          <div
            className="markdown-content"
            style={{ wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {/* TTS button — always visible when voice preset is set */}
        {onTTS && !isUser && !isVoice && (
          <button
            onClick={() => onTTS(content)}
            style={{
              position: 'absolute', left: '-4px', bottom: '-4px',
              background: 'rgba(0,0,0,0.05)', border: 'none',
              borderRadius: '50%', width: '24px', height: '24px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#718096', transition: 'all 0.2s',
            }}
            aria-label="Play TTS"
          >
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
