'use client';

/**
 * Background selection panel.
 *
 * Top tab strip filters presets by category (ink / impressionist / photo);
 * a fourth 'custom' tab hosts the upload tile + the user's last uploaded
 * background. The `default` brand fallback shows under every tab as the
 * first thumbnail so users can always reset without changing tabs.
 *
 * Uses original CSS classes: bg-picker-panel, bg-picker-header,
 * bg-picker-tabs, bg-picker-tab, bg-thumb-grid, bg-thumb-item,
 * bg-thumb-label, bg-upload-tile, bg-upload-icon.
 */

import { useRef, useCallback, useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { closePanel } from '@/store/uiSlice';
import { setChatBackground, setCustomBackgroundUrl } from '@/store/settingsSlice';
import { BACKGROUNDS } from '@/lib/constants';
import { uploadBackground, updateSettings } from '@/lib/api/user';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useT } from '@/hooks/useT';
import { BACKGROUND_CATEGORIES, type BackgroundCategory } from '@/types';

type TabKey = BackgroundCategory | 'custom';
const TAB_ORDER: TabKey[] = [...BACKGROUND_CATEGORIES, 'custom'];

// ==================== Component ====================

export default function BackgroundPicker() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();

  const isOpen = useAppSelector((s) => s.ui.panels.backgroundPicker);
  const currentBg = useAppSelector((s) => s.settings.chatBackground);
  const customBgUrl = useAppSelector((s) => s.settings.customBackgroundUrl);
  const language = useAppSelector((s) => s.settings.language);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const [activeTab, setActiveTab] = useState<TabKey>('painting');

  const defaultBg = useMemo(() => BACKGROUNDS.find((b) => b.id === 'default'), []);
  const tabBgs = useMemo(() => {
    if (activeTab === 'custom') return [];
    return BACKGROUNDS.filter((b) => b.category === activeTab);
  }, [activeTab]);

  const handleClose = useCallback(() => {
    dispatch(closePanel('backgroundPicker'));
  }, [dispatch]);

  const isGuest = useAppSelector((s) => s.guest.isGuest);

  const handleSelectBackground = useCallback(
    async (bgId: string) => {
      dispatch(setChatBackground(bgId));
      if (!isGuest) {
        try {
          await updateSettings(authFetch, { chat_background: bgId });
        } catch (err) {
          console.error('Failed to save background setting:', err);
        }
      }
      // Guest: setChatBackground already persists to localStorage via settingsSlice
    },
    [dispatch, authFetch, isGuest],
  );

  const handleUploadClick = useCallback(() => {
    if (isGuest) {
      import('@/store/guestSlice').then(({ openUpgradeModal }) => {
        dispatch(openUpgradeModal('feature_locked'));
      });
      return;
    }
    fileInputRef.current?.click();
  }, [isGuest, dispatch]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) return;

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert(language?.startsWith('zh') ? '图片太大，请选择10MB以内的图片' : 'Image too large. Please choose an image under 10MB.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Apply immediately using local blob URL for instant feedback
      const localUrl = URL.createObjectURL(file);
      dispatch(setChatBackground('custom'));
      dispatch(setCustomBackgroundUrl(localUrl));

      // Upload in background, then swap to CDN URL
      try {
        const cdnUrl = await uploadBackground(authFetch, file);
        dispatch(setCustomBackgroundUrl(cdnUrl));
        await updateSettings(authFetch, {
          chat_background: 'custom',
          custom_background_url: cdnUrl,
        });
        // Revoke the temporary blob URL
        URL.revokeObjectURL(localUrl);
      } catch (err) {
        console.error('Background upload failed:', err);
        // Revert on failure
        dispatch(setChatBackground('default'));
        dispatch(setCustomBackgroundUrl(''));
        URL.revokeObjectURL(localUrl);
      }

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [dispatch, authFetch, language],
  );

  const checkOverlay = (
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
  );

  return (
    <div
      className={`bg-picker-panel diary-paper-panel${isOpen ? ' open' : ''}`}
      style={{
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      }}
    >
      {/* Header */}
      <div className="bg-picker-header">
        <span>{t('bg.picker.title')}</span>
        <button onClick={handleClose} aria-label="Close">✕</button>
      </div>

      {/* Tab strip */}
      <div className="bg-picker-tabs" role="tablist">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`bg-picker-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {t(`bg.cat.${tab}`)}
          </button>
        ))}
      </div>

      {/* Thumbnail grid */}
      <div className="bg-thumb-grid">
        {activeTab !== 'custom' && defaultBg && (
          <div
            key={defaultBg.id}
            className={`bg-thumb-item${currentBg === defaultBg.id ? ' active' : ''}`}
            onClick={() => handleSelectBackground(defaultBg.id)}
          >
            <img src={defaultBg.thumb} alt={defaultBg.label || defaultBg.id} loading="lazy" />
            {currentBg === defaultBg.id && checkOverlay}
            <div className="bg-thumb-label">{t(`bg.label.${defaultBg.id}`) || defaultBg.id}</div>
          </div>
        )}

        {tabBgs.map((bg) => {
          const isSelected = currentBg === bg.id;
          return (
            <div
              key={bg.id}
              className={`bg-thumb-item${isSelected ? ' active' : ''}`}
              onClick={() => handleSelectBackground(bg.id)}
            >
              <img src={bg.thumb} alt={bg.label || bg.id} loading="lazy" />
              {isSelected && checkOverlay}
              <div className="bg-thumb-label">{t(`bg.label.${bg.id}`) || bg.id}</div>
            </div>
          );
        })}

        {/* Custom tab: show user's uploaded thumbnail + upload tile */}
        {activeTab === 'custom' && (
          <>
            {customBgUrl && (
              <div
                className={`bg-thumb-item${currentBg === 'custom' ? ' active' : ''}`}
                onClick={() => handleSelectBackground('custom')}
              >
                <img src={customBgUrl} alt="Custom" loading="lazy" />
                {currentBg === 'custom' && checkOverlay}
                <div className="bg-thumb-label">{t('bg.custom.label')}</div>
              </div>
            )}
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
              <div className="bg-thumb-label">{t('bg.upload')}</div>
            </div>
          </>
        )}
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
