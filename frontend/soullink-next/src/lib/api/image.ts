/**
 * Image editing API — BFL Flux Kontext Pro.
 */

import { IMAGE } from './endpoints';
import type { AuthFetchFn } from './client';

export interface ImageEditResult {
  url?: string;
  b64?: string;
  prompt: string;
  error?: string;
}

/**
 * Edit an image with a natural-language prompt.
 *
 * @param image - base64 data URL (data:image/...;base64,...) or plain base64 string
 * @param prompt - editing instruction, e.g. "change background to a beach"
 */
export async function editImage(
  authFetch: AuthFetchFn,
  params: { image: string; prompt: string; conversation_id?: string },
): Promise<ImageEditResult> {
  const response = await authFetch(IMAGE.EDIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: params.image,
      prompt: params.prompt,
      conversation_id: params.conversation_id,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Image edit failed (${response.status})`);
  }

  return data;
}
