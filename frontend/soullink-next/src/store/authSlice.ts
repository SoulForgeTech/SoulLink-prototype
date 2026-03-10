import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '@/types';

// ==================== Types ====================

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
}

// ==================== localStorage helpers ====================

const TOKEN_KEY = 'soullink_token';
const REFRESH_TOKEN_KEY = 'soullink_refresh_token';
const USER_KEY = 'soullink_user';

function readFromStorage(): Partial<AuthState> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    const user = userRaw ? (JSON.parse(userRaw) as User) : null;
    return {
      token,
      refreshToken,
      user,
      isAuthenticated: !!token,
    };
  } catch {
    return {};
  }
}

function writeCredentials(token: string | null, refreshToken: string | null, user: User | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } else {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // localStorage may be unavailable (e.g. SSR, private browsing)
  }
}

function clearStorage() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // silent
  }
}

// ==================== Initial state ====================

const stored = readFromStorage();

const initialState: AuthState = {
  token: stored.token ?? null,
  refreshToken: stored.refreshToken ?? null,
  user: stored.user ?? null,
  isAuthenticated: stored.isAuthenticated ?? false,
};

// ==================== Slice ====================

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /**
     * Set credentials after login / token refresh.
     * Persists token, refreshToken, and user to localStorage.
     */
    setCredentials(
      state,
      action: PayloadAction<{
        token: string;
        refreshToken?: string;
        user: User;
      }>,
    ) {
      const { token, refreshToken, user } = action.payload;
      state.token = token;
      state.refreshToken = refreshToken ?? state.refreshToken;
      state.user = user;
      state.isAuthenticated = true;
      writeCredentials(token, refreshToken ?? state.refreshToken, user);
    },

    /**
     * Update user object in state + localStorage (e.g. after settings change).
     */
    setUser(state, action: PayloadAction<User>) {
      state.user = action.payload;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(action.payload));
        } catch {
          // silent
        }
      }
    },

    /**
     * Clear all auth state and localStorage on logout.
     */
    logout(state) {
      state.token = null;
      state.refreshToken = null;
      state.user = null;
      state.isAuthenticated = false;
      clearStorage();
    },
  },
});

export const { setCredentials, setUser, logout } = authSlice.actions;
export default authSlice.reducer;
