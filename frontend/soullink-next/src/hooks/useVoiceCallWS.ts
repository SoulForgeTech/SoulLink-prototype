'use client';

/**
 * WebSocket Voice Call Hook — replaces SSE-based useVoiceCall.
 *
 * Key improvements over the original:
 *   - WebSocket full-duplex: binary audio frames (no base64 overhead)
 *   - Streaming STT: audio chunks sent in real-time (no batch upload)
 *   - Server-side VAD: Deepgram handles utterance detection
 *   - Client-side VAD: Silero VAD for interrupt detection (TODO: Phase 1.6)
 *   - Binary audio playback: direct MP3 bytes, no base64 decode
 *
 * State machine:
 *   idle → connecting → listening → processing → speaking → listening → ...
 *
 * Protocol (matches backend voice_server/voice_ws.py):
 *   Client → Server:
 *     - binary: audio chunks (PCM 16kHz 16-bit mono)
 *     - text JSON: {"type": "end_turn"} / {"type": "interrupt"} / {"type": "config"}
 *   Server → Client:
 *     - binary: TTS audio chunks (MP3)
 *     - text JSON: {"type": "transcript|reply|state|done|error", ...}
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
import type { VoiceCallState } from '@/types';

// ==================== Constants ====================

/**
 * WebSocket voice server base URL.
 * In production: wss://api.soulforgetech.com (same domain, Nginx routes /ws/* to FastAPI)
 * In dev: ws://localhost:8001
 */
function getWSBase(): string {
  // If explicit WS URL set, use it
  const envUrl = process.env.NEXT_PUBLIC_VOICE_WS_URL;
  if (envUrl) return envUrl;

  // Derive from API base URL (https://api.xxx → wss://api.xxx)
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBase) {
    return apiBase.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  }

  // Fallback for local dev
  return 'ws://localhost:8001';
}
const WS_BASE = getWSBase();

/** Audio recording settings */
const SAMPLE_RATE = 16000;
const CHUNK_INTERVAL_MS = 100; // Send audio every 100ms

/** VAD for silence detection (auto end_turn) and interrupt detection */
const VAD_POLL_INTERVAL = 50;
/** RMS threshold: speech detected when above this */
const VAD_SPEECH_THRESHOLD = 0.015;
/** Silence after speech — 1.5s triggers auto end_turn */
const SILENCE_TIMEOUT_MS = 1500;
/** Auto-interrupt disabled — user taps to interrupt instead */
const ENABLE_AUTO_INTERRUPT = false;
const VAD_INTERRUPT_THRESHOLD = 0.15;
const INTERRUPT_GRACE_MS = 2000;
const INTERRUPT_DEBOUNCE_FRAMES = 12;

/** Silent WAV for unlocking audio playback on mobile */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// ==================== Types ====================

interface UseVoiceCallWSReturn {
  start: () => Promise<void>;
  stop: () => void;
  /** Interrupt AI speech — stops playback and returns to listening */
  interrupt: () => void;
  isActive: boolean;
  callState: VoiceCallState;
  callSeconds: number;
}

// ==================== Hook ====================

