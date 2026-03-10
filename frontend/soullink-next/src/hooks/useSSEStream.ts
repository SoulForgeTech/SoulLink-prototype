'use client';

/**
 * SSE streaming hook for the chat endpoint.
 *
 * Connects to /api/chat/stream via authFetch, reads the SSE event stream,
 * and dispatches Redux actions for each event type:
 *   - text      → appendStreamText
 *   - thinking  → appendThinkingContent
 *   - image_limit → (ignored, informational)
 *   - done      → streamCompleted with final Message
 *   - error     → setError
 *
 * Includes IMAGE tag filtering: buffers any `[IMAGE:...]` content so it
 * never leaks into the displayed streaming text.
 *
 * Auto-retries on connection failure (QQ Browser / mobile compat).
 */

import { useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  startStreaming,
  appendStreamText,
  appendThinkingContent,
  setImageGenerating,
  streamCompleted,
  setError,
} from '@/store/chatSlice';
import { setCurrentId, addConversation, updateConversation } from '@/store/conversationsSlice';
import { setCompanionName } from '@/store/settingsSlice';
import { streamChat } from '@/lib/api/chat';
import { textToSpeech } from '@/lib/api/voice';
import type { AuthFetchFn } from '@/lib/api/client';
import type { Message, MessageAttachment, StreamDoneData, StreamDoneImage } from '@/types';

// ==================== Thinking Text Filter ====================

/**
 * Strips model-internal thinking blocks from streaming text.
 *
 * Handles two patterns emitted by Grok and similar models:
 *   1. <think>...</think>  (and variants: < think >, < /think >, etc.)
 *   2. ## 思考\n...  (Markdown heading section until next ## heading or </think>)
 *
 * Both patterns are buffered so partial matches across chunk boundaries are
 * handled correctly. Any thinking that leaks during streaming will still be
 * cleaned in the final done reply via regex, so this is best-effort.
 */
class ThinkingTextFilter {
  private buffer = '';
  private inBlock = false;
  // Regex that ends the current block
  private endRe: RegExp | null = null;

  process(chunk: string): string {
    this.buffer += chunk;
    let safe = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.inBlock) {
        const m = this.endRe!.exec(this.buffer);
        if (!m) {
          // End not found yet — keep buffering (discard; it's all thinking)
          // Keep enough chars that a split end-marker can be detected next time.
          const keep = 20;
          if (this.buffer.length > keep) {
            this.buffer = this.buffer.slice(this.buffer.length - keep);
          }
          break;
        }
        // Found end — discard up to and including end marker.
        this.buffer = this.buffer.slice(m.index + m[0].length);
        this.inBlock = false;
        this.endRe = null;
      } else {
        // Look for <think> (with optional spaces) or ## 思考
        const tIdx = this.buffer.search(/<\s*think\s*>/i);
        const mIdx = this.buffer.indexOf('## 思考');
        const startIdx =
          tIdx === -1 ? mIdx
          : mIdx === -1 ? tIdx
          : Math.min(tIdx, mIdx);

        if (startIdx === -1) {
          // No start marker — emit buffer minus a small tail (guards partial matches).
          const keep = 12; // length of "## 思考" in chars
          if (this.buffer.length > keep) {
            safe += this.buffer.slice(0, this.buffer.length - keep);
            this.buffer = this.buffer.slice(this.buffer.length - keep);
          }
          break;
        }

        // Emit everything before the start.
        safe += this.buffer.slice(0, startIdx);
        this.buffer = this.buffer.slice(startIdx);
        this.inBlock = true;

        if (startIdx === tIdx || tIdx !== -1 && tIdx < mIdx) {
          // <think> variant — end on </think>
          this.endRe = /<\s*\/\s*think\s*>/i;
          // Advance past opening tag.
          const openM = this.buffer.match(/^<\s*think\s*>/i);
          if (openM) this.buffer = this.buffer.slice(openM[0].length);
        } else {
          // ## 思考 variant — end on next ## heading or </think>
          this.endRe = /(?:\n(?=##\s)|<\s*\/\s*think\s*>)/i;
          // Advance past "## 思考" + rest of that line.
          const lineEnd = this.buffer.indexOf('\n');
          this.buffer = lineEnd !== -1 ? this.buffer.slice(lineEnd + 1) : '';
        }
      }
    }

    return safe;
  }

  flush(): string {
    // If we ended mid-block, discard the buffer (it's all thinking).
    const safe = this.inBlock ? '' : this.buffer;
    this.buffer = '';
    this.inBlock = false;
    this.endRe = null;
    return safe;
  }
}

// ==================== IMAGE Tag Filter ====================

/**
 * Filters out [IMAGE:...] tags from streaming text so they don't
 * appear as raw text in the chat bubble. Buffers partial matches.
 *
 * Also counts complete tags found (tagCount) so the caller can
 * dispatch imageGenerating state to Redux.
 */
class ImageTagFilter {
  private buffer = '';
  private static readonly TAG_START = '[IMAGE:';
  private static readonly TAG_END = ']';

  /** Number of complete IMAGE tags consumed since last reset. */
  tagCount = 0;

