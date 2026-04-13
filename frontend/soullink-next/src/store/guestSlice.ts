import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// ==================== Types ====================

interface GuestUsage {
  text: number;
  voice: number;
  image: number;
}

interface GuestLimits {
  text: number;
  text_window_seconds: number;
  voice: number;
  image: number;
}

interface GuestState {
  isGuest: boolean;
  sessionId: string | null;
  usage: GuestUsage;
  limits: GuestLimits;
  upgradeModalOpen: boolean;
  upgradeReason: 'text' | 'voice' | 'image' | 'feature_locked' | null;
}

// ==================== localStorage Persistence ====================

const SESSION_KEY = 'soullink_guest_session_id';
const USAGE_KEY = 'soullink_guest_usage';

function loadPersistedState(): Partial<GuestState> {
  if (typeof window === 'undefined') return {};
  try {
    const sessionId = localStorage.getItem(SESSION_KEY);
    const usageRaw = localStorage.getItem(USAGE_KEY);
    const usage = usageRaw ? JSON.parse(usageRaw) : null;
    return {
      isGuest: !!sessionId,
      sessionId,
      ...(usage ? { usage } : {}),
    };
  } catch {
    return {};
  }
}

function persistSession(sessionId: string | null) {
  if (typeof window === 'undefined') return;
  if (sessionId) {
    localStorage.setItem(SESSION_KEY, sessionId);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function persistUsage(usage: GuestUsage) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

// ==================== Initial State ====================

const persisted = loadPersistedState();

const initialState: GuestState = {
  isGuest: persisted.isGuest ?? false,
  sessionId: persisted.sessionId ?? null,
  usage: persisted.usage ?? { text: 0, voice: 0, image: 0 },
  limits: {
    text: 50,
    text_window_seconds: 7200,
    voice: 5,
    image: 3,
  },
  upgradeModalOpen: false,
  upgradeReason: null,
};

// ==================== Slice ====================

const guestSlice = createSlice({
  name: 'guest',
  initialState,
  reducers: {
    /** Enter guest mode with a new or existing session ID */
    enterGuestMode(state, action: PayloadAction<string>) {
      state.isGuest = true;
      state.sessionId = action.payload;
      persistSession(action.payload);
    },

    /** Update usage counters from server response */
    setGuestUsage(state, action: PayloadAction<GuestUsage>) {
      state.usage = action.payload;
      persistUsage(action.payload);
    },

    /** Update limits from server (in case they change) */
    setGuestLimits(state, action: PayloadAction<GuestLimits>) {
      state.limits = action.payload;
    },

    /** Increment a specific usage counter (optimistic, client-side) */
    incrementGuestUsage(state, action: PayloadAction<'text' | 'voice' | 'image'>) {
      state.usage[action.payload] += 1;
      persistUsage(state.usage);
    },

    /** Open the upgrade modal with a specific reason */
    openUpgradeModal(state, action: PayloadAction<'text' | 'voice' | 'image' | 'feature_locked'>) {
      state.upgradeModalOpen = true;
      state.upgradeReason = action.payload;
    },

    /** Close the upgrade modal */
    closeUpgradeModal(state) {
      state.upgradeModalOpen = false;
      state.upgradeReason = null;
    },

    /** Exit guest mode (on signup/login migration) */
    exitGuestMode(state) {
      state.isGuest = false;
      state.sessionId = null;
      state.usage = { text: 0, voice: 0, image: 0 };
      state.upgradeModalOpen = false;
      state.upgradeReason = null;
      // Clear localStorage
      if (typeof window !== 'undefined') {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(USAGE_KEY);
        localStorage.removeItem('soullink_guest_conversations');
      }
    },
  },
});

export const {
  enterGuestMode,
  setGuestUsage,
  setGuestLimits,
  incrementGuestUsage,
  openUpgradeModal,
  closeUpgradeModal,
  exitGuestMode,
} = guestSlice.actions;

export default guestSlice.reducer;
