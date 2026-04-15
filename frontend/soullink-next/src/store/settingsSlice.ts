import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Language } from '@/types';

// ==================== Types ====================

export interface SpriteSheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  emotions: string[];
  framesPerEmotion: number;
}

export interface CharacterExpressions {
  /** Animated WebP URLs per emotion (transparent, looping): { happy: "url.webp", ... } */
  webpUrls?: Record<string, string>;
  /** Legacy: Video URLs per emotion (kept for backward compat) */
  videos?: Record<string, string>;
  /** Legacy: Idle loop video URLs per emotion */
  idleVideos?: Record<string, string>;
  /** Neutral static image URL (shown when idle) */
  neutralImage?: string;
  /** Legacy sprite sheet fields (kept for backward compat) */
  fullSpriteSheet?: string;
  fullMeta?: SpriteSheetMeta;
  chibiSpriteSheet?: string;
  chibiMeta?: SpriteSheetMeta;
}

interface SettingsState {
  /** UI language: 'en' or 'zh-CN' */
  language: Language;
  /** AI model identifier */
  model: string;
  /** Companion display name */
  companionName: string;
  /** Companion avatar URL */
  companionAvatar: string;
  /** Chat background preset ID or 'custom' */
  chatBackground: string;
  /** Custom background image URL (when chatBackground === 'custom') */
  customBackgroundUrl: string;
  /** User bubble accent color */
  userBubbleColor: string;
  /** Selected voice preset ID */
  voicePresetId: string;
  /** Whether AI auto-replies with TTS voice */
  ttsEnabled: boolean;
  /** Whether psychology knowledge base is enabled */
  kbEnabled: boolean;
  /** Whether a custom persona is active (disables subtype selector) */
  customPersonaActive: boolean;
  /** Character expression sprite sheet data */
  characterExpressions: CharacterExpressions | null;
  /** Character display mode: micro (chibi on input bar), full (side panel), hidden */
  characterDisplayMode: 'micro' | 'full' | 'hidden';
  /** Expression visual style */
  expressionStyle: 'anime' | 'realistic' | '3d' | 'illustration';
}

// ==================== localStorage helpers ====================

const LANG_KEY = 'soullink_language';
const USER_KEY = 'soullink_user';

function detectDefaultLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'zh-CN' || stored === 'en') return stored;
    return navigator.language.startsWith('zh') ? 'zh-CN' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Read user settings from the soullink_user object in localStorage.
 * Returns partial settings — missing keys use defaults.
 */
function readUserSettings(): Partial<SettingsState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return {};
    const user = JSON.parse(raw);
    const s = user?.settings ?? {};
    return {
      model: s.model ?? '',
      companionName: s.companion_name ?? '',
      companionAvatar: s.companion_avatar ?? '',
      chatBackground: s.chat_background ?? 'default',
      customBackgroundUrl: s.custom_background_url ?? '',
      userBubbleColor: s.user_bubble_color ?? '',
      voicePresetId: s.voice_id ?? '',
      ttsEnabled: s.tts_enabled ?? false,
      kbEnabled: s.kb_enabled ?? false,
      customPersonaActive: s.custom_persona_active ?? false,
      characterExpressions: s.character_expressions ?? null,
      characterDisplayMode: s.character_display_mode ?? 'micro',
      expressionStyle: s.expression_style ?? 'anime',
    };
  } catch {
    return {};
  }
}

// ==================== Initial state ====================

const persisted = readUserSettings();

const initialState: SettingsState = {
  language: detectDefaultLanguage(),
  model: persisted.model ?? '',
  companionName: persisted.companionName ?? '',
  companionAvatar: persisted.companionAvatar ?? '',
  chatBackground: persisted.chatBackground ?? 'default',
  customBackgroundUrl: persisted.customBackgroundUrl ?? '',
  userBubbleColor: persisted.userBubbleColor ?? '',
  voicePresetId: persisted.voicePresetId ?? '',
  ttsEnabled: persisted.ttsEnabled ?? false,
  kbEnabled: persisted.kbEnabled ?? false,
  customPersonaActive: persisted.customPersonaActive ?? false,
  characterExpressions: persisted.characterExpressions ?? null,
  characterDisplayMode: persisted.characterDisplayMode ?? 'micro',
  expressionStyle: persisted.expressionStyle ?? 'anime',
};

// ==================== Helpers ====================

/** Persist language to its own localStorage key */
function persistLanguage(lang: Language) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // silent
  }
}

/**
 * Persist a setting field into the soullink_user.settings object in localStorage.
 * This ensures settings survive page refresh without waiting for a full user fetch.
 *
 * @param key   - The backend-style key (e.g. 'chat_background')
 * @param value - The value to persist
 */
