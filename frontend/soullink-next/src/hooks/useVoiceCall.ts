'use client';

/**
 * Voice call state machine hook — migrated from original index.html.
 *
 * Manages the full voice-call lifecycle:
 *   idle -> connecting -> listening -> processing -> speaking -> listening ...
 *
 * Key features (matching original implementation):
 * - getUserMedia with echoCancellation, noiseSuppression, autoGainControl
 * - RMS-based VAD using getByteTimeDomainData (fftSize=2048, 50ms polling)
 * - 1.5s silence timeout after speech to auto-send
 * - Interrupt detection: 1s grace period + 4-frame debounce (RMS > 0.08)
 * - Persistent <audio> element unlocked via silent WAV on user gesture
 * - AbortController for SSE stream cancellation on interrupt
 * - Web Audio API fallback for audio decoding
 * - MIME type detection (webm;codecs=opus → mp4 fallback)
 * - SSE currentEvent persists across chunks (for large base64 audio)
 */

import { useRef, useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  startCall,
  setCallState,
  tickCallSeconds,
  endCall,
} from '@/store/voiceSlice';
import { addMessage } from '@/store/chatSlice';
import { VOICE } from '@/lib/api/endpoints';
import { useAuthFetch } from './useAuthFetch';
import type { VoiceCallState } from '@/types';

// ==================== Constants (matching original index.html) ====================

/** VAD polling interval — 50ms for responsive detection */
const VAD_POLL_INTERVAL = 50;
/** Silence timeout after speech — 1.5s (original) */
const SILENCE_TIMEOUT_MS = 1500;
/** RMS threshold for speech detection in listening state */
const VAD_SPEECH_THRESHOLD = 0.015;
/** RMS threshold for interrupt detection in speaking state */
const VAD_INTERRUPT_THRESHOLD = 0.05;
/** Grace period after AI starts speaking — suppress interrupt for 0.8s */
const INTERRUPT_GRACE_MS = 800;
/** Consecutive frames above interrupt threshold needed — 6 frames (~120ms at 50fps).
 *  Rejects brief noise while responding to actual speech. */
const INTERRUPT_DEBOUNCE_FRAMES = 6;
/** Minimum blob size to process — skip too-short recordings */
const MIN_BLOB_SIZE = 300;
/** MediaRecorder chunk interval — 250ms (original) */
const RECORDER_CHUNK_MS = 250;
/** Delay after stopping recorder to collect final data */
const RECORDER_STOP_DELAY_MS = 150;
/** Silent WAV for unlocking audio playback on mobile */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// ==================== Helpers ====================

/** Detect best supported audio MIME type for MediaRecorder */
function getAudioMimeType(): string {
  if (typeof MediaRecorder !== 'undefined') {
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
      return 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  }
  return '';
}

/** Get file extension from MIME type */
function getAudioExt(mimeType: string): string {
  return mimeType.includes('mp4') ? 'm4a' : 'webm';
}

// ==================== Types ====================

interface UseVoiceCallReturn {
  /** Start a voice call session */
  start: () => Promise<void>;
  /** End the voice call and clean up */
  stop: () => void;
  /** Whether the call is currently active */
  isActive: boolean;
  /** Current state of the call pipeline */
  callState: VoiceCallState;
  /** Elapsed seconds in the call */
  callSeconds: number;
}

// ==================== Hook ====================

