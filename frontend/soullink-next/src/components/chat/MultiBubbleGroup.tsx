'use client';

/**
 * Multi-bubble group for assistant messages — matches original .message-group CSS.
 *
 * Original: max-width 70%, margin-bottom 20px, staggered bubbleAppear animation
 * with delays 0s/0.15s/0.3s/0.45s/0.55s.
 */

import { useMemo, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { open as openImageViewer } from '@/store/imageViewerSlice';
import { splitIntoBubbles } from '@/lib/bubbleSplitter';
import MessageBubble from './MessageBubble';

interface MultiBubbleGroupProps {
  content: string;
  imageUrls?: string[];
  thinking?: string | null;
  showAvatar?: boolean;
  baseAnimationIndex?: number;
  onTTS?: (text: string) => void;
  /** If true, skip entrance animation (for history messages) */
  noAnimate?: boolean;
}

export default function MultiBubbleGroup({
  content,
  imageUrls,
  showAvatar = true,
  baseAnimationIndex = 0,
  onTTS,
  noAnimate = false,
}: MultiBubbleGroupProps) {
  const dispatch = useAppDispatch();
  const ttsEnabled = useAppSelector((s) => s.settings.ttsEnabled);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  const bubbles = useMemo(() => splitIntoBubbles(content), [content]);

  return (
    <div className={`message-group ${noAnimate ? 'no-animate' : ''}`}>
      {bubbles.map((text, i) => (
        <MessageBubble
          key={i}
          role="assistant"
          content={text}
          showAvatar={i === 0 && showAvatar}
          animationIndex={noAnimate ? -1 : baseAnimationIndex + i}
          onTTS={ttsEnabled ? onTTS : undefined}
        />
      ))}

      {/* Generated images below the last bubble */}
      {imageUrls && imageUrls.length > 0 && (
        <div
          className="generated-images"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginLeft: '57px', /* 45px avatar + 12px gap */
            marginTop: '6px',
            opacity: noAnimate ? 1 : 0,
            animation: noAnimate
              ? 'none'
              : `bubbleAppear 0.4s ease-out ${(baseAnimationIndex + bubbles.length) * 0.15}s forwards`,
          }}
        >
          {imageUrls.map((url, i) => {
            if (failedImages.has(i)) {
              // Show fallback placeholder for failed images
              return (
                <div
                  key={i}
                  className="generated-image-placeholder"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    color: '#888',
                    background: 'rgba(0,0,0,0.04)',
                    borderRadius: '8px',
                    padding: '6px 10px',
                  }}
                >
                  🖼️ AI Generated Image
                </div>
              );
            }
            return (
              <div
                key={i}
                style={{
                  borderRadius: '12px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.12)',
                  cursor: 'pointer',
                  transition: 'transform 0.2s',
                }}
                onClick={() => dispatch(openImageViewer(url))}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Generated image ${i + 1}`}
                  style={{ maxWidth: '280px', maxHeight: '320px', objectFit: 'cover', display: 'block', borderRadius: '12px' }}
                  loading="lazy"
                  onError={() => setFailedImages((prev) => new Set(prev).add(i))}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
