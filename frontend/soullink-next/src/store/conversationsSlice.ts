import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Conversation } from '@/types';

// ==================== Types ====================

interface ConversationsState {
  /** All conversations for the current user */
  items: Conversation[];
  /** ID of the currently selected conversation */
  currentId: string | null;
  /** Whether a new conversation is being created */
  isCreating: boolean;
}

const initialState: ConversationsState = {
  items: [],
  currentId: null,
  isCreating: false,
};

// ==================== Slice ====================

const conversationsSlice = createSlice({
  name: 'conversations',
  initialState,
  reducers: {
    /** Replace the full conversations list (e.g. after fetch) */
    setConversations(state, action: PayloadAction<Conversation[]>) {
      state.items = action.payload;
    },

    /** Add a newly created conversation to the top of the list */
    addConversation(state, action: PayloadAction<Conversation>) {
      state.items.unshift(action.payload);
    },

    /** Remove a conversation by ID */
    removeConversation(state, action: PayloadAction<string>) {
      state.items = state.items.filter((c) => c.id !== action.payload);
      // If the removed conversation was selected, clear selection
      if (state.currentId === action.payload) {
        state.currentId = null;
      }
    },

    /** Update fields on an existing conversation (e.g. rename, update timestamp) */
    updateConversation(
      state,
      action: PayloadAction<{ id: string } & Partial<Conversation>>,
    ) {
      const { id, ...changes } = action.payload;
      const index = state.items.findIndex((c) => c.id === id);
      if (index !== -1) {
        state.items[index] = { ...state.items[index], ...changes };
      }
    },

    /** Set the currently active conversation ID */
    setCurrentId(state, action: PayloadAction<string | null>) {
      state.currentId = action.payload;
    },

    /** Mark that a new conversation is being created */
    setIsCreating(state, action: PayloadAction<boolean>) {
      state.isCreating = action.payload;
    },
  },
});

export const {
  setConversations,
  addConversation,
  removeConversation,
  updateConversation,
  setCurrentId,
  setIsCreating,
} = conversationsSlice.actions;

export default conversationsSlice.reducer;