export function useVoiceCallWS(): UseVoiceCallWSReturn {
  const dispatch = useAppDispatch();
  const conversationId = useAppSelector((s) => s.conversations.currentId);
  const isActive = useAppSelector((s) => s.voice.callActive);
  const callState = useAppSelector((s) => s.voice.callState);
  const callSeconds = useAppSelector((s) => s.voice.callSeconds);

  // ---- Refs ----
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const activeRef = useRef(false);
  const callStateRef = useRef<VoiceCallState>('idle');
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingStartTimeRef = useRef(0);
  const conversationIdRef = useRef(conversationId);
  const lastTranscriptRef = useRef('');

  // Keep refs in sync
  conversationIdRef.current = conversationId;

  // ---- State helpers ----

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

  // ---- Audio playback queue ----

  const playNextSegment = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    if (!activeRef.current) return;

    isPlayingRef.current = true;
    const buffer = audioQueueRef.current.shift()!;

    const blob = new Blob([buffer], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    const el = audioElRef.current;
    if (!el) {
      isPlayingRef.current = false;
      return;
    }

    const onDone = () => {
      isPlayingRef.current = false;
      URL.revokeObjectURL(url);
      if (audioQueueRef.current.length > 0) {
        playNextSegment();
      } else if (activeRef.current && callStateRef.current === 'speaking') {
        // All audio played — server will send "done" to transition state
      }
    };

    el.onended = onDone;
    el.onerror = () => onDone();
    el.src = url;
    el.play().catch(() => onDone());
  }, []);

  // ---- WebSocket message handler ----

  const handleWSMessage = useCallback(
    (event: MessageEvent) => {
      if (!activeRef.current) return;

      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        // Binary frame = TTS audio chunk
        // IMPORTANT: ignore audio arriving after interrupt (state is no longer speaking/processing)
        if (callStateRef.current === 'listening') {
          return; // Discard — this is leftover audio from before interrupt
        }

        const processAudio = (buffer: ArrayBuffer) => {
          if (callStateRef.current === 'listening') return; // Double-check
          if (callStateRef.current !== 'speaking') {
            setStateAndRef('speaking');
          }
          audioQueueRef.current.push(buffer);
          playNextSegment();
        };

        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then(processAudio);
        } else {
          processAudio(event.data);
        }
        return;
      }

      // Text frame = JSON control message
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'transcript':
            if (data.text) {
              lastTranscriptRef.current = data.text;
            }
            break;

          case 'reply': {
            // Full reply text — add to chat as voice call bubbles
            const ts = new Date().toISOString();
            if (lastTranscriptRef.current) {
              dispatch(
                addMessage({
                  role: 'user',
                  content: lastTranscriptRef.current,
                  timestamp: ts,
                  is_voice_call: true,
                }),
              );
              lastTranscriptRef.current = '';
            }
            if (data.text) {
              const cleanReply = data.text
                .replace(/\[IMAGE:[^\]]*\]/g, '')
                .trim();
              dispatch(
                addMessage({
                  role: 'assistant',
                  content: cleanReply,
                  thinking: data.thinking || null,
                  timestamp: ts,
                  is_voice_call: true,
                }),
              );
            }
            break;
          }

          case 'state':
            if (data.state === 'listening') {
              // DON'T clear audio here — let it finish playing naturally.
              // Audio is only cleared on explicit interrupt (sendInterrupt).
              // If we clear here, normal responses get cut off mid-sentence.
              setStateAndRef('listening');
            } else if (data.state === 'processing') {
              setStateAndRef('processing');
            } else if (data.state === 'speaking') {
              setStateAndRef('speaking');
            }
            break;

          case 'done':
            // Turn complete — already transitioned by 'state' message
            if (
              audioQueueRef.current.length === 0 &&
              !isPlayingRef.current &&
              activeRef.current
            ) {
              setStateAndRef('listening');
            }
            break;

          case 'error':
            console.error('[VoiceCallWS] Server error:', data.message);
            if (data.message === 'Could not recognize speech') {
              setTimeout(() => {
                if (activeRef.current) {
                  setStateAndRef('listening');
                }
              }, 800);
            }
            break;
        }
      } catch {
        // Non-JSON text, ignore
      }
    },
    [dispatch, setStateAndRef, playNextSegment],
  );

  // ---- Send interrupt signal ----

  const sendInterrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Stop audio playback
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.src = '';
      }
      audioQueueRef.current = [];
      isPlayingRef.current = false;

      // Tell server to stop
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
      console.log('[VoiceCallWS] Sent interrupt');
    }
  }, []);

  // ---- VAD for interrupt detection (RMS-based, TODO: replace with Silero) ----

  const startVAD = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
    }

    const analyser = analyserRef.current;
    if (!analyser) return;

    const bufLen = analyser.fftSize;
    const dataArr = new Uint8Array(bufLen);
    let interruptCount = 0;
    let hasSpoken = false;
    let silenceStart = 0;

    vadIntervalRef.current = setInterval(() => {
      if (!activeRef.current) return;

      analyser.getByteTimeDomainData(dataArr);
      let sum = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = (dataArr[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bufLen);

      // --- Silence detection in listening state → auto end_turn ---
      if (callStateRef.current === 'listening') {
        if (rms > VAD_SPEECH_THRESHOLD) {
          hasSpoken = true;
          silenceStart = 0;
        } else if (hasSpoken) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > SILENCE_TIMEOUT_MS) {
            // 1.5s silence after speech → stop recorder, send complete audio
            hasSpoken = false;
            silenceStart = 0;

            // Stop recorder to flush final data
            const rec = recorderRef.current;
            if (rec && rec.state !== 'inactive') {
              rec.stop();

              // Wait for final ondataavailable, then send complete blob
              setTimeout(() => {
                const chunks = recordedChunksRef.current;
                recordedChunksRef.current = [];

                if (chunks.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                  const mimeType = rec.mimeType || 'audio/webm';
                  const blob = new Blob(chunks, { type: mimeType });
                  console.log(`[VoiceCallWS] Sending audio: ${blob.size} bytes (${mimeType})`);
                  blob.arrayBuffer().then((buf) => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                      wsRef.current.send(buf);
                      wsRef.current.send(JSON.stringify({ type: 'end_turn' }));
                    }
                  });
                }

                // Restart recorder for next turn
                if (activeRef.current && recorderRef.current) {
                  try { recorderRef.current.start(250); } catch {}
                }
              }, 200); // Wait for final chunk
            }
          }
        }
        return; // Don't check interrupt in listening state
      }

      // --- Reset silence tracking when not listening ---
      hasSpoken = false;
      silenceStart = 0;

      // --- Auto-interrupt while AI speaking (DISABLED) ---
      if (ENABLE_AUTO_INTERRUPT && callStateRef.current === 'speaking') {
        if (Date.now() - speakingStartTimeRef.current < INTERRUPT_GRACE_MS) {
          interruptCount = 0;
          return;
        }
        if (rms > VAD_INTERRUPT_THRESHOLD) {
          interruptCount++;
        } else {
          interruptCount = 0;
        }
        if (interruptCount >= INTERRUPT_DEBOUNCE_FRAMES) {
          interruptCount = 0;
          sendInterrupt();
        }
      }
    }, VAD_POLL_INTERVAL);
  }, [sendInterrupt]);

  // ---- Start audio capture and send to WebSocket ----

  const startAudioCapture = useCallback(() => {
    if (!mediaStreamRef.current || !audioContextRef.current) return;

    const ctx = audioContextRef.current;
    const source = ctx.createMediaStreamSource(mediaStreamRef.current);
    sourceNodeRef.current = source;

    // Create analyser for VAD (interrupt detection)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;

    // Use MediaRecorder for high-quality audio capture (webm/opus)
    // Much better than ScriptProcessorNode raw PCM — browser's codec optimizes audio
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

    try {
      const recorder = new MediaRecorder(mediaStreamRef.current, {
        ...(mimeType ? { mimeType } : {}),
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && activeRef.current) {
          // Collect chunks — will be sent as complete blob on end_turn
          recordedChunksRef.current.push(e.data);
        }
      };

      // Produce chunks every 250ms
      recorder.start(250);
      console.log(`[VoiceCallWS] MediaRecorder started: ${recorder.mimeType}`);
    } catch (err) {
      console.error('[VoiceCallWS] MediaRecorder failed:', err);
    }

    startVAD();
  }, [startVAD]);

  // ---- Cleanup ----

  const cleanup = useCallback(() => {
    activeRef.current = false;

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

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

    // Stop MediaRecorder
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    recorderRef.current = null;
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }

    // Stop audio playback
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.src = '';
      } catch {}
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    // Release microphone
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
      analyserRef.current = null;
    }

    callStateRef.current = 'idle';
  }, []);

  // ---- Public API ----

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    dispatch(startCall());

    try {
      // 1. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: SAMPLE_RATE,
        },
      });
      mediaStreamRef.current = stream;

      // 2. Set up AudioContext — use browser's default sample rate
      //    (forcing 16kHz is not supported on all browsers, causes pitch distortion)
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx(); // Use default rate (usually 44100 or 48000)
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      console.log(`[VoiceCallWS] AudioContext sampleRate: ${ctx.sampleRate}`);

      // 3. Create & unlock audio element
      if (!audioElRef.current) {
        const el = document.createElement('audio');
        el.id = '_call_audio_ws';
        document.body.appendChild(el);
        audioElRef.current = el;
      }
      audioElRef.current.src = SILENT_WAV;
      audioElRef.current.play().catch(() => {});

      // 4. Connect WebSocket
      const token = localStorage.getItem('soullink_token') || '';
      const convId = conversationIdRef.current || '';
      const wsUrl = `${WS_BASE}/ws/voice?token=${encodeURIComponent(token)}&conversation_id=${encodeURIComponent(convId)}`;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log('[VoiceCallWS] Connected');
          resolve();
        };
        ws.onerror = (e) => {
          console.error('[VoiceCallWS] Connection error:', e);
          reject(new Error('WebSocket connection failed'));
        };
        // Timeout after 10s
        setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
      });

      ws.onmessage = handleWSMessage;
      ws.onclose = (e) => {
        console.log(`[VoiceCallWS] Closed: code=${e.code}, reason=${e.reason}`);
        if (activeRef.current) {
          // Unexpected close — end call
          cleanup();
          dispatch(endCall());
        }
      };

      // 5. Tell server our audio format (MediaRecorder uses webm/opus)
      ws.send(JSON.stringify({
        type: 'config',
        sample_rate: ctx.sampleRate,
        encoding: 'opus',
      }));

      // 6. Start audio capture
      startAudioCapture();

      // 7. Start call timer
      callTimerRef.current = setInterval(() => {
        dispatch(tickCallSeconds());
      }, 1000);

      setStateAndRef('listening');
    } catch (err) {
      console.error('[VoiceCallWS] Failed to start:', err);
      cleanup();
      dispatch(endCall());
    }
  }, [dispatch, handleWSMessage, startAudioCapture, cleanup, setStateAndRef]);

  const stop = useCallback(() => {
    // Send end signal to server
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'end_session' }));
      } catch {}
    }

    cleanup();
    if (audioElRef.current) {
      try {
        audioElRef.current.remove();
      } catch {}
      audioElRef.current = null;
    }
    dispatch(endCall());
  }, [cleanup, dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        cleanup();
        if (audioElRef.current) {
          try {
            audioElRef.current.remove();
          } catch {}
          audioElRef.current = null;
        }
      }
    };
  }, [cleanup]);

  return {
    start,
    stop,
    interrupt: sendInterrupt,
    isActive,
    callState,
    callSeconds,
  };
}
