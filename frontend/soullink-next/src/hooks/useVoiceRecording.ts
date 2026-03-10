'use client';

/**
 * Push-to-talk voice recording hook.
 *
 * - Requests microphone permission on first recording.
 * - Records audio via MediaRecorder with 100ms chunks.
 * - Tracks duration (max 60s, auto-sends at limit).
 * - Returns start/stop/cancel controls and the recorded blob.
 * - After recording, uploads audio to /api/voice/upload for STT
 *   and then sends the transcribed text to /api/chat.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  startRecording as startRecordingAction,
  tickRecordingDuration,
  stopRecording as stopRecordingAction,
} from '@/store/voiceSlice';
import { uploadVoice } from '@/lib/api/voice';
import { streamChat } from '@/lib/api/chat';
import { addMessage } from '@/store/chatSlice';
import { setCurrentId } from '@/store/conversationsSlice';
import { useAuthFetch } from './useAuthFetch';

// ==================== Constants ====================

/** Maximum recording duration in seconds */
const MAX_DURATION_S = 60;
/** Chunk interval for MediaRecorder (ms) */
const CHUNK_INTERVAL = 100;
/** Audio MIME type */
const AUDIO_MIME = 'audio/webm';

// ==================== Types ====================

interface UseVoiceRecordingReturn {
  /** Start recording audio */
  startRecording: () => Promise<void>;
  /** Stop recording and return the blob */
  stopRecording: () => void;
  /** Cancel the current recording without saving */
  cancelRecording: () => void;
  /** Whether currently recording */
  isRecording: boolean;
  /** Current recording duration in seconds */
  duration: number;
  /** Whether the recording is being uploaded/processed */
  isUploading: boolean;
}

// ==================== Hook ====================

export function useVoiceRecording(): UseVoiceRecordingReturn {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const conversationId = useAppSelector((s) => s.conversations.currentId);

  const isRecording = useAppSelector((s) => s.voice.isRecording);
  const duration = useAppSelector((s) => s.voice.recordingDuration);
  const [isUploading, setIsUploading] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const durationRef = useRef(0);
  const conversationIdRef = useRef(conversationId);

  // Keep conversationId ref in sync
  conversationIdRef.current = conversationId;

  // ---- Upload and send via SSE stream (matches original index.html) ----

  const uploadAndSend = useCallback(
    async (blob: Blob, recordedDuration: number) => {
      if (blob.size === 0) return;
      setIsUploading(true);

      try {
        // 1. Upload audio for STT
        const uploadResult = await uploadVoice(authFetch, blob, 'webm');

        if (!uploadResult.success || !uploadResult.text) {
          console.error('Voice upload failed:', uploadResult.error);
          setIsUploading(false);
          return;
        }

        const transcript = uploadResult.text;
        // Use server-reported duration, fallback to our recorded duration
        const audioDuration = uploadResult.duration || recordedDuration;

        // 2. Add user voice message to chat
        dispatch(
          addMessage({
            role: 'user',
            content: transcript,
            audio_url: uploadResult.audio_url,
            audio_duration: audioDuration,
          }),
        );

        setIsUploading(false);

        // 3. Send transcribed text via SSE stream for AI response
        const response = await streamChat(authFetch, {
          message: transcript,
          conversationId: conversationIdRef.current,
        });

        if (!response.ok || !response.body) {
          console.error('Stream chat failed:', response.status);
          return;
        }

        // 4. Parse SSE events
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullReply = '';
        let replyThinking = '';
        let replyImages: string[] = [];
        let newConversationId = '';

        // Add empty assistant message that we'll update
        dispatch(addMessage({ role: 'assistant', content: '' }));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (!dataStr) continue;
              try {
                const data = JSON.parse(dataStr);
                switch (currentEvent) {
                  case 'text':
                    if (data.token) fullReply += data.token;
                    break;
                  case 'thinking':
                    if (data.content) replyThinking += data.content;
                    break;
                  case 'done':
                    if (data.reply) fullReply = data.reply;
                    if (data.thinking) replyThinking = data.thinking;
                    if (data.images) replyImages = data.images;
                    if (data.conversation_id) newConversationId = data.conversation_id;
                    break;
                  case 'error':
                    console.error('SSE error:', data.message);
                    break;
                }
              } catch {
                // non-JSON line
              }
            }
          }
        }

        // 5. Update the last assistant message with full content
        if (fullReply) {
          dispatch(
            addMessage({
              role: 'assistant',
              content: fullReply,
              thinking: replyThinking || undefined,
              image_urls: replyImages.length > 0 ? replyImages : undefined,
            }),
          );
        }

        // 6. Update conversation ID if this was a new conversation
        if (newConversationId && !conversationIdRef.current) {
          dispatch(setCurrentId(newConversationId));
        }
      } catch (err) {
        console.error('Voice recording upload/send failed:', err);
      } finally {
        setIsUploading(false);
      }
    },
    [authFetch, dispatch],
  );

  // ---- Cleanup helper ----

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // already stopped
      }
    }
    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    chunksRef.current = [];
    dispatch(stopRecordingAction());
  }, [dispatch]);

  // ---- Public API ----

  const startRecording = useCallback(async () => {
    cancelledRef.current = false;
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: AUDIO_MIME });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (cancelledRef.current) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: AUDIO_MIME });
        chunksRef.current = [];
        uploadAndSend(blob, durationRef.current);
      };

      recorder.start(CHUNK_INTERVAL);
      dispatch(startRecordingAction());

      // Duration timer
      durationRef.current = 0;
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        dispatch(tickRecordingDuration());
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording:', err);
      cleanup();
    }
  }, [dispatch, cleanup, uploadAndSend]);

  const stopRecording = useCallback(() => {
    cancelledRef.current = false;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    dispatch(stopRecordingAction());
  }, [dispatch]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    cleanup();
  }, [cleanup]);

  // Auto-send at max duration
  useEffect(() => {
    if (isRecording && duration >= MAX_DURATION_S) {
      stopRecording();
    }
  }, [isRecording, duration, stopRecording]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        cancelledRef.current = true;
        cleanup();
      }
    };
  }, [cleanup]);

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    isRecording,
    duration,
    isUploading,
  };
}
