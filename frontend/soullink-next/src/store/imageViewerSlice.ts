import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// ==================== Types ====================

interface ImageViewerState {
  /** Whether the fullscreen image viewer overlay is open */
  isOpen: boolean;
  /** The image URL currently displayed in the viewer */
  currentSrc: string;
}

const initialState: ImageViewerState = {
  isOpen: false,
  currentSrc: '',
};

// ==================== Slice ====================

const imageViewerSlice = createSlice({
  name: 'imageViewer',
  initialState,
  reducers: {
    /** Open the image viewer with a given image URL */
    open(state, action: PayloadAction<string>) {
      state.isOpen = true;
      state.currentSrc = action.payload;
    },

    /** Close the image viewer and clear the source */
    close(state) {
      state.isOpen = false;
      state.currentSrc = '';
    },
  },
});

export const { open, close } = imageViewerSlice.actions;
export default imageViewerSlice.reducer;