  /** Reset the tag counter (call after dispatching to Redux). */
  resetTagCount() {
    this.tagCount = 0;
  }

  /** Process a chunk and return the safe-to-display portion. */
  process(chunk: string): string {
    this.buffer += chunk;

    let safe = '';
    let i = 0;

    while (i < this.buffer.length) {
      const startIdx = this.buffer.indexOf(ImageTagFilter.TAG_START, i);

      if (startIdx === -1) {
        // No IMAGE tag in remaining buffer.
        // Keep last few chars in case a partial `[IMAGE:` is forming.
        const keepLen = ImageTagFilter.TAG_START.length - 1;
        if (this.buffer.length - i > keepLen) {
          safe += this.buffer.slice(i, this.buffer.length - keepLen);
          this.buffer = this.buffer.slice(this.buffer.length - keepLen);
        }
        break;
      }

      // Emit everything before the tag start (trimming trailing newlines that surround the tag).
      safe += this.buffer.slice(i, startIdx).replace(/\n+$/, '');

      const endIdx = this.buffer.indexOf(ImageTagFilter.TAG_END, startIdx + ImageTagFilter.TAG_START.length);
      if (endIdx === -1) {
        // Tag not yet closed — keep buffered.
        this.buffer = this.buffer.slice(startIdx);
        return safe;
      }

      // Full tag found — skip it entirely and count it.
      // Also skip any whitespace/newlines immediately following the tag.
      this.tagCount++;
      let afterTag = endIdx + 1;
      while (afterTag < this.buffer.length && (this.buffer[afterTag] === '\n' || this.buffer[afterTag] === '\r' || this.buffer[afterTag] === ' ')) {
        afterTag++;
      }
      i = afterTag;
    }

    if (i >= this.buffer.length) {
      this.buffer = '';
    }

    return safe;
  }

  /** Flush any remaining buffer (call when stream ends). */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }
}

// ==================== Reply Cleaner ====================

/**
 * Strip thinking blocks and IMAGE tags from a final reply string.
 * Applied to doneData.reply so message.content is always clean.
 */
function cleanReplyText(text: string): string {
  return text
    // Strip <think>...</think> (with optional whitespace inside tags)
    .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '')
    // Strip ## 思考 sections (from heading to next ## heading)
    .replace(/##\s*思考[\s\S]*?(?=\n##\s|$)/g, '')
    // Strip [IMAGE:...] tags
    .replace(/\[IMAGE:[^\]]*\]/g, '')
    .trim();
}

// ==================== SSE Parser ====================

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse a raw SSE text chunk into individual events.
 * Handles multi-line data fields and event boundaries.
 */
function parseSSEChunk(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = raw.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    let event = 'message';
    let data = '';

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trim();
      }
    }

    if (data) {
      events.push({ event, data });
    }
  }

  return events;
}

// ==================== Hook ====================

interface UseSSEStreamReturn {
  /** Start streaming a message. */
  sendStream: (params: {
    message: string;
    conversationId?: string | null;
    attachments?: MessageAttachment[];
  }) => Promise<void>;
  /** Abort the current stream. */
  abort: () => void;
}

