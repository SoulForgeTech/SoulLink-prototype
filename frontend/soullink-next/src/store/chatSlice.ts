import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Message } from '@/types';

// ==================== Types ====================

interface ChatState {
  /** All messages in the active conversation */
  messages: Message[];
  /** Whether a send request is in-flight */
  isLoading: boolean;
  /** Whether we are currently receiving an SSE stream */
  isStreaming: boolean;
  /** Accumulated text from the current SSE stream */
  streamingText: string;
  /** Thinking / reasoning content from the model (e.g. extended thinking) */
  thinkingContent: string;
  /** Number of images currently being generated (0 = none) */
  imageGeneratingCount: number;
  /** Number of images currently being edited via Kontext (0 = none) */
  imageEditingCount: number;
  /** Last error message, if any */
  error: string | null;
  /** Detected character preset from chat message (pending user confirmation) */
  detectedPersona: {
    name: string | null;
    core_persona: string;
    appearance?: string;
  } | null;
}

const initialState: ChatState = {
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingText: '',
  thinkingContent: '',
  imageGeneratingCount: 0,
  imageEditingCount: 0,
  error: null,
  detectedPersona: null,
};

// ==================== Slice ====================

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    /** Replace the entire messages array (e.g. when loading a conversation) */
    setMessages(state, action: PayloadAction<Message[]>) {
      // Map MongoDB attachments → image_urls for display compatibility.
      // Also strip [IMAGE:...] tags from assistant message content (DB may store raw reply).
      state.messages = action.payload.map((msg) => {
        let updated = msg;
        // Map MongoDB "type: voice" to is_voice_call for voice call bubble rendering
        if ((msg as Record<string, unknown>).type === 'voice' && !msg.audio_url) {
          updated = { ...updated, is_voice_call: true };
        }
        // Strip IMAGE tags + thinking blocks from assistant content
        if (msg.role === 'assistant' && msg.content) {
          const cleaned = msg.content
            .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '')
            .replace(/##\s*思考[\s\S]*?(?=\n##\s|$)/g, '')
            .replace(/\[IMAGE(?:_EDIT)?:[^\]]*\]/g, '')
            .trim();
          if (cleaned !== msg.content) {
            updated = { ...updated, content: cleaned };
          }
        }
        if (updated.attachments && Array.isArray(updated.attachments) && !updated.image_urls) {
          const imageUrls = (updated.attachments as Array<{ url?: string; isImage?: boolean }>)
            .filter((a) => a.isImage && a.url)
            .map((a) => a.url!);
          if (imageUrls.length > 0) {
            return { ...updated, image_urls: imageUrls };
          }
        }
        return updated;
      });
      state.error = null;
    },

    /** Append a single message (user or assistant) */
    addMessage(state, action: PayloadAction<Message>) {
      state.messages.push(action.payload);
    },

    /** Replace the last message (used for image edit placeholder → result) */
    replaceLastMessage(state, action: PayloadAction<Message>) {
      if (state.messages.length > 0) {
        state.messages[state.messages.length - 1] = action.payload;
      }
    },

    /** Set detected persona from chat (pending user confirmation) */
    setDetectedPersona(state, action: PayloadAction<{ name: string | null; core_persona: string; appearance?: string }>) {
      state.detectedPersona = action.payload;
    },

    /** Clear detected persona (after confirm or dismiss) */
    clearDetectedPersona(state) {
      state.detectedPersona = null;
    },

    /** Mark the start of an SSE stream */
    startStreaming(state) {
      state.isStreaming = true;
      state.isLoading = true;
      state.streamingText = '';
      state.thinkingContent = '';
      state.imageGeneratingCount = 0;
      state.imageEditingCount = 0;
      state.error = null;
    },

    /** Set the number of images being generated (0 clears the placeholder) */
    setImageGenerating(state, action: PayloadAction<number>) {
      state.imageGeneratingCount = action.payload;
    },

    /** Set the number of images being edited (0 clears the placeholder) */
    setImageEditing(state, action: PayloadAction<number>) {
      state.imageEditingCount = action.payload;
    },

    /** Append a chunk of text from the SSE stream */
    appendStreamText(state, action: PayloadAction<string>) {
      state.streamingText += action.payload;
    },

    /** Set or append thinking/reasoning content */
    appendThinkingContent(state, action: PayloadAction<string>) {
      state.thinkingContent += action.payload;
    },

    /**
     * Finalise the stream: push the completed assistant message,
     * reset streaming state.
     */
    streamCompleted(state, action: PayloadAction<Message | undefined>) {
      if (action.payload) {
        state.messages.push(action.payload);
      }
      state.isStreaming = false;
      state.isLoading = false;
      state.streamingText = '';
      state.thinkingContent = '';
      state.imageGeneratingCount = 0;
      state.imageEditingCount = 0;
    },

    /** Set an error (also stops loading/streaming) */
    setError(state, action: PayloadAction<string>) {
      state.error = action.payload;
      state.isLoading = false;
      state.isStreaming = false;
    },

    /** Clear all messages (e.g. when switching conversations) */
    clearMessages(state) {
      state.messages = [];
      state.streamingText = '';
      state.thinkingContent = '';
      state.imageGeneratingCount = 0;
      state.imageEditingCount = 0;
      state.error = null;
      state.isLoading = false;
      state.isStreaming = false;
      state.detectedPersona = null;
    },
  },
});

export const {
  setMessages,
  addMessage,
  replaceLastMessage,
  setDetectedPersona,
  clearDetectedPersona,
  startStreaming,
  appendStreamText,
  appendThinkingContent,
  setImageGenerating,
  setImageEditing,
  streamCompleted,
  setError,
  clearMessages,
} = chatSlice.actions;

export default chatSlice.reducer;
