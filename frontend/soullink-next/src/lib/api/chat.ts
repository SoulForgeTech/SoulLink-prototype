/**
 * Chat API functions.
 *
 * - streamChat: Returns the raw Response for SSE streaming (text, thinking, done events).
 * - sendMessage: Non-streaming chat — returns parsed JSON with reply + metadata.
 */

import { CHAT } from './endpoints';
import type { AuthFetchFn } from './client';
import type { ChatRequest, ChatResponse, MessageAttachment } from '@/types';

/**
 * Send a chat message via the SSE streaming endpoint.
 *
 * Returns the raw Response so the caller can read the ReadableStream body
 * for real-time typewriter rendering. The stream emits SSE events:
 *   - event: text      → { token: string }
 *   - event: thinking  → { content: string }
 *   - event: image_limit → {}
 *   - event: done      → { reply, conversation_id, thinking, images, companionNameChanged }
 *   - event: error     → { message: string }
 */
export async function streamChat(
  authFetch: AuthFetchFn,
  params: {
    message: string;
    conversationId?: string | null;
    showThinking?: boolean;
    attachments?: MessageAttachment[];
  },
): Promise<Response> {
  const body: ChatRequest = {
    message: params.message || '',
    conversation_id: params.conversationId,
    show_thinking: params.showThinking ?? true,
    attachments:
      params.attachments && params.attachments.length > 0
        ? params.attachments
        : undefined,
  };

  return authFetch(CHAT.STREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Send a chat message via the non-streaming endpoint.
 *
 * Used for voice messages and silent system notifications (e.g., companion rename).
 * Returns the full parsed response.
 */
export async function sendMessage(
  authFetch: AuthFetchFn,
  params: {
    message: string;
    conversationId?: string | null;
    showThinking?: boolean;
    type?: 'text' | 'voice';
    audioUrl?: string;
    audioDuration?: number;
    attachments?: MessageAttachment[];
  },
): Promise<ChatResponse> {
  const body: ChatRequest = {
    message: params.message || '',
    conversation_id: params.conversationId,
    show_thinking: params.showThinking ?? true,
    type: params.type,
    audio_url: params.audioUrl,
    audio_duration: params.audioDuration,
    attachments:
      params.attachments && params.attachments.length > 0
        ? params.attachments
        : undefined,
  };

  const response = await authFetch(CHAT.SEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Chat API error ${response.status}: ${text}`);
  }

  return response.json();
}
