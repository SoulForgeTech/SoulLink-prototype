'use client';

import { useRef } from 'react';
import { useAppSelector } from '@/store';
import { useExpressionWebP } from '@/hooks/useExpressionWebP';

interface FullCharacterPanelProps {
  onCollapse?: () => void;
}

const EMOTION_LABELS: Record<string, string> = {
  neutral: '😐 Calm',
  happy: '😊 Happy',
  sad: '😢 Sad',
  angry: '😠 Angry',
  surprised: '😲 Surprised',
  shy: '😳 Shy',
  thinking: '🤔 Thinking',
  loving: '🥰 Loving',
};

export default function FullCharacterPanel({ onCollapse }: FullCharacterPanelProps) {
  const imgRef = useRef<HTMLImageElement>(null);

  const currentEmotion = useAppSelector((s) => s.chat.currentEmotion) || 'neutral';
  const expressions = useAppSelector((s) => s.settings.characterExpressions);
  const displayMode = useAppSelector((s) => s.settings.characterDisplayMode);
  const companionName = useAppSelector((s) => s.settings.companionName);

  // Prefer webpUrls, fallback to legacy video URLs
  const webpUrls = expressions?.webpUrls
    || expressions?.idleVideos
    || expressions?.videos
    || null;

  useExpressionWebP(imgRef, webpUrls, currentEmotion);

  if (displayMode !== 'full' || !webpUrls) return null;

  return (
    <div className="full-character-panel">
      <div className="full-character-canvas-wrapper">
        {expressions?.neutralImage && (
          <img
            src={expressions.neutralImage as string}
            alt="character"
            className="full-character-neutral"
          />
        )}
        <img
          ref={imgRef}
          className="full-character-video"
          alt=""
          style={{ objectFit: 'contain' }}
        />
      </div>

      <div className="full-character-info">
        <div className="full-character-name">{companionName || 'AI'}</div>
        <div className="full-character-emotion">
          {EMOTION_LABELS[currentEmotion] || EMOTION_LABELS.neutral}
        </div>
      </div>

      <button className="full-character-collapse-btn" onClick={onCollapse}>
        ◀ Collapse
      </button>
    </div>
  );
}
