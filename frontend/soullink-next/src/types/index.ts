// ==================== User & Auth ====================

export interface UserSettings {
  companion_name?: string;
  companion_avatar?: string;
  companion_gender?: 'male' | 'female';
  companion_relationship?: string;
  companion_subtype?: string;
  chat_background?: string;
  custom_background_url?: string;
  user_bubble_color?: string;
  voice_id?: string;
  voice_name?: string;
  tts_enabled?: boolean;
  kb_enabled?: boolean;
  custom_persona_active?: boolean;
  custom_persona_name?: string;
  custom_persona_text?: string;
  model?: string;
  image_appearance?: string;
  language?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  avatar_url?: string;
  avatar_color?: string;
  workspace_slug?: string;
  settings?: UserSettings;
  created_at?: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  refresh_token?: string;
  user?: User;
  error?: string;
  requires_verification?: boolean;
  email?: string;
}

export interface RefreshResponse {
  token: string;
  user: User;
}

// ==================== Chat & Messages ====================

export interface MessageAttachment {
  name: string;
  isImage?: boolean;
  mime?: string;
  contentString?: string;
  dataUrl?: string;
  /** CDN URL for images loaded from DB (no local dataUrl after refresh) */
  url?: string;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string | null;
  timestamp?: string;
  image_url?: string;
  image_urls?: string[];
  voice_url?: string;
  attachments?: MessageAttachment[];
  audio_url?: string;
  audio_duration?: number;
  /** True for messages from voice call (show as voice bubble, not text) */
  is_voice_call?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: string;
  imported_from?: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  messages: Message[];
  updated_at?: string;
}

export interface ChatRequest {
  message: string;
  conversation_id?: string | null;
  show_thinking?: boolean;
  type?: 'text' | 'voice';
  audio_url?: string;
  audio_duration?: number;
  attachments?: MessageAttachment[];
}

export interface ChatResponse {
  success: boolean;
  reply: string;
  conversation_id?: string;
  thinking?: string;
  images?: string[];
  reply_audio_b64?: string;
  companionNameChanged?: string;
  error?: string;
}

/** Image object returned by backend in the done event */
export interface StreamDoneImage {
  url?: string;
  b64?: string;
  prompt?: string;
}

export interface StreamDoneData {
  reply: string;
  conversation_id?: string;
  thinking?: string;
  /** Backend returns array of image objects {url, b64, prompt} */
  images?: StreamDoneImage[] | string[];
  companionNameChanged?: string;
  /** Backend detected a character preset in the user message and extracted it */
  personaDetected?: {
    name: string | null;
    core_persona: string;
    appearance?: string;
  };
}

// ==================== Voice ====================

export type VoiceCallState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking';

export interface VoicePreset {
  id: string;
  name: string;
  gender?: string;
  language?: string;
  languages?: string[];
  cover_image?: string;
  author?: string;
  task_count?: number;
}

export interface VoiceListResponse {
  voices: VoicePreset[];
  current_voice_id?: string;
  current_voice_name?: string;
}

export interface VoiceSearchResult {
  voices: VoicePreset[];
  error?: string;
}

export interface VoiceModelDetail {
  id: string;
  name: string;
  samples?: { audio: string }[];
}

export interface VoicePreviewResponse {
  success: boolean;
  audio_b64?: string;
}

export interface VoiceUploadResponse {
  success: boolean;
  text?: string;
  audio_url?: string;
  duration?: number;
  error?: string;
}

export interface TTSResponse {
  success: boolean;
  audio_b64?: string;
  error?: string;
}

// ==================== Personality Test ====================

export interface PersonalityQuestion {
  id: number | string;
  text: string;
  text_zh?: string;
  type?: 'mbti' | 'normal';
  dimension?: string;
  hint?: string;
  skip_text?: string;
  options: PersonalityOption[] | string[];
}

export interface PersonalityOption {
  text: string;
  text_zh?: string;
  score: number;
}

export interface PersonalityAnswer {
  question_id: number | string;
  score: number;
}

export interface TarotCard {
  index?: number;
  card_id?: number;
  card_numeral?: string;
  name: string;
  /** Backend may return card_name instead of name */
  card_name?: string;
  name_zh?: string;
  card_name_zh?: string;
  icon?: string;
  image?: string;
  meaning?: string;
  traits?: string;
  traits_en?: string;
  traits_zh?: string;
  position?: string;
}

export interface PersonalityTestStatus {
  completed: boolean;
}

export interface PersonalityTestResult {
  success: boolean;
  tarot_cards?: TarotCard[];
  dimensions?: Record<string, number>;
  error?: string;
}

export interface PersonalityResult {
  mbti: string;
  dimensions: Record<string, number>;
  tarot_cards?: TarotCard[];
  description?: string;
}

// ==================== Persona & Lore ====================

export interface PersonaPreview {
  core_persona: string;
  name?: string;
  appearance?: string;
}

export interface SearchCharacterResponse {
  success: boolean;
  description?: string;
  error?: string;
}

export interface ImportPersonaResponse {
  success: boolean;
  preview?: PersonaPreview;
  error?: string;
}

export interface ConfirmPersonaResponse {
  success: boolean;
  error?: string;
}

export interface CustomStatusResponse {
  persona?: {
    active: boolean;
    name?: string;
    imported_at?: string;
  };
  lore?: {
    docs: LoreDocument[];
    max_docs: number;
  };
}

export interface LoreDocument {
  id: string;
  doc_name?: string;
  original_filename?: string;
  status: 'ready' | 'processing' | 'failed';
  imported_at?: string;
}

export interface ImportLoreResponse {
  success: boolean;
  error?: string;
}

export interface ImportChatGPTResponse {
  success: boolean;
  imported_count?: number;
  total_messages?: number;
  error?: string;
}

// ==================== Feedback ====================

export interface FeedbackRequest {
  type: 'suggestion' | 'bug' | 'other';
  content: string;
}

// ==================== UI Constants ====================

export interface BackgroundDef {
  id: string;
  file: string;
  path?: string;
  thumb: string;
  label?: string;
}

export interface AmbientSoundDef {
  id: string;
  category: 'rain' | 'nature' | 'urban' | 'noise';
  emoji: string;
  src: string;
}

export interface ModelDef {
  id: string;
  name: string;
  iconClass: string;
  svg: string;
  desc_en: string;
  desc_zh: string;
  badge_en: string;
  badge_zh: string;
  hasThinking: boolean;
  recommended?: boolean;
}

export interface SubtypeDef {
  id: string;
  icon: string;
  name_zh: string;
  name_en: string;
  desc_zh: string;
  desc_en: string;
}

// ==================== UI ====================

export type SettingsTab = 'profile' | 'companion' | 'advanced' | 'memory';

export type ModalName =
  | 'settings'
  | 'changelog'
  | 'about'
  | 'rename'
  | 'crop'
  | 'companionAvatar'
  | 'community';

export type PanelName = 'backgroundPicker' | 'ambientSound' | 'games';

// ==================== Image Generation ====================

export interface GeneratedImage {
  url: string;
  prompt?: string;
  provider?: 'xai' | 'fal';
  timestamp?: string;
}

// ==================== Settings ====================

export type Language = 'en' | 'zh-CN';
export type AIModel = string;

// ==================== Games ====================

export type GameId = 'breathing' | 'bubbles' | 'zen' | 'colormix' | 'shapes';

export interface MiniGame {
  id: GameId;
  emoji: string;
  nameKey: string;
}
