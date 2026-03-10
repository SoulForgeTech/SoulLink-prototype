/**
 * Voice API functions.
 *
 * Covers voice preset listing, community search, model detail,
 * preview playback, voice upload (STT), TTS, and streaming voice chat.
 */

import { VOICE } from './endpoints';
import type { AuthFetchFn } from './client';
import type {
  VoiceListResponse,
  VoiceSearchResult,
  VoiceModelDetail,
  VoicePreviewResponse,
  VoiceUploadResponse,
  TTSResponse,
} from '@/types';

/**
 * Get the list of preset voices and the user's currently selected voice.
 *
 * @param lang - Frontend language: 'zh' or 'en'. Backend returns
 *               different preset names based on this.
 */
export async function getVoiceList(
  authFetch: AuthFetchFn,
  lang: 'zh' | 'en' = 'en',
): Promise<VoiceListResponse> {
  const resp = await authFetch(`${VOICE.LIST}?lang=${lang}`);

  if (!resp.ok) {
    throw new Error(`Failed to load voice list: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Search the Fish Audio community voice library.
 *
 * @param query - Search query string.
 * @param pageSize - Number of results to return (default 15).
 */
export async function searchVoices(
  authFetch: AuthFetchFn,
  query: string,
  pageSize: number = 15,
): Promise<VoiceSearchResult> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(pageSize),
  });

  const resp = await authFetch(`${VOICE.SEARCH}?${params}`);
  return resp.json();
}

/**
 * Get detailed info about a specific voice model (including sample audio URLs).
 */
export async function getVoiceModel(
  authFetch: AuthFetchFn,
  voiceId: string,
): Promise<VoiceModelDetail> {
  const resp = await authFetch(VOICE.model(voiceId));

  if (!resp.ok) {
    throw new Error(`Failed to get voice model: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Generate a short TTS preview for a given voice ID.
 * The backend sends a sample text through Fish Audio and returns base64 audio.
 */
export async function previewVoice(
  authFetch: AuthFetchFn,
  voiceId: string,
): Promise<VoicePreviewResponse> {
  const resp = await authFetch(VOICE.PREVIEW, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_id: voiceId }),
  });

  return resp.json();
}

/**
 * Upload a voice recording for speech-to-text transcription.
 *
 * The backend processes the audio (STT via Whisper/Gemini) and
 * stores it on CDN, returning the transcript and audio URL.
 *
 * @param blob - The audio blob (webm or m4a).
 * @param format - Audio format: 'webm' or 'm4a'.
 */
export async function uploadVoice(
  authFetch: AuthFetchFn,
  blob: Blob,
  format: 'webm' | 'm4a',
): Promise<VoiceUploadResponse> {
  const formData = new FormData();
  const ext = format === 'm4a' ? '.m4a' : '.webm';
  formData.append('audio', blob, `voice${ext}`);
  formData.append('format', format);

  const resp = await authFetch(VOICE.UPLOAD, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Voice upload failed ${resp.status}: ${text}`);
  }

  return resp.json();
}

/**
 * Request text-to-speech conversion for a given text.
 * Uses the user's currently selected voice ID.
 * Returns base64-encoded MP3 audio data.
 */
export async function textToSpeech(
  authFetch: AuthFetchFn,
  text: string,
): Promise<TTSResponse> {
  const resp = await authFetch(VOICE.TTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  return resp.json();
}

/**
 * Streaming voice chat — uploads audio and receives SSE stream
 * with transcript, reply text, and audio segments.
 *
 * Returns the raw Response for SSE consumption. The stream emits:
 *   - event: transcript → { text: string }
 *   - event: reply      → { text, conversation_id, thinking, images }
 *   - event: audio      → { audio_b64: string }
 *   - event: error      → { message: string }
 *   - event: done       → {}
 *
 * Note: This endpoint uses raw fetch with manual Authorization header
 * (not authFetch) in the original code, because it sends FormData.
 * Here we use authFetch which handles FormData correctly.
 */
export async function voiceChatStream(
  authFetch: AuthFetchFn,
  blob: Blob,
  format: 'webm' | 'm4a',
  conversationId?: string | null,
): Promise<Response> {
  const formData = new FormData();
  formData.append('audio', blob, `voice.${format}`);
  formData.append('format', format);
  formData.append('conversation_id', conversationId || '');

  return authFetch(VOICE.CHAT_STREAM, {
    method: 'POST',
    body: formData,
  });
}
