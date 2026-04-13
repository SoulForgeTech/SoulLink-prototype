/**
 * Guest conversation storage — localStorage-only persistence.
 *
 * Guest conversations are stored entirely in localStorage (not MongoDB).
 * On signup, they are migrated to the server via /api/auth/migrate-guest.
 */

import type { Message } from '@/types';

const CONV_KEY = 'soullink_guest_conversations';

export interface GuestConversation {
  id: string;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

/** Load all guest conversations from localStorage */
export function loadGuestConversations(): GuestConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CONV_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save guest conversations to localStorage */
export function saveGuestConversations(items: GuestConversation[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CONV_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn('[GuestStorage] Failed to save:', e);
  }
}

/** Get or create the active guest conversation */
export function getOrCreateGuestConversation(): GuestConversation {
  const convs = loadGuestConversations();
  if (convs.length > 0) return convs[0];

  const newConv: GuestConversation = {
    id: crypto.randomUUID(),
    title: 'New Chat',
    messages: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  saveGuestConversations([newConv]);
  return newConv;
}

/** Append a message to the active guest conversation */
export function appendGuestMessage(convId: string, msg: Message): void {
  const convs = loadGuestConversations();
  const conv = convs.find((c) => c.id === convId);
  if (conv) {
    conv.messages.push(msg);
    conv.updated_at = new Date().toISOString();
    // Auto-title from first user message
    if (!conv.title || conv.title === 'New Chat') {
      const firstUserMsg = conv.messages.find((m) => m.role === 'user');
      if (firstUserMsg) {
        conv.title = firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
      }
    }
    saveGuestConversations(convs);
  }
}

/** Clear all guest conversation data */
export function clearGuestStorage(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CONV_KEY);
}
