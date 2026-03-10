'use client';

/**
 * Companion avatar change modal.
 *
 * Uses original CSS classes:
 * .companion-avatar-modal-overlay, .companion-avatar-modal,
 * .companion-avatar-preview-section, .companion-avatar-preview-img,
 * .companion-avatar-upload-btn, .companion-avatar-reset-btn,
 * .companion-avatar-modal-btns, .companion-avatar-btn-cancel,
 * .companion-avatar-btn-save
 *
 * On file upload, opens the crop modal. After cropping, the result
 * is used as the preview. On save, uploads to Cloudinary via
 * /api/upload-avatar and persists to settings.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal, openModal, setCropImageSrc, setCroppedAvatarUrl } from '@/store/uiSlice';
import { setCompanionAvatar } from '@/store/settingsSlice';
import { setUser } from '@/store/authSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { uploadAvatar, updateSettings as apiUpdateSettings } from '@/lib/api/user';
import { useT } from '@/hooks/useT';

/**
 * Compress an image blob to max 400px dimension, JPEG quality 0.85.
 * Matches the original compressImage() from index.html.
 */
function compressImage(file: Blob, maxSize = 400): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
      } else {
        if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Compress failed'));
          resolve(blob);
        },
        'image/jpeg',
        0.85,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Convert a blob: or data: URL to a Blob.
 */
async function urlToBlob(url: string): Promise<Blob> {
  const resp = await fetch(url);
  return resp.blob();
}

export default function CompanionAvatarModal() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const isOpen = useAppSelector((s) => s.ui.modals.companionAvatar);
  const currentAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const croppedAvatarUrl = useAppSelector((s) => s.ui.croppedAvatarUrl);
  const user = useAppSelector((s) => s.auth.user);
  const t = useT();

  const [previewUrl, setPreviewUrl] = useState('');
  const [hasChange, setHasChange] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPreviewUrl(currentAvatar || '');
      setHasChange(false);
      setUploading(false);
      dispatch(setCroppedAvatarUrl(''));
    }
  }, [isOpen, currentAvatar, dispatch]);

  // Watch for cropped avatar result from CropModal
  useEffect(() => {
    if (croppedAvatarUrl) {
      setPreviewUrl(croppedAvatarUrl);
      setHasChange(true);
    }
  }, [croppedAvatarUrl]);

  const handleClose = useCallback(() => {
    dispatch(closeModal('companionAvatar'));
  }, [dispatch]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;

      // Create object URL and open crop modal
      const url = URL.createObjectURL(file);
      dispatch(setCropImageSrc(url));
      dispatch(openModal({ modal: 'crop' }));

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [dispatch],
  );

  const handleResetDefault = useCallback(async () => {
    setPreviewUrl('');
    setHasChange(false);
    dispatch(setCompanionAvatar(''));
    // Also clear on backend
    try {
      await apiUpdateSettings(authFetch, { companion_avatar: '' });
      if (user) {
        const updatedSettings = { ...(user.settings || {}), companion_avatar: '' };
        dispatch(setUser({ ...user, settings: updatedSettings }));
      }
    } catch (err) {
      console.error('Failed to clear companion avatar:', err);
    }
    handleClose();
  }, [dispatch, handleClose, authFetch, user]);

  const handleSave = useCallback(async () => {
    if (!hasChange || !previewUrl || uploading) return;
    setUploading(true);

    try {
      // Convert the cropped preview (blob:/data: URL) to an actual Blob
      const blob = await urlToBlob(previewUrl);
      // Compress to max 400px JPEG
      const compressed = await compressImage(blob, 400);

      // Upload to Cloudinary via /api/upload-avatar
      const oldUrl = currentAvatar?.includes('res.cloudinary.com') ? currentAvatar : undefined;
      const cdnUrl = await uploadAvatar(authFetch, compressed, oldUrl);

      // Update Redux + localStorage
      dispatch(setCompanionAvatar(cdnUrl));

      // Persist to backend settings
      await apiUpdateSettings(authFetch, { companion_avatar: cdnUrl });

      // Update user object in auth slice so localStorage stays in sync
      if (user) {
        const updatedSettings = { ...(user.settings || {}), companion_avatar: cdnUrl };
        dispatch(setUser({ ...user, settings: updatedSettings }));
      }

      handleClose();
    } catch (err) {
      console.error('Companion avatar upload failed:', err);
      // Still save locally even if upload fails
      dispatch(setCompanionAvatar(previewUrl));
      handleClose();
    } finally {
      setUploading(false);
    }
  }, [hasChange, previewUrl, uploading, currentAvatar, authFetch, dispatch, user, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="companion-avatar-modal-overlay active"
      onClick={handleClose}
      style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
    >
      <div
        className="companion-avatar-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)' }}
      >
        <h3>{t('companion.avatar.title')}</h3>
        <p>{t('companion.avatar.description')}</p>

        {/* Preview section */}
        <div className="companion-avatar-preview-section">
          {previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="companion-avatar-preview-img"
              src={previewUrl}
              alt="Preview"
              onError={() => setPreviewUrl('')}
            />
          ) : (
            <div
              className="companion-avatar-preview-img"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--primary-color, #6BA3D6)',
                color: 'white',
                fontSize: '2rem',
              }}
            >
              {'\uD83D\uDC64'}
            </div>
          )}

          <div className="companion-avatar-actions">
            <label className="companion-avatar-upload-btn" htmlFor="companion-avatar-upload-input">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>{t('companion.avatar.upload')}</span>
            </label>
            <input
              ref={fileInputRef}
              id="companion-avatar-upload-input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <button className="companion-avatar-reset-btn" onClick={handleResetDefault}>
              {t('companion.avatar.reset')}
            </button>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="companion-avatar-modal-btns">
          <button className="companion-avatar-btn-cancel" onClick={handleClose}>
            {t('settings.cancel')}
          </button>
          <button
            className="companion-avatar-btn-save"
            onClick={handleSave}
            style={{
              opacity: hasChange && !uploading ? 1 : 0.4,
              cursor: hasChange && !uploading ? 'pointer' : 'not-allowed',
            }}
          >
            {uploading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                Uploading...
              </span>
            ) : (
              t('settings.save')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
