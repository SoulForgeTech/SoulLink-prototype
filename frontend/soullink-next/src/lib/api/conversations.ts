/**
 * Conversations API functions.
 *
 * CRUD for conversation management — list, get detail, create, rename, delete.
 */

import { CONVERSATIONS } from './endpoints';
import type { AuthFetchFn } from './client';
import type { Conversation, ConversationDetail } from '@/types';

/**
 * Fetch all conversations for the current user.
 * Returns them sorted by updated_at descending.
 *
 * @param limit - Maximum number of conversations to return (default 500).
 */
export async function getConversations(
  authFetch: AuthFetchFn,
  limit: number = 500,
): Promise<{ conversations: Conversation[] }> {
  const response = await authFetch(`${CONVERSATIONS.LIST}?limit=${limit}`);

  if (!response.ok) {
    throw new Error(`Failed to load conversations: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a single conversation with its full message history.
 */
export async function getConversation(
  authFetch: AuthFetchFn,
  conversationId: string,
): Promise<ConversationDetail> {
  const response = await authFetch(CONVERSATIONS.detail(conversationId));

  if (!response.ok) {
    throw new Error(`Failed to load conversation: ${response.status}`);
  }

  return response.json();
}

/**
 * Create a new conversation.
 *
 * @param title - Initial title for the conversation (default "New Chat").
 */
export async function createConversation(
  authFetch: AuthFetchFn,
  title: string = 'New Chat',
): Promise<{ conversation: Conversation }> {
  const response = await authFetch(CONVERSATIONS.CREATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create conversation: ${response.status}`);
  }

  return response.json();
}

/**
 * Rename a conversation.
 */
export async function updateConversation(
  authFetch: AuthFetchFn,
  conversationId: string,
  title: string,
): Promise<void> {
  const response = await authFetch(CONVERSATIONS.update(conversationId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error(`Failed to rename conversation: ${response.status}`);
  }
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(
  authFetch: AuthFetchFn,
  conversationId: string,
): Promise<void> {
  const response = await authFetch(CONVERSATIONS.delete(conversationId), {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete conversation: ${response.status}`);
  }
}
