'use client';

import { useRef } from 'react';
import { useAppSelector } from '@/store';
import { useExpressionVideo, type ExpressionVideos } from '@/hooks/useExpressionVideo';

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
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentEmotion = useAppSelector((s) => s.chat.currentEmotion) || 'neutral';
  const expressions = useAppSelector((s) => s.settings.characterExpressions);
  const displayMode = useAppSelector((s) => s.settings.characterDisplayMode);
  const companionName = useAppSelector((s) => s.settings.companionName);

  const videoConfig: ExpressionVideos | null = expressions?.videos
    ? {
        videos: expressions.videos as Record<string, string>,
        neutralImage: expressions.neutralImage as string | undefined,
      }
    : null;

  useExpressionVideo(videoRef, videoConfig, currentEmotion);

  if (displayMode !== 'full' || !videoConfig) return null;

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
        <video
          ref={videoRef}
          className="full-character-video"
          muted
          playsInline
          preload="none"
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
