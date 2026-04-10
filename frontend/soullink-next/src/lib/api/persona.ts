/**
 * Persona & Lore API functions.
 *
 * Handles custom character persona import/management and
 * knowledge base (lore) document management.
 */

import { USER, IMPORT } from './endpoints';
import type { AuthFetchFn } from './client';
import type {
  SearchCharacterResponse,
  ImportPersonaResponse,
  ConfirmPersonaResponse,
  CustomStatusResponse,
  ImportLoreResponse,
  ImportChatGPTResponse,
} from '@/types';

/**
 * Search for a character by name using Gemini/web search.
 * Returns a rich character description if found.
 *
 * @param query - Character name or search query.
 * @param language - Language preference ('en' or 'zh-CN').
 */
export async function searchCharacter(
  authFetch: AuthFetchFn,
  query: string,
  language: string = 'en',
): Promise<SearchCharacterResponse> {
  const response = await authFetch(USER.SEARCH_CHARACTER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, language }),
  });

  return response.json();
}

/**
 * Extract a structured persona from a character description.
 * Returns a preview with core_persona, name, and appearance.
 *
 * @param text - Character description text.
 * @param language - Language preference.
 */
export async function importPersona(
  authFetch: AuthFetchFn,
  text: string,
  language: string = 'en',
): Promise<ImportPersonaResponse> {
  const response = await authFetch(USER.IMPORT_PERSONA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });

  return response.json();
}

/**
 * Confirm and apply a previously extracted persona preview.
 *
 * @param corePersona - The core personality text.
 * @param name - Character name.
 * @param appearance - Optional appearance description.
 */
export async function confirmPersona(
  authFetch: AuthFetchFn,
  corePersona: string,
  name?: string,
  appearance?: string,
  gender?: string,
): Promise<ConfirmPersonaResponse> {
  const response = await authFetch(USER.CONFIRM_PERSONA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      core_persona: corePersona,
      name,
      appearance: appearance || undefined,
      gender: gender || undefined,
    }),
  });

  return response.json();
}

/**
 * Clear/remove the active custom persona.
 * Restores the default companion personality style.
 */
export async function clearPersona(
  authFetch: AuthFetchFn,
): Promise<{ success: boolean; error?: string }> {
  const response = await authFetch(USER.CLEAR_PERSONA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  return response.json();
}

/**
 * Import a lore document to the knowledge base.
 * Accepts either raw text (JSON body) or a file (FormData).
 *
 * @param textOrFile - Either a text string or a File object.
 */
export async function importLore(
  authFetch: AuthFetchFn,
  textOrFile: string | File,
): Promise<ImportLoreResponse> {
  let response: Response;

  if (typeof textOrFile === 'string') {
    // Text-based import
    response = await authFetch(USER.IMPORT_LORE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textOrFile }),
    });
  } else {
    // File-based import
    const formData = new FormData();
    formData.append('file', textOrFile);
    response = await authFetch(USER.IMPORT_LORE, {
      method: 'POST',
      body: formData,
    });
  }

  return response.json();
}

/**
 * Remove a lore document from the knowledge base.
 *
 * @param docId - Optional specific document ID. If omitted, clears all lore.
 */
export async function clearLore(
  authFetch: AuthFetchFn,
  docId?: string,
): Promise<{ success: boolean; error?: string }> {
  const body = docId ? { doc_id: docId } : {};

  const response = await authFetch(USER.CLEAR_LORE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return response.json();
}

/**
 * Get the current custom persona and lore status.
 * Returns whether a custom persona is active and the list of lore documents.
 */
export async function getCustomStatus(
  authFetch: AuthFetchFn,
): Promise<CustomStatusResponse> {
  const response = await authFetch(USER.CUSTOM_STATUS);

  if (!response.ok) {
    throw new Error(`Failed to get custom status: ${response.status}`);
  }

  return response.json();
}

/**
 * Import ChatGPT conversation history.
 * Accepts a FormData with a JSON or ZIP file.
 *
 * @param file - The conversations.json or .zip file to import.
 */
export async function importChatGPT(
  authFetch: AuthFetchFn,
  file: File | Blob,
  filename: string = 'conversations.json',
): Promise<ImportChatGPTResponse> {
  const body = new FormData();
  body.append('file', file, filename);

  const response = await authFetch(IMPORT.CHATGPT, {
    method: 'POST',
    body,
  });

  return response.json();
}
