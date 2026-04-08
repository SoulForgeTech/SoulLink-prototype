'use client';

/**
 * Messages container / message list.
 *
 * Renders all messages in the current conversation:
 *   - Welcome message when the conversation is empty
 *   - TimeSeparator between messages with >5min gaps
 *   - User messages as MessageBubble
 *   - Assistant messages as MultiBubbleGroup (with ThinkingBubble)
 *   - TypingIndicator when loading (before streaming)
 *   - StreamingBubble when actively streaming
 *
 * Auto-scrolls to the bottom on new messages.
 */

import { useRef, useEffect, useMemo } from 'react';
import { useAppSelector } from '@/store';
import { shouldShowTimeSeparator, formatMessageTime } from '@/lib/utils';
import type { Message } from '@/types';
import MessageBubble from './MessageBubble';
import MultiBubbleGroup from './MultiBubbleGroup';
import ThinkingBubble from './ThinkingBubble';
import TypingIndicator from './TypingIndicator';
import StreamingBubble from './StreamingBubble';
import PersonaDetectedBanner from './PersonaDetectedBanner';

// ==================== i18n ====================

const welcomeLabels = {
  en: {
    title: 'Welcome back!',
    subtitle: "Start a conversation with your AI companion. I'm here to chat, help, and keep you company.",
  },
  'zh-CN': {
    title: '\u6B22\u8FCE\u56DE\u6765\uFF01',
    subtitle: '\u5F00\u59CB\u548C\u4F60\u7684AI\u4F34\u4FA3\u804A\u5929\u5427\u3002\u6211\u4F1A\u4E00\u76F4\u9675\u4F34\u4F60\u3002',
  },
} as const;

// ==================== Time Separator ====================

function TimeSeparator({ timestamp, language }: { timestamp: string; language: string }) {
  const formatted = useMemo(
    () => formatMessageTime(timestamp, language),
    [timestamp, language],
  );

  if (!formatted) return null;

  return (
    <div className="time-separator">
      <span>{formatted}</span>
    </div>
  );
}

// ==================== Welcome Message ====================

function WelcomeMessage({ language }: { language: string }) {
  const companionName = useAppSelector((s) => s.settings.companionName);
  const companionAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const t = welcomeLabels[language as keyof typeof welcomeLabels] || welcomeLabels.en;

  return (
    <div className="welcome-container">
      {/* Companion avatar */}
      <div className="welcome-avatar" style={{ animation: 'pulse 3s ease-in-out infinite' }}>
        {companionAvatar ? (
          <img
            src={companionAvatar}
            alt={companionName || 'AI'}
            width={80}
            height={80}
          />
        ) : (
          <div className="welcome-avatar-placeholder">
            {(companionName || 'AI')[0]}
          </div>
        )}
      </div>

      {/* Welcome text */}
      <h2 className="welcome-title">
        {t.title}
      </h2>
      <p className="welcome-subtitle">
        {t.subtitle}
      </p>
    </div>
  );
}

// ==================== Component ====================

interface MessageListProps {
  /** Optional TTS callback. */
  onTTS?: (text: string) => void;
  /** Optional image edit callback — receives image source + edit prompt. */
  onImageEdit?: (imageDataUrl: string, prompt: string) => void;
}

export default function MessageList({ onTTS, onImageEdit }: MessageListProps) {
  const messages = useAppSelector((s) => s.chat.messages);
  const isLoading = useAppSelector((s) => s.chat.isLoading);
  const isStreaming = useAppSelector((s) => s.chat.isStreaming);
  const thinkingContent = useAppSelector((s) => s.chat.thinkingContent);
  const language = useAppSelector((s) => s.settings.language);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  // Track how many messages were loaded from history (no entrance animation for these)
  const historyCountRef = useRef(0);

  // Auto-scroll to bottom on new messages or streaming updates.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const prevCount = prevMsgCountRef.current;
    const currCount = messages.length;
    prevMsgCountRef.current = currCount;

    // On initial load or conversation switch (messages jumped from 0 to many),
    // scroll instantly to bottom without smooth animation.
    if (prevCount === 0 && currCount > 0) {
      historyCountRef.current = currCount;
      // Use requestAnimationFrame to ensure DOM has rendered
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
      return;
    }

    // For incremental messages (new message sent/received), only auto-scroll
    // if user is near the bottom (within 200px).
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 200;

    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isStreaming, isLoading]);

  // Determine if we should show the welcome message.
  const isEmpty = messages.length === 0 && !isLoading && !isStreaming;

  return (
    <div
      ref={scrollContainerRef}
      className="messages-scrollbar"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '90px 24px 24px 24px',
      }}
    >
      {isEmpty && <WelcomeMessage language={language} />}

      {!isEmpty && (
        <div className="messages-container">
          {messages.map((msg: Message, index: number) => {
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const showTime = shouldShowTimeSeparator(prevMsg, msg);
            // History messages: skip entrance animation
            const isHistory = index < historyCountRef.current;

            // Skip system messages.
            if (msg.role === 'system') return null;

            return (
              <div key={msg.id || `msg-${index}`}>
                {/* Time separator */}
                {showTime && msg.timestamp && (
                  <TimeSeparator timestamp={msg.timestamp} language={language} />
                )}

                {/* User message */}
                {msg.role === 'user' && (
                  <MessageBubble
                    role="user"
                    content={msg.content}
                    attachments={msg.attachments}
                    audioUrl={msg.audio_url}
                    audioDuration={msg.audio_duration}
                    isVoiceCall={msg.is_voice_call}
                    animationIndex={isHistory ? -1 : 0}
                    onImageEdit={onImageEdit}
                  />
                )}

                {/* Assistant message */}
                {msg.role === 'assistant' && (
                  <div className="assistant-message-group">
                    {/* Thinking bubble (if present) */}
                    {msg.thinking && (
                      <ThinkingBubble content={msg.thinking} />
                    )}

                    {/* Voice call bubble — compact style */}
                    {msg.is_voice_call ? (
                      <MessageBubble
                        role="assistant"
                        content={msg.content}
                        isVoiceCall
                        showAvatar
                        animationIndex={isHistory ? -1 : 0}
                      />
                    ) : msg.audio_url ? (
                      /* Recorded voice message with waveform */
                      <MessageBubble
                        role="assistant"
                        content={msg.content}
                        audioUrl={msg.audio_url}
                        audioDuration={msg.audio_duration}
                        showAvatar
                        animationIndex={isHistory ? -1 : 0}
                      />
                    ) : (
                      /* Multi-bubble text response */
                      <MultiBubbleGroup
                        content={msg.content}
                        imageUrls={msg.image_urls || (msg.image_url ? [msg.image_url] : undefined)}
                        showAvatar
                        onTTS={onTTS}
                        noAnimate={isHistory}
                        onImageEdit={onImageEdit}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Live thinking bubble (while streaming) */}
          {isStreaming && thinkingContent && (
            <ThinkingBubble content={thinkingContent} isStreaming />
          )}

          {/* Typing indicator (loading, not yet streaming) */}
          {isLoading && !isStreaming && (
            <TypingIndicator />
          )}

          {/* Streaming bubble */}
          {isStreaming && (
            <StreamingBubble showAvatar onTTS={onTTS} />
          )}

          {/* Persona preset detection banner */}
          <PersonaDetectedBanner />

          {/* Scroll anchor */}
          <div ref={bottomRef} className="scroll-anchor" />
        </div>
      )}
    </div>
  );
}