export function useSSEStream(authFetch: AuthFetchFn): UseSSEStreamReturn {
  const dispatch = useAppDispatch();
  const model = useAppSelector((s) => s.settings.model);
  const ttsEnabled = useAppSelector((s) => s.settings.ttsEnabled);
  const abortRef = useRef<AbortController | null>(null);
  /** Ref to the currently playing TTS audio (auto-play) */
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const sendStream = useCallback(
    async (params: {
      message: string;
      conversationId?: string | null;
      attachments?: MessageAttachment[];
      isVoiceMessage?: boolean;
    }) => {
      // Abort any existing stream.
      abort();

      const controller = new AbortController();
      abortRef.current = controller;

      // Whether the model supports extended thinking.
      const showThinking = (model || '').includes('thinking') || (model || '').includes('gemini-2.5');

      dispatch(startStreaming());

      const thinkingFilter = new ThinkingTextFilter();
      const imageFilter = new ImageTagFilter();
      let retryCount = 0;
      const MAX_RETRIES = 2;

      const attemptStream = async (): Promise<void> => {
        try {
          const response = await streamChat(authFetch, {
            message: params.message,
            conversationId: params.conversationId,
            showThinking,
            attachments: params.attachments,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            dispatch(setError(`Stream failed: ${response.status} ${errorText}`));
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            dispatch(setError('No readable stream in response'));
            return;
          }

          const decoder = new TextDecoder();
          let sseBuffer = '';

          while (true) {
            if (controller.signal.aborted) {
              reader.cancel();
              return;
            }

            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const events = parseSSEChunk(sseBuffer);

            // Keep the last incomplete block in the buffer.
            const lastNewline = sseBuffer.lastIndexOf('\n\n');
            if (lastNewline !== -1) {
              sseBuffer = sseBuffer.slice(lastNewline + 2);
            }

            for (const evt of events) {
              switch (evt.event) {
                case 'text': {
                  try {
                    const parsed = JSON.parse(evt.data) as { token: string };
                    // 1. Strip thinking blocks, then IMAGE tags
                    const noThinking = thinkingFilter.process(parsed.token);
                    const filtered = imageFilter.process(noThinking);
                    if (filtered) dispatch(appendStreamText(filtered));
                  } catch {
                    // Non-JSON text event — pass through.
                    const noThinking = thinkingFilter.process(evt.data);
                    const filtered = imageFilter.process(noThinking);
                    if (filtered) dispatch(appendStreamText(filtered));
                  }
                  // Notify Redux if new IMAGE tags were found (shows shimmer)
                  if (imageFilter.tagCount > 0) {
                    dispatch(setImageGenerating(imageFilter.tagCount));
                    imageFilter.resetTagCount();
                  }
                  break;
                }

                case 'thinking': {
                  try {
                    const parsed = JSON.parse(evt.data) as { content: string };
                    dispatch(appendThinkingContent(parsed.content));
                  } catch {
                    dispatch(appendThinkingContent(evt.data));
                  }
                  break;
                }

                case 'done': {
                  try {
                    const doneData: StreamDoneData = JSON.parse(evt.data);

                    // Clean the reply: strip thinking blocks + IMAGE tags.
                    // This ensures message.content never shows model reasoning
                    // or raw [IMAGE:...] tags regardless of model quirks.
                    const cleanedReply = cleanReplyText(doneData.reply || '');

                    // Extract image URLs: backend sends [{url, b64, prompt}] objects.
                    const imageUrls: string[] | undefined = doneData.images?.map((img) => {
                      if (typeof img === 'string') return img;
                      const i = img as StreamDoneImage;
                      if (i.url) return i.url;
                      if (i.b64) return `data:image/png;base64,${i.b64}`;
                      return '';
                    }).filter(Boolean) as string[] | undefined;

                    // Build the final assistant message.
                    const assistantMsg: Message = {
                      role: 'assistant',
                      content: cleanedReply,
                      thinking: doneData.thinking || null,
                      image_urls: imageUrls,
                      timestamp: new Date().toISOString(),
                    };

                    dispatch(streamCompleted(assistantMsg));

                    // Update conversation ID if new.
                    if (doneData.conversation_id) {
                      if (!params.conversationId) {
                        dispatch(setCurrentId(doneData.conversation_id));
                        dispatch(
                          addConversation({
                            id: doneData.conversation_id,
                            title: params.message.slice(0, 40) || 'New Chat',
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                            last_message: params.message.slice(0, 80),
                          }),
                        );
                      } else {
                        dispatch(
                          updateConversation({
                            id: doneData.conversation_id,
                            updated_at: new Date().toISOString(),
                            last_message: doneData.reply?.slice(0, 80),
                          }),
                        );
                      }
                    }

                    // Companion name change (via in-chat rename).
                    if (doneData.companionNameChanged) {
                      dispatch(setCompanionName(doneData.companionNameChanged));
                    }

                    // TTS auto-play: only when user sent a voice message AND tts is enabled
                    if (ttsEnabled && params.isVoiceMessage && doneData.reply) {
                      // Stop any currently playing TTS
                      if (ttsAudioRef.current) {
                        ttsAudioRef.current.pause();
                        ttsAudioRef.current = null;
                      }
                      // Fire-and-forget TTS request
                      textToSpeech(authFetch, doneData.reply)
                        .then((ttsData) => {
                          if (ttsData.success && ttsData.audio_b64) {
                            const audio = new Audio(`data:audio/mp3;base64,${ttsData.audio_b64}`);
                            ttsAudioRef.current = audio;
                            audio.play().catch((e) => console.warn('TTS auto-play failed:', e));
                            audio.onended = () => { ttsAudioRef.current = null; };
                          }
                        })
                        .catch((e) => console.warn('TTS auto-play error:', e));
                    }
                  } catch {
                    dispatch(streamCompleted(undefined));
                  }
                  break;
                }

                case 'error': {
                  try {
                    const parsed = JSON.parse(evt.data) as { message: string };
                    dispatch(setError(parsed.message));
                  } catch {
                    dispatch(setError(evt.data || 'Stream error'));
                  }
                  break;
                }

                case 'image_limit':
                  // Informational — no action needed.
                  break;

                default:
                  break;
              }
            }
          }

          // Flush remaining content through both filters.
          const remainingThink = thinkingFilter.flush();
          const remaining = imageFilter.flush() + (remainingThink ? imageFilter.process(remainingThink) : '');
          if (remaining) {
            dispatch(appendStreamText(remaining));
          }
        } catch (err: unknown) {
          if (controller.signal.aborted) return;

          // Auto-retry on network failure (QQ Browser compat).
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.warn(`SSE stream failed, retrying (${retryCount}/${MAX_RETRIES})...`);
            await new Promise((r) => setTimeout(r, 1000 * retryCount));
            return attemptStream();
          }

          const message = err instanceof Error ? err.message : 'Stream connection failed';
          dispatch(setError(message));
        }
      };

      await attemptStream();
    },
    [authFetch, dispatch, model, ttsEnabled, abort],
  );

  return { sendStream, abort };
}