function persistUserSetting(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(USER_KEY);
    const user = raw ? JSON.parse(raw) : {};
    if (!user.settings) user.settings = {};
    user.settings[key] = value;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // silent
  }
}

// ==================== Slice ====================

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setLanguage(state, action: PayloadAction<Language>) {
      state.language = action.payload;
      persistLanguage(action.payload);
    },

    setModel(state, action: PayloadAction<string>) {
      state.model = action.payload;
      persistUserSetting('model', action.payload);
    },

    setCompanionName(state, action: PayloadAction<string>) {
      state.companionName = action.payload;
      persistUserSetting('companion_name', action.payload);
    },

    setCompanionAvatar(state, action: PayloadAction<string>) {
      state.companionAvatar = action.payload;
      persistUserSetting('companion_avatar', action.payload);
    },

    setChatBackground(state, action: PayloadAction<string>) {
      state.chatBackground = action.payload;
      persistUserSetting('chat_background', action.payload);
    },

    setCustomBackgroundUrl(state, action: PayloadAction<string>) {
      state.customBackgroundUrl = action.payload;
      persistUserSetting('custom_background_url', action.payload);
    },

    setUserBubbleColor(state, action: PayloadAction<string>) {
      state.userBubbleColor = action.payload;
    },

    setVoicePresetId(state, action: PayloadAction<string>) {
      state.voicePresetId = action.payload;
      persistUserSetting('voice_id', action.payload);
    },

    setTtsEnabled(state, action: PayloadAction<boolean>) {
      state.ttsEnabled = action.payload;
      persistUserSetting('tts_enabled', action.payload);
    },

    setKbEnabled(state, action: PayloadAction<boolean>) {
      state.kbEnabled = action.payload;
      persistUserSetting('kb_enabled', action.payload);
    },

    setCustomPersonaActive(state, action: PayloadAction<boolean>) {
      state.customPersonaActive = action.payload;
      persistUserSetting('custom_persona_active', action.payload);
    },

    setCharacterExpressions(state, action: PayloadAction<CharacterExpressions | null>) {
      state.characterExpressions = action.payload;
      persistUserSetting('character_expressions', action.payload);
    },

    setCharacterDisplayMode(state, action: PayloadAction<'micro' | 'full' | 'hidden'>) {
      state.characterDisplayMode = action.payload;
      persistUserSetting('character_display_mode', action.payload);
    },

    setExpressionStyle(state, action: PayloadAction<'anime' | 'realistic' | '3d' | 'illustration'>) {
      state.expressionStyle = action.payload;
      persistUserSetting('expression_style', action.payload);
    },

    /** Bulk-update multiple settings at once (e.g. after fetching user profile) */
    updateSettings(state, action: PayloadAction<Partial<SettingsState>>) {
      const p = action.payload;
      // Persist each changed setting to localStorage
      if (p.model != null) persistUserSetting('model', p.model);
      if (p.companionName != null) persistUserSetting('companion_name', p.companionName);
      if (p.companionAvatar != null) persistUserSetting('companion_avatar', p.companionAvatar);
      if (p.chatBackground != null) persistUserSetting('chat_background', p.chatBackground);
      if (p.customBackgroundUrl != null) persistUserSetting('custom_background_url', p.customBackgroundUrl);
      if (p.userBubbleColor != null) persistUserSetting('user_bubble_color', p.userBubbleColor);
      if (p.voicePresetId != null) persistUserSetting('voice_id', p.voicePresetId);
      if (p.ttsEnabled != null) persistUserSetting('tts_enabled', p.ttsEnabled);
      if (p.kbEnabled != null) persistUserSetting('kb_enabled', p.kbEnabled);
      if (p.customPersonaActive != null) persistUserSetting('custom_persona_active', p.customPersonaActive);
      if (p.characterExpressions !== undefined) persistUserSetting('character_expressions', p.characterExpressions);
      if (p.characterDisplayMode != null) persistUserSetting('character_display_mode', p.characterDisplayMode);
      if (p.expressionStyle != null) persistUserSetting('expression_style', p.expressionStyle);
      return { ...state, ...p };
    },
  },
});

export const {
  setLanguage,
  setModel,
  setCompanionName,
  setCompanionAvatar,
  setChatBackground,
  setCustomBackgroundUrl,
  setUserBubbleColor,
  setVoicePresetId,
  setTtsEnabled,
  setKbEnabled,
  setCustomPersonaActive,
  setCharacterExpressions,
  setCharacterDisplayMode,
  setExpressionStyle,
  updateSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;
