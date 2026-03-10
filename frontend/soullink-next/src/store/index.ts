import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

import authReducer from './authSlice';
import chatReducer from './chatSlice';
import conversationsReducer from './conversationsSlice';
import uiReducer from './uiSlice';
import voiceReducer from './voiceSlice';
import settingsReducer from './settingsSlice';
import imageViewerReducer from './imageViewerSlice';
import personalityReducer from './personalitySlice';

// ==================== Store ====================

export const store = configureStore({
  reducer: {
    auth: authReducer,
    chat: chatReducer,
    conversations: conversationsReducer,
    ui: uiReducer,
    voice: voiceReducer,
    settings: settingsReducer,
    imageViewer: imageViewerReducer,
    personality: personalityReducer,
  },
});

// ==================== Types ====================

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// ==================== Typed Hooks ====================

/**
 * Typed version of `useDispatch` — use throughout the app
 * instead of plain `useDispatch`.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();

/**
 * Typed version of `useSelector` — use throughout the app
 * instead of plain `useSelector`.
 */
export const useAppSelector = useSelector.withTypes<RootState>();
