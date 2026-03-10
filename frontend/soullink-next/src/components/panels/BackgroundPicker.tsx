'use client';

/**
 * Background selection panel.
 *
 * Renders as a fixed dropdown panel (slides from right).
 * Uses original CSS classes: bg-picker-panel, bg-picker-header,
 * bg-thumb-grid, bg-thumb-item, bg-thumb-label, bg-upload-tile,
 * bg-upload-icon.
 */

import { useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { closePanel } from '@/store/uiSlice';
import { setChatBackground, setCustomBackgroundUrl } from '@/store/settingsSlice';
import { BACKGROUNDS } from '@/lib/constants';
import { uploadBackground, updateSettings } from '@/lib/api/user';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useT } from '@/hooks/useT';

// ==================== Component ====================

export default function BackgroundPicker() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();

  const isOpen = useAppSelector((s) => s.ui.panels.backgroundPicker);
  const currentBg = useAppSelector((s) => s.settings.chatBackground);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const handleClose = useCallback(() => {
    dispatch(closePanel('backgroundPicker'));
  }, [dispatch]);

  const handleSelectBackground = useCallback(
    async (bgId: string) => {
      dispatch(setChatBackground(bgId));
      try {
        await updateSettings(authFetch, { chat_background: bgId });
      } catch (err) {
        console.error('Failed to save background setting:', err);
      }
    },
    [dispatch, authFetch],
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) return;

      try {
        const url = await uploadBackground(authFetch, file);
        dispatch(setChatBackground('custom'));
        dispatch(setCustomBackgroundUrl(url));
        await updateSettings(authFetch, {
          chat_background: 'custom',
          custom_background_url: url,
        });
      } catch (err) {
        console.error('Background upload failed:', err);
      }

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [dispatch, authFetch],
  );

  return (
    <div
      className={`bg-picker-panel${isOpen ? ' open' : ''}`}
      style={{
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      }}
    >
      {/* Header — uses .bg-picker-header CSS */}
      <div className="bg-picker-header">
        <span>{t('bg.picker.title')}</span>
        <button onClick={handleClose} aria-label="Close">✕</button>
      </div>

      {/* Thumbnail grid — uses .bg-thumb-grid CSS (3 columns) */}
      <div className="bg-thumb-grid">
        {BACKGROUNDS.map((bg) => {
          const isSelected = currentBg === bg.id;

          return (
            <div
              key={bg.id}
              className={`bg-thumb-item${isSelected ? ' active' : ''}`}
              onClick={() => handleSelectBackground(bg.id)}
            >
              <img
                src={bg.thumb}
                alt={bg.label || bg.id}
                loading="lazy"
              />
              {isSelected && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(107,163,214,0.2)',
                }}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
              <div className="bg-thumb-label">{t(`bg.label.${bg.id}`) || bg.id}</div>
            </div>
          );
        })}

        {/* Upload custom background tile */}
        <div
          className="bg-thumb-item bg-upload-tile"
          onClick={handleUploadClick}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="bg-upload-icon"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div className="bg-thumb-label">{t('bg.custom.label')}</div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
