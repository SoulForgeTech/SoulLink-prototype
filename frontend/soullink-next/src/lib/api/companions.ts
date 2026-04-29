/**
 * Companion + Lorebook API.
 *
 * Surfaces the auto-extracted character_card (always-injected persona layer)
 * and the keyword-triggered lorebook entries that live on each companion
 * document. The `character_card` is read-only from the frontend (it's
 * deterministically derived from the user's custom_persona + canon corpus)
 * — what users edit here are the lorebook entries.
 */

import { COMPANIONS } from './endpoints';
import type { AuthFetchFn } from './client';

// ---------- Types ----------

export interface ExampleDialog {
  user: string;
  char: string;
  source?: 'canon' | 'synthesized';
  canon_ref?: string;
}

export interface CharacterCard {
  identity: string;
  personality_brief: string;
  voice_traits: string;
  example_dialogs: ExampleDialog[];
  canon_recognized: boolean;
  canon_ip: string;
  canon_wiki_url?: string;
  extracted_at?: string | null;
}

export interface LorebookEntry {
  id: string;
  title: string;
  keys: string[];
  secondary_keys: string[];
  content: string;
  selective_logic: 'and_any' | 'and_all' | 'not_any' | 'not_all';
  strategy: 'constant' | 'selective' | 'vectorized';
  insertion_order: number;
  insertion_position: string;
  probability: number;
  sticky: number;
  cooldown: number;
  delay: number;
  enabled: boolean;
  source: 'auto' | 'manual' | 'chat_mined';
  _source_hint?: 'canon' | 'persona' | '';
  created_at?: string;
  updated_at?: string;
}

export interface Companion {
  id: string;
  name: string;
  is_default: boolean;
  gender: string | null;
  relationship: string | null;
  custom_persona: string;
  character_card: CharacterCard;
  lorebook_entries: LorebookEntry[];
  extraction_status: 'pending' | 'running' | 'done' | 'failed';
  extraction_error: string | null;
  lorebook_extracted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExtractionStatus {
  status: 'pending' | 'running' | 'done' | 'failed';
  error: string | null;
  lorebook_entry_count: number;
  card_ready: boolean;
  card_dialog_count: number;
  extracted_at: string | null;
}

// ---------- API ----------

export async function getActiveCompanion(authFetch: AuthFetchFn): Promise<Companion | null> {
  const resp = await authFetch(COMPANIONS.ACTIVE);
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.companion || null;
}

export async function getExtractionStatus(
  authFetch: AuthFetchFn,
  companionId: string,
): Promise<ExtractionStatus | null> {
  const resp = await authFetch(COMPANIONS.extractionStatus(companionId));
  if (!resp.ok) return null;
  return resp.json();
}

export async function updateLorebookEntry(
  authFetch: AuthFetchFn,
  companionId: string,
  entryId: string,
  fields: Partial<LorebookEntry>,
): Promise<LorebookEntry | null> {
  const resp = await authFetch(COMPANIONS.lorebookEntry(companionId, entryId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.entry || null;
}

export async function deleteLorebookEntry(
  authFetch: AuthFetchFn,
  companionId: string,
  entryId: string,
): Promise<boolean> {
  const resp = await authFetch(COMPANIONS.lorebookEntry(companionId, entryId), {
    method: 'DELETE',
  });
  return resp.ok;
}

export async function reExtractLorebook(
  authFetch: AuthFetchFn,
  companionId: string,
): Promise<{ success: boolean; entry_count: number } | null> {
  const resp = await authFetch(COMPANIONS.reExtract(companionId), { method: 'POST' });
  if (!resp.ok) return null;
  return resp.json();
}
