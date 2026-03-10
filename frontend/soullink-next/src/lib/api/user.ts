/**
 * User & Settings API functions.
 *
 * Covers user profile updates, settings management,
 * avatar/background uploads, and feedback submission.
 */

import { USER, UPLOAD, FEEDBACK } from './endpoints';
import type { AuthFetchFn } from './client';
import type { User, UserSettings, FeedbackRequest } from '@/types';

/**
 * Get the current user's profile.
 * (Typically the user data is already embedded in the auth token response,
 *  but this endpoint can be used to fetch fresh profile data.)
 */
export async function getProfile(
  authFetch: AuthFetchFn,
): Promise<User> {
  const response = await authFetch(USER.PROFILE);

  if (!response.ok) {
    throw new Error(`Failed to get profile: ${response.status}`);
  }

  return response.json();
}

/**
 * Update the user's profile (name, avatar_url).
 */
export async function updateProfile(
  authFetch: AuthFetchFn,
  updates: { name?: string; avatar_url?: string },
): Promise<void> {
  const response = await authFetch(USER.PROFILE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update profile: ${response.status}`);
  }
}

/**
 * Get the current user's settings.
 * (Usually embedded in the user object, but available separately.)
 */
export async function getSettings(
  authFetch: AuthFetchFn,
): Promise<UserSettings> {
  const response = await authFetch(USER.SETTINGS);

  if (!response.ok) {
    throw new Error(`Failed to get settings: ${response.status}`);
  }

  return response.json();
}

/**
 * Update one or more user settings fields.
 *
 * Accepts a partial settings object — only the provided keys will be updated.
 * Common fields: companion_name, companion_avatar, companion_gender,
 * companion_subtype, companion_relationship, model, language, voice_id,
 * voice_name, chat_background, kb_enabled, etc.
 */
export async function updateSettings(
  authFetch: AuthFetchFn,
  settings: Partial<UserSettings>,
): Promise<void> {
  const response = await authFetch(USER.SETTINGS, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update settings: ${response.status}`);
  }
}

/**
 * Upload a user or companion avatar image.
 *
 * @param blob - The image blob (JPEG recommended, compressed).
 * @param oldUrl - Previous Cloudinary URL to delete (optional).
 * @returns The new avatar URL from the CDN.
 */
export async function uploadAvatar(
  authFetch: AuthFetchFn,
  blob: Blob,
  oldUrl?: string,
): Promise<string> {
  const form = new FormData();
  form.append('file', blob, 'avatar.jpg');
  if (oldUrl && oldUrl.includes('res.cloudinary.com')) {
    form.append('old_url', oldUrl);
  }

  const resp = await authFetch(UPLOAD.AVATAR, {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const d = await resp.json().catch(() => ({}));
    throw new Error(d.error || 'Avatar upload failed');
  }

  const d = await resp.json();
  return d.url;
}

/**
 * Upload a custom chat background image.
 *
 * @param blob - The image blob (JPEG, compressed to ~1080px).
 * @returns The new background URL from the CDN.
 */
export async function uploadBackground(
  authFetch: AuthFetchFn,
  blob: Blob,
): Promise<string> {
  const form = new FormData();
  form.append('file', blob, 'background.jpg');

  const resp = await authFetch(UPLOAD.BACKGROUND, {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const d = await resp.json().catch(() => ({}));
    throw new Error(d.error || 'Background upload failed');
  }

  const d = await resp.json();
  return d.url;
}

/**
 * Delete the custom chat background.
 * The server removes the Cloudinary image and clears the setting.
 */
export async function deleteBackground(
  authFetch: AuthFetchFn,
): Promise<void> {
  await authFetch(UPLOAD.DELETE_BACKGROUND, {
    method: 'POST',
  });
}

/**
 * Submit user feedback (suggestion, bug report, etc.).
 */
export async function submitFeedback(
  authFetch: AuthFetchFn,
  feedback: FeedbackRequest,
): Promise<void> {
  const response = await authFetch(FEEDBACK.SUBMIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to submit feedback');
  }
}
