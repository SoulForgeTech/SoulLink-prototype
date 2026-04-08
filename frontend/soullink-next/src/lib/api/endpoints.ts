/**
 * SoulLink API Endpoint Constants
 *
 * All endpoint URLs organized by domain.
 * Base URL is read from NEXT_PUBLIC_API_BASE_URL environment variable.
 */

// Local dev: Next.js rewrites proxy routes /api/* → api.soulforgetech.com
// Production: deployed on same origin (Cloudflare Pages), no base needed
const BASE = '';

// ==================== Auth ====================
export const AUTH = {
  LOGIN: `${BASE}/api/auth/login`,
  REGISTER: `${BASE}/api/auth/register`,
  VERIFY_EMAIL: `${BASE}/api/auth/verify-email`,
  RESEND_CODE: `${BASE}/api/auth/resend-code`,
  FORGOT_PASSWORD: `${BASE}/api/auth/forgot-password`,
  RESET_PASSWORD: `${BASE}/api/auth/reset-password`,
  REFRESH: `${BASE}/api/auth/refresh`,
  VERIFY: `${BASE}/api/auth/verify`,
  LOGOUT: `${BASE}/api/auth/logout`,
  GOOGLE_CALLBACK: `${BASE}/api/auth/google/callback`,
} as const;

// ==================== User ====================
export const USER = {
  PROFILE: `${BASE}/api/user/profile`,
  SETTINGS: `${BASE}/api/user/settings`,
  CUSTOM_STATUS: `${BASE}/api/user/custom-status`,
  SEARCH_CHARACTER: `${BASE}/api/user/search-character`,
  IMPORT_PERSONA: `${BASE}/api/user/import-persona`,
  CONFIRM_PERSONA: `${BASE}/api/user/confirm-persona`,
  CLEAR_PERSONA: `${BASE}/api/user/clear-persona`,
  IMPORT_LORE: `${BASE}/api/user/import-lore`,
  CLEAR_LORE: `${BASE}/api/user/clear-lore`,
} as const;

// ==================== Chat ====================
export const CHAT = {
  SEND: `${BASE}/api/chat`,
  STREAM: `${BASE}/api/chat/stream`,
} as const;

// ==================== Conversations ====================
export const CONVERSATIONS = {
  LIST: `${BASE}/api/conversations`,
  CREATE: `${BASE}/api/conversations`,
  /** Returns the URL for a specific conversation. */
  detail: (id: string) => `${BASE}/api/conversations/${id}`,
  /** Alias for detail — used for PUT (rename). */
  update: (id: string) => `${BASE}/api/conversations/${id}`,
  /** Alias for detail — used for DELETE. */
  delete: (id: string) => `${BASE}/api/conversations/${id}`,
} as const;

// ==================== Voice ====================
export const VOICE = {
  LIST: `${BASE}/api/voice/list`,
  SEARCH: `${BASE}/api/voice/search`,
  /** Returns the URL for a specific voice model detail. */
  model: (id: string) => `${BASE}/api/voice/model/${id}`,
  PREVIEW: `${BASE}/api/voice/preview`,
  UPLOAD: `${BASE}/api/voice/upload`,
  TTS: `${BASE}/api/voice/tts`,
  CHAT_STREAM: `${BASE}/api/voice/chat-stream`,
} as const;

// ==================== Voice WebSocket (FastAPI voice server) ====================
const VOICE_WS_BASE = process.env.NEXT_PUBLIC_VOICE_WS_URL || 'ws://localhost:8001';
export const VOICE_WS = {
  /** Optimized pipeline: streaming STT → Gemini Flash → Fish Audio TTS */
  PIPELINE: `${VOICE_WS_BASE}/ws/voice`,
  /** Gemini Live S2S (Phase 2) */
  LIVE: `${VOICE_WS_BASE}/ws/voice-live`,
  /** Health check */
  HEALTH: `${VOICE_WS_BASE}/health`,
} as const;

// ==================== Upload ====================
export const UPLOAD = {
  AVATAR: `${BASE}/api/upload-avatar`,
  BACKGROUND: `${BASE}/api/upload-background`,
  DELETE_BACKGROUND: `${BASE}/api/delete-background`,
} as const;

// ==================== Image Edit ====================
export const IMAGE = {
  EDIT: `${BASE}/api/image/edit`,
} as const;

// ==================== Personality Test ====================
export const PERSONALITY = {
  STATUS: `${BASE}/api/personality-test/status`,
  QUESTIONS: `${BASE}/api/personality-test/questions`,
  SUBMIT: `${BASE}/api/personality-test/submit`,
} as const;

// ==================== Import ====================
export const IMPORT = {
  CHATGPT: `${BASE}/api/import/chatgpt`,
} as const;

// ==================== Workspace ====================
export const WORKSPACE = {
  INIT: `${BASE}/api/workspace`,
} as const;

// ==================== Feedback ====================
export const FEEDBACK = {
  SUBMIT: `${BASE}/api/feedback`,
} as const;

/**
 * All endpoints grouped together for convenience.
 */
export const ENDPOINTS = {
  AUTH,
  USER,
  CHAT,
  CONVERSATIONS,
  VOICE,
  UPLOAD,
  IMAGE,
  PERSONALITY,
  IMPORT,
  WORKSPACE,
  FEEDBACK,
} as const;
