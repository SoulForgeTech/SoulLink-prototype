'use client';

/**
 * Collapsible thinking/reasoning bubble.
 *
 * Displays the model's chain-of-thought content (extended thinking)
 * in a collapsible section. Starts collapsed by default.
 * Matches original index.html .thinking-bubble styles exactly.
 */

import { useState, useCallback, useMemo } from 'react';
import { useAppSelector } from '@/store';
import { renderMarkdown } from '@/lib/markdown';

// ==================== i18n ====================

const labels = {
  en: { header: 'Thought Process' },
  'zh-CN': { header: '\u601D\u8003\u8FC7\u7A0B' },
} as const;

// ==================== Types ====================

interface ThinkingBubbleProps {
  /** The thinking/reasoning text content. */
  content: string;
  /** Whether the thinking is still being streamed. */
  isStreaming?: boolean;
}

// ==================== Component ====================

export default function ThinkingBubble({
  content,
  isStreaming = false,
}: ThinkingBubbleProps) {
  const language = useAppSelector((s) => s.settings.language);
  const t = labels[language] || labels.en;

  const [isCollapsed, setIsCollapsed] = useState(true);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // Render thinking content as markdown.
  const html = useMemo(() => renderMarkdown(content), [content]);

  if (!content) return null;

  return (
    <div
      className={`thinking-bubble ${isCollapsed ? 'collapsed' : ''}`}
      onClick={toggleCollapsed}
      style={{ animation: 'bubbleAppear 0.3s ease-out both' }}
    >
      {/* Header */}
      <div className="thinking-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11 }}>
            {isStreaming ? (
              <span style={{ animation: 'pulse-soft 1.5s ease-in-out infinite', display: 'inline-block' }}>
                {'\uD83D\uDCAD'}
              </span>
            ) : (
              '\uD83D\uDCAD'
            )}
          </span>
          <span>{t.header}</span>
          {isStreaming && <span style={{ marginLeft: 4, opacity: 0.5 }}>...</span>}
        </div>
        <span className="thinking-chevron">▼</span>
      </div>

      {/* Collapsible text content */}
      <div
        className="thinking-text"
        onClick={(e) => e.stopPropagation()}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {isStreaming && !isCollapsed && (
        <span className="typing-cursor" style={{ marginLeft: 10, marginBottom: 8, color: 'rgba(60,50,90,0.4)' }} />
      )}
    </div>
  );
}
