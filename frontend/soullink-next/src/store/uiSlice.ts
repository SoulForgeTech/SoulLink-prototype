import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ModalName, PanelName, SettingsTab, GameId } from '@/types';

// ==================== Types ====================

interface ModalsState {
  settings: { open: boolean; activeTab: SettingsTab };
  changelog: boolean;
  about: boolean;
  rename: boolean;
  crop: boolean;
  companionAvatar: boolean;
  community: boolean;
}

interface PanelsState {
  backgroundPicker: boolean;
  ambientSound: boolean;
  games: boolean;
}

interface SidebarState {
  mobileOpen: boolean;
}

interface LoadingState {
  visible: boolean;
  text: string;
  showProgress: boolean;
  percent: number;
}

interface GameFullscreenState {
  isActive: boolean;
  gameId: GameId | null;
}

interface UIState {
  modals: ModalsState;
  panels: PanelsState;
  sidebar: SidebarState;
  loading: LoadingState;
  gameFullscreen: GameFullscreenState;
  /** Image source URL for the crop modal */
  cropImageSrc: string;
  /** Resulting cropped avatar blob URL (set by crop modal, consumed by avatar modal) */
  croppedAvatarUrl: string;
  /**
   * Memory ids to briefly highlight when the Memory panel opens (e.g. clicked
   * from a chat receipt chip). Cleared when the panel consumes them.
   */
  memoryHighlightIds: string[];
}

const initialState: UIState = {
  modals: {
    settings: { open: false, activeTab: 'profile' },
    changelog: false,
    about: false,
    rename: false,
    crop: false,
    companionAvatar: false,
    community: false,
  },
  panels: {
    backgroundPicker: false,
    ambientSound: false,
    games: false,
  },
  sidebar: {
    mobileOpen: false,
  },
  loading: {
    visible: false,
    text: '',
    showProgress: false,
    percent: 0,
  },
  gameFullscreen: {
    isActive: false,
    gameId: null,
  },
  cropImageSrc: '',
  croppedAvatarUrl: '',
  memoryHighlightIds: [],
};

// ==================== Slice ====================

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    /**
     * Open a modal by name.
     * For settings modal, optionally specify the active tab.
     */
    openModal(
      state,
      action: PayloadAction<{ modal: ModalName; tab?: SettingsTab }>,
    ) {
      const { modal, tab } = action.payload;
      if (modal === 'settings') {
        state.modals.settings.open = true;
        if (tab) {
          state.modals.settings.activeTab = tab;
        }
      } else {
        state.modals[modal] = true;
      }
    },

    /** Close a modal by name */
    closeModal(state, action: PayloadAction<ModalName>) {
      const modal = action.payload;
      if (modal === 'settings') {
        state.modals.settings.open = false;
      } else {
        state.modals[modal] = false;
      }
    },

    /** Switch the active tab inside the settings modal */
    setSettingsTab(state, action: PayloadAction<SettingsTab>) {
      state.modals.settings.activeTab = action.payload;
    },

    /** Toggle a panel with mutual exclusion — opening one closes others (like original) */
    togglePanel(state, action: PayloadAction<PanelName>) {
      const panel = action.payload;
      const isOpening = !state.panels[panel];
      // Close all panels first
      state.panels.backgroundPicker = false;
      state.panels.ambientSound = false;
      state.panels.games = false;
      // Then open the target if it was closed
      if (isOpening) {
        state.panels[panel] = true;
      }
    },

    /** Close a specific panel */
    closePanel(state, action: PayloadAction<PanelName>) {
      state.panels[action.payload] = false;
    },

    /** Toggle the mobile sidebar open/closed */
    toggleSidebar(state) {
      state.sidebar.mobileOpen = !state.sidebar.mobileOpen;
    },

    /** Explicitly set mobile sidebar state */
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebar.mobileOpen = action.payload;
    },

    /** Show the loading overlay */
    setLoading(
      state,
      action: PayloadAction<{
        visible: boolean;
        text?: string;
        showProgress?: boolean;
        percent?: number;
      }>,
    ) {
      const { visible, text, showProgress, percent } = action.payload;
      state.loading.visible = visible;
      state.loading.text = text ?? '';
      state.loading.showProgress = showProgress ?? false;
      state.loading.percent = percent ?? 0;
    },

    /** Update loading progress bar */
    updateLoadingProgress(
      state,
      action: PayloadAction<{ percent: number; text?: string }>,
    ) {
      state.loading.percent = action.payload.percent;
      if (action.payload.text !== undefined) {
        state.loading.text = action.payload.text;
      }
    },

    /** Open a mini-game in fullscreen */
    openGame(state, action: PayloadAction<GameId>) {
      state.gameFullscreen.isActive = true;
      state.gameFullscreen.gameId = action.payload;
      // Close the games panel when opening a game
      state.panels.games = false;
    },

    /** Close the currently active fullscreen game */
    closeGame(state) {
      state.gameFullscreen.isActive = false;
      state.gameFullscreen.gameId = null;
    },

    /** Set the image source for the crop modal */
    setCropImageSrc(state, action: PayloadAction<string>) {
      state.cropImageSrc = action.payload;
    },

    /** Set the cropped avatar result URL */
    setCroppedAvatarUrl(state, action: PayloadAction<string>) {
      state.croppedAvatarUrl = action.payload;
    },

    /** Set ids to highlight the next time the memory panel renders */
    setMemoryHighlight(state, action: PayloadAction<string[]>) {
      state.memoryHighlightIds = action.payload;
    },

    /** Clear highlight ids — MemoryPanel calls this after consuming */
    clearMemoryHighlight(state) {
      state.memoryHighlightIds = [];
    },
  },
});

export const {
  openModal,
  closeModal,
  setSettingsTab,
  togglePanel,
  closePanel,
  toggleSidebar,
  setSidebarOpen,
  setLoading,
  updateLoadingProgress,
  openGame,
  closeGame,
  setCropImageSrc,
  setCroppedAvatarUrl,
  setMemoryHighlight,
  clearMemoryHighlight,
} = uiSlice.actions;

export default uiSlice.reducer;
