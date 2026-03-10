import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { VoiceCallState, VoicePreset } from '@/types';

// ==================== Types ====================

interface VoiceState {
  /** Whether a voice call is currently active */
  callActive: boolean;
  /** Current state of the voice call pipeline */
  callState: VoiceCallState;
  /** Duration of the current call in seconds */
  callSeconds: number;

  /** Whether the user is recording a voice message (push-to-talk) */
  isRecording: boolean;
  /** Duration of the current voice recording in seconds */
  recordingDuration: number;

  /** Available voice presets from Fish Audio */
  presets: VoicePreset[];
  /** Currently selected voice preset ID */
  currentPresetId: string;
  /** Whether AI auto-replies with voice (TTS toggle) */
  ttsEnabled: boolean;
}

const initialState: VoiceState = {
  callActive: false,
  callState: 'idle',
  callSeconds: 0,

  isRecording: false,
  recordingDuration: 0,

  presets: [],
  currentPresetId: '',
  ttsEnabled: false,
};

// ==================== Slice ====================

const voiceSlice = createSlice({
  name: 'voice',
  initialState,
  reducers: {
    // ---- Voice Call ----

    /** Start a voice call session */
    startCall(state) {
      state.callActive = true;
      state.callState = 'connecting';
      state.callSeconds = 0;
    },

    /** Update the voice call pipeline state */
    setCallState(state, action: PayloadAction<VoiceCallState>) {
      state.callState = action.payload;
    },

    /** Increment the call timer by 1 second */
    tickCallSeconds(state) {
      state.callSeconds += 1;
    },

    /** End the voice call and reset state */
    endCall(state) {
      state.callActive = false;
      state.callState = 'idle';
      state.callSeconds = 0;
    },

    // ---- Voice Recording (push-to-talk message) ----

    /** Start recording a voice message */
    startRecording(state) {
      state.isRecording = true;
      state.recordingDuration = 0;
    },

    /** Increment the recording timer by 1 second */
    tickRecordingDuration(state) {
      state.recordingDuration += 1;
    },

    /** Stop recording */
    stopRecording(state) {
      state.isRecording = false;
      state.recordingDuration = 0;
    },

    // ---- Voice Presets ----

    /** Set available voice presets (from API response) */
    setPresets(state, action: PayloadAction<VoicePreset[]>) {
      state.presets = action.payload;
    },

    /** Select a voice preset by ID */
    setCurrentPresetId(state, action: PayloadAction<string>) {
      state.currentPresetId = action.payload;
    },

    /** Toggle or set TTS enabled state */
    setTtsEnabled(state, action: PayloadAction<boolean>) {
      state.ttsEnabled = action.payload;
    },
  },
});

export const {
  startCall,
  setCallState,
  tickCallSeconds,
  endCall,
  startRecording,
  tickRecordingDuration,
  stopRecording,
  setPresets,
  setCurrentPresetId,
  setTtsEnabled,
} = voiceSlice.actions;

export default voiceSlice.reducer;
