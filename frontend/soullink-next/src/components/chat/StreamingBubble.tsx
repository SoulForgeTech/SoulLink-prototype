'use client';

/**
 * Live streaming bubble for SSE chat responses.
 *
 * Renders the incoming stream text character-by-character using
 * the useTypewriter hook (DOM-based, not React state per char).
 *
 * Shows a typing cursor while streaming is active.
 * Detects [IMAGE:] tags in the stream and shows a shimmer placeholder.
 * When the stream completes, transitions to a MultiBubbleGroup.
 *
 * Matches original index.html styles: avatar 45px, message-content bubble.
 */

import { useRef, useEffect, useState, useMemo } from 'react';
import { useAppSelector } from '@/store';
import { useTypewriter } from '@/hooks/useTypewriter';
import { useT } from '@/hooks/useT';
import MultiBubbleGroup from './MultiBubbleGroup';

// ==================== Image Placeholder ====================

function ImageGeneratingPlaceholder({ label }: { label: string }) {
  return (
    <div className="image-generating-placeholder">
      <span className="img-gen-icon">🎨</span>
      <span className="img-gen-text">
        {label}<span className="img-gen-dots" />
      </span>
    </div>
  );
}

// ==================== Types ====================

interface StreamingBubbleProps {
  /** Whether to show the companion avatar. */
  showAvatar?: boolean;
  /** Optional callback for TTS after streaming completes. */
  onTTS?: (text: string) => void;
}

// ==================== Component ====================

export default function StreamingBubble({
  showAvatar = true,
  onTTS,
}: StreamingBubbleProps) {
  const isStreaming = useAppSelector((s) => s.chat.isStreaming);
  const streamingText = useAppSelector((s) => s.chat.streamingText);
  const imageGeneratingCount = useAppSelector((s) => s.chat.imageGeneratingCount);
  const companionAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const companionName = useAppSelector((s) => s.settings.companionName);
  const t = useT();

  const containerRef = useRef<HTMLSpanElement>(null);
  const prevTextLenRef = useRef(0);
  const { enqueue, stop } = useTypewriter(containerRef);

  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const [streamComplete, setStreamComplete] = useState(false);
  const [finalText, setFinalText] = useState('');

  // Enqueue new characters as streamingText grows.
  useEffect(() => {
    if (!isStreaming) return;

    const newLen = streamingText.length;
    const prevLen = prevTextLenRef.current;

    if (newLen > prevLen) {
      const newChars = streamingText.slice(prevLen, newLen);
      enqueue(newChars);
      prevTextLenRef.current = newLen;
    }
  }, [streamingText, isStreaming, enqueue]);

  // Show shimmer when Redux reports image(s) being generated.
  // imageGeneratingCount is set by useSSEStream when ImageTagFilter consumes a tag.
  // The old check (streamingText.includes('[IMAGE:')) never worked because
  // ImageTagFilter strips tags BEFORE dispatching to Redux streamingText.
  useEffect(() => {
    if (imageGeneratingCount > 0) {
      setIsImageGenerating(true);
    }
  }, [imageGeneratingCount]);

  // When streaming stops, transition to MultiBubbleGroup.
  useEffect(() => {
    if (!isStreaming && prevTextLenRef.current > 0) {
      setFinalText(streamingText);
      setStreamComplete(true);
      stop();
    }
  }, [isStreaming, streamingText, stop]);

  // Reset state when a new stream starts.
  useEffect(() => {
    if (isStreaming) {
      prevTextLenRef.current = 0;
      setStreamComplete(false);
      setFinalText('');
      setIsImageGenerating(false);
    }
  }, [isStreaming]);

  // After stream completes, show the final MultiBubbleGroup.
  const lastMessage = useAppSelector((s) => {
    const msgs = s.chat.messages;
    return msgs.length > 0 ? msgs[msgs.length - 1] : null;
  });

  // If stream completed and the final message is in the store, render MultiBubbleGroup.
  if (streamComplete && !isStreaming && lastMessage?.role === 'assistant') {
    return (
      <MultiBubbleGroup
        content={lastMessage.content}
        imageUrls={lastMessage.image_urls}
        showAvatar={showAvatar}
        onTTS={onTTS}
      />
    );
  }

  // If not streaming and nothing accumulated, don't render.
  if (!isStreaming && prevTextLenRef.current === 0) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Main streaming bubble row — uses .message.assistant CSS classes */}
      <div className="message assistant">
        {/* Avatar — uses .message-avatar CSS class */}
        {showAvatar && (
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
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(135deg, rgba(107,163,214,0.6), rgba(107,163,214,0.3))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                {(companionName || 'AI')[0]}
              </div>
            )}
          </div>
        )}
        {!showAvatar && <div className="avatar-spacer" />}

        {/* Streaming bubble — uses .message-content CSS class */}
        <div className="message-content markdown-content">
          <span ref={containerRef} style={{ wordBreak: 'break-word' }} />
          {isStreaming && <span className="typing-cursor" />}
        </div>
      </div>

      {/* Image generating placeholder — shown when ImageTagFilter consumed ≥1 tag */}
      {isImageGenerating && isStreaming && (
        <ImageGeneratingPlaceholder
          label={
            imageGeneratingCount > 1
              ? `${t('chat.image.generating')} (${imageGeneratingCount})`
              : t('chat.image.generating')
          }
        />
      )}
    </div>
  );
}