export function useVoiceCall(): UseVoiceCallReturn {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const conversationId = useAppSelector((s) => s.conversations.currentId);

  const isActive = useAppSelector((s) => s.voice.callActive);
  const callState = useAppSelector((s) => s.voice.callState);
  const callSeconds = useAppSelector((s) => s.voice.callSeconds);

  // ---- Refs for long-lived objects (survive re-renders) ----
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioRef = useRef<
    HTMLAudioElement | AudioBufferSourceNode | null
  >(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const activeRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const conversationIdRef = useRef(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const callStateRef = useRef<VoiceCallState>('idle');
  const speakingStartTimeRef = useRef(0);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef(0);
  const mimeTypeRef = useRef('');

  // Function refs for cross-referencing (breaks circular dependencies)
  const startRecordingRef = useRef<() => void>(() => {});
  const stopAndSendRef = useRef<() => Promise<void>>(async () => {});
  const playNextSegmentRef = useRef<() => void>(() => {});

  // Store last ASR transcript so we can add user message when reply arrives
  const lastTranscriptRef = useRef<string>('');

  // Keep conversationId ref in sync
  conversationIdRef.current = conversationId;

  // ---- State + ref updater (keeps callStateRef and Redux in sync) ----

  const setStateAndRef = useCallback(
    (state: VoiceCallState) => {
      callStateRef.current = state;
      dispatch(setCallState(state));
      if (state === 'speaking') {
        speakingStartTimeRef.current = Date.now();
      }
    },
    [dispatch],
  );

  // ---- Web Audio API fallback for audio decode ----

  const playViaWebAudio = useCallback(
    (arrayBuffer: ArrayBuffer, onDone: () => void) => {
      const ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'closed') {
        onDone();
        return;
      }
      if (ctx.state === 'suspended') ctx.resume();
      ctx.decodeAudioData(
        arrayBuffer,
        (audioBuffer) => {
          if (!activeRef.current) {
            onDone();
            return;
          }
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          currentAudioRef.current = source;
          source.onended = onDone;
          source.start(0);
        },
        () => {
          onDone();
        },
      );
    },
    [],
  );

  // ---- Audio playback queue (matching original _callPlayNextSegment) ----

  const playNextSegment = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    if (!activeRef.current) return;

    isPlayingRef.current = true;
    const b64 = audioQueueRef.current.shift()!;

    function onSegmentDone() {
      isPlayingRef.current = false;
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
      }
      if (audioQueueRef.current.length > 0) {
        playNextSegmentRef.current();
      } else if (activeRef.current) {
        // All segments done → back to listening
        setStateAndRef('listening');
        startRecordingRef.current();
      }
    }

    try {
      // Decode base64 → Blob URL (most reliable across browsers)
      const raw = atob(b64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      currentBlobUrlRef.current = URL.createObjectURL(blob);

      // Use the persistent unlocked <audio> element
      const el = audioElRef.current;
      if (!el) {
        onSegmentDone();
        return;
      }

      el.onended = onSegmentDone;
      el.onerror = () => onSegmentDone();
      el.src = currentBlobUrlRef.current;
      currentAudioRef.current = el;

      el.play().catch(() => {
        // Last resort: Web Audio API decode
        playViaWebAudio(buf.buffer.slice(0) as ArrayBuffer, onSegmentDone);
      });
    } catch {
      onSegmentDone();
    }
  }, [setStateAndRef, playViaWebAudio]);

  // Keep ref in sync
  playNextSegmentRef.current = playNextSegment;

  // ---- Stop recording and send audio via SSE (matching original _callStopAndSend) ----

  const stopAndSend = useCallback(async () => {
    if (!activeRef.current) return;

    // CRITICAL: Only send from listening state (prevents re-entry)
    // VAD fires every 50ms; without this guard, the 150ms await below
    // allows more VAD ticks that see state='listening' and call stopAndSend again
    {
      const currentState = callStateRef.current;
      if (currentState !== 'listening') return;
    }
    setStateAndRef('processing');

    // NOTE: Do NOT clear VAD interval here!
    // VAD must keep running during processing/speaking to detect user interrupt.

    // Stop recorder
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }

    // Wait for final data chunks
    await new Promise((r) => setTimeout(r, RECORDER_STOP_DELAY_MS));

    const mimeType =
      mediaRecorderRef.current?.mimeType ||
      mimeTypeRef.current ||
      'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    // Skip too-short recordings
    if (blob.size < MIN_BLOB_SIZE) {
      if (activeRef.current) {
        setStateAndRef('listening');
        startRecordingRef.current();
      }
      return;
    }

    try {
      const ext = getAudioExt(mimeType);
      const formData = new FormData();
      formData.append('audio', blob, `voice.${ext}`);
      formData.append('format', ext);
      formData.append('conversation_id', conversationIdRef.current || '');

      abortControllerRef.current = new AbortController();
      const resp = await authFetch(VOICE.CHAT_STREAM, {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!resp.ok || !resp.body) throw new Error('Stream failed');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotReply = false;
      audioQueueRef.current = [];
      isPlayingRef.current = false;

      // IMPORTANT: currentEvent must persist across reader.read() chunks!
      // Audio events are large (base64) and often split across multiple reads.
      // If we reset per-chunk, the data line arrives with currentEvent='' and gets lost.
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!activeRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const evtType = currentEvent;
            currentEvent = ''; // Reset AFTER consuming (original behavior)

            try {
              const payload = JSON.parse(line.slice(5).trim());

              switch (evtType) {
                case 'transcript':
                  // Store transcript so we can add user message to chat when reply arrives
                  if (payload.text) {
                    lastTranscriptRef.current = payload.text;
                  }
                  break;

                case 'audio':
                  // Audio arrives BEFORE reply (streaming LLM + real-time TTS)
                  if (
                    activeRef.current &&
                    callStateRef.current !== 'speaking'
                  ) {
                    setStateAndRef('speaking');
                  }
                  if (payload.audio_b64) {
                    audioQueueRef.current.push(payload.audio_b64);
                    playNextSegmentRef.current();
                  }
                  break;

                case 'reply': {
                  // Full reply text arrived — add both user + assistant messages to Redux
                  // so the chat list updates without needing a page refresh.
                  gotReply = true;
                  const ts = new Date().toISOString();
                  if (lastTranscriptRef.current) {
                    dispatch(addMessage({
                      role: 'user',
                      content: lastTranscriptRef.current,
                      timestamp: ts,
                    }));
                    lastTranscriptRef.current = '';
                  }
                  if (payload.text) {
                    // Strip [IMAGE:...] tags from voice reply before showing in chat
                    const cleanVoiceReply = payload.text
                      .replace(/\[IMAGE:[^\]]*\]/g, '')
                      .trim();
                    dispatch(addMessage({
                      role: 'assistant',
                      content: cleanVoiceReply,
                      thinking: payload.thinking || null,
                      timestamp: ts,
                    }));
                  }
                  break;
                }

                case 'error':
                  console.error(
                    '[VoiceCall] Server error:',
                    payload.message,
                  );
                  // ASR failure → silently go back to listening
                  if (payload.message === 'Could not recognize speech') {
                    setTimeout(() => {
                      if (activeRef.current) {
                        setStateAndRef('listening');
                        startRecordingRef.current();
                      }
                    }, 1200);
                    return;
                  }
                  break;

                case 'done':
                  // Only restart if audio already finished AND not already listening
                  if (
                    audioQueueRef.current.length === 0 &&
                    !isPlayingRef.current &&
                    activeRef.current &&
                    callStateRef.current !== 'listening'
                  ) {
                    setStateAndRef('listening');
                    startRecordingRef.current();
                  }
                  break;
              }
            } catch {
              // non-JSON data line, skip
            }
          } else if (line === '') {
            // Blank line = SSE event separator
            currentEvent = '';
          }
        }
      }

      // If no reply came, go back to listening
      if (!gotReply && activeRef.current) {
        setStateAndRef('listening');
        startRecordingRef.current();
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[VoiceCall] Error:', err);
      if (activeRef.current) {
        setStateAndRef('listening');
        startRecordingRef.current();
      }
    }
  }, [authFetch, setStateAndRef]);

  // Keep ref in sync
  stopAndSendRef.current = stopAndSend;

  // ---- Recording + VAD (matching original _callStartRecording) ----

  const startRecording = useCallback(() => {
    if (!activeRef.current || !mediaStreamRef.current) return;

    // Clear existing VAD interval to avoid duplicates
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    chunksRef.current = [];
    hasSpokenRef.current = false;
    silenceStartRef.current = 0;

    // Detect MIME type
    const mimeType = getAudioMimeType();
    mimeTypeRef.current = mimeType;

    // Create MediaRecorder
    try {
      const recorder = new MediaRecorder(
        mediaStreamRef.current,
        mimeType ? { mimeType } : {},
      );
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(RECORDER_CHUNK_MS);
    } catch (err) {
      console.error('[VoiceCall] Failed to start MediaRecorder:', err);
      return;
    }

    // VAD polling via AnalyserNode (RMS on time-domain data, matching original)
    const analyser = analyserRef.current;
    if (!analyser) return;

    const bufLen = analyser.fftSize; // 2048
    const dataArr = new Uint8Array(bufLen);
    let interruptCount = 0;

    vadIntervalRef.current = setInterval(() => {
      if (!activeRef.current) return;

      analyser.getByteTimeDomainData(dataArr);

      // Calculate RMS (Root Mean Square)
      let sum = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = (dataArr[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bufLen);

      // --- Interrupt: user speaks while AI is speaking ---
      if (callStateRef.current === 'speaking') {
        // Grace period: suppress interrupt for first 1s after speaking starts
        // Echo cancellation takes time to converge, initial audio burst causes false triggers
        if (Date.now() - speakingStartTimeRef.current < INTERRUPT_GRACE_MS) {
          interruptCount = 0;
          return;
        }
        if (rms > VAD_INTERRUPT_THRESHOLD) {
          interruptCount++;
        } else {
          interruptCount = 0;
        }
        if (interruptCount < INTERRUPT_DEBOUNCE_FRAMES) return;
        interruptCount = 0;

        // Interrupt confirmed!
        console.log('[VoiceCall] User interrupted, stopping AI audio');

        // Stop persistent audio element
        if (audioElRef.current) {
          try {
            audioElRef.current.pause();
            audioElRef.current.src = '';
          } catch {
            // already stopped
          }
        }
        // Stop Web Audio source if active
        if (
          currentAudioRef.current &&
          currentAudioRef.current !== audioElRef.current
        ) {
          try {
            (currentAudioRef.current as AudioBufferSourceNode).stop?.();
          } catch {
            // already stopped
          }
        }
        currentAudioRef.current = null;
        if (currentBlobUrlRef.current) {
          URL.revokeObjectURL(currentBlobUrlRef.current);
          currentBlobUrlRef.current = null;
        }
        audioQueueRef.current = [];
        isPlayingRef.current = false;

        // Abort ongoing SSE stream
        if (abortControllerRef.current) {
          try {
            abortControllerRef.current.abort();
          } catch {
            // already aborted
          }
          abortControllerRef.current = null;
        }

        // Restart recording for new speech
        setStateAndRef('listening');
        startRecordingRef.current();
        return;
      }

      // Only process VAD for speech detection in listening state
      if (callStateRef.current !== 'listening') return;

      if (rms > VAD_SPEECH_THRESHOLD) {
        // Speech detected
        hasSpokenRef.current = true;
        silenceStartRef.current = 0;
      } else if (hasSpokenRef.current) {
        // Silence after speech
        if (!silenceStartRef.current) {
          silenceStartRef.current = Date.now();
        } else if (Date.now() - silenceStartRef.current > SILENCE_TIMEOUT_MS) {
          // 1.5s of silence → auto-send
          stopAndSendRef.current();
          return;
        }
      }
    }, VAD_POLL_INTERVAL);
  }, [setStateAndRef]);

  // Keep ref in sync
  startRecordingRef.current = startRecording;

  // ---- Cleanup helper ----

  const cleanup = useCallback(() => {
    activeRef.current = false;

    // Stop VAD
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    // Stop call timer
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    // Stop recorder
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
    chunksRef.current = [];

    // Stop audio playback
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.src = '';
      } catch {
        // already stopped
      }
    }
    if (
      currentAudioRef.current &&
      currentAudioRef.current !== audioElRef.current
    ) {
      try {
        (currentAudioRef.current as AudioBufferSourceNode).stop?.();
      } catch {
        // already stopped
      }
    }
    currentAudioRef.current = null;
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    // Abort SSE
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {
        // already aborted
      }
      abortControllerRef.current = null;
    }

    // Release microphone
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect source node
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      sourceNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        // already closed
      }
      audioContextRef.current = null;
      analyserRef.current = null;
    }

    callStateRef.current = 'idle';
  }, []);

  // ---- Public API ----

  const start = useCallback(async () => {
    // Guard against re-entry (e.g. double-click or stale effect)
    if (activeRef.current) return;
    activeRef.current = true;
    dispatch(startCall());

    try {
      // Request microphone with audio processing constraints (matching original)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // Set up AudioContext + Analyser for VAD (fftSize=2048, matching original)
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      if (ctx.state === 'suspended') ctx.resume();

      // Create & unlock persistent <audio> element (user gesture = unlocked)
      if (!audioElRef.current) {
        const el = document.createElement('audio');
        el.id = '_call_audio_player';
        document.body.appendChild(el);
        audioElRef.current = el;
      }
      // Play silent WAV to fully unlock playback (critical for mobile browsers)
      audioElRef.current.src = SILENT_WAV;
      audioElRef.current.play().catch(() => {});

      // Start call timer
      callTimerRef.current = setInterval(() => {
        dispatch(tickCallSeconds());
      }, 1000);

      // Begin listening
      setStateAndRef('listening');
      startRecording();
    } catch (err) {
      console.error('[VoiceCall] Failed to start:', err);
      cleanup();
      dispatch(endCall());
    }
  }, [dispatch, startRecording, cleanup, setStateAndRef]);

  const stop = useCallback(() => {
    cleanup();
    // Remove persistent audio element from DOM
    if (audioElRef.current) {
      try {
        audioElRef.current.remove();
      } catch {
        // already removed
      }
      audioElRef.current = null;
    }
    dispatch(endCall());
  }, [cleanup, dispatch]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        cleanup();
        if (audioElRef.current) {
          try {
            audioElRef.current.remove();
          } catch {
            // already removed
          }
          audioElRef.current = null;
        }
      }
    };
  }, [cleanup]);

  return {
    start,
    stop,
    isActive,
    callState,
    callSeconds,
  };
}
