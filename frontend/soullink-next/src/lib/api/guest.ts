/**
 * Guest mode API client functions.
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

export interface GuestInitResponse {
  session_id: string;
  limits: {
    text: number;
    text_window_seconds: number;
    voice: number;
    voice_window_seconds: number;
    image: number;
    image_window_seconds: number;
  };
  usage: {
    text: number;
    voice: number;
    image: number;
  };
}

export interface GuestUsageResponse {
  usage: { text: number; voice: number; image: number };
  limits: { text: number; text_window_seconds: number; voice: number; image: number };
}

/**
 * Initialize or validate a guest session.
 */
export async function initGuestSession(sessionId?: string): Promise<GuestInitResponse> {
  const resp = await fetch(`${BASE}/api/guest/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId || '' }),
  });
  if (!resp.ok) throw new Error('Guest init failed');
  return resp.json();
}

/**
 * Get current usage for a guest session.
 */
export async function getGuestUsage(sessionId: string): Promise<GuestUsageResponse> {
  const resp = await fetch(`${BASE}/api/guest/usage`, {
    headers: { 'X-Guest-Session-Id': sessionId },
  });
  if (!resp.ok) throw new Error('Guest usage fetch failed');
  return resp.json();
}

/**
 * Stream guest chat — returns the raw Response for SSE consumption.
 */
export async function streamGuestChat(
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  language: string = 'zh-CN',
): Promise<Response> {
  const resp = await fetch(`${BASE}/api/guest/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Guest-Session-Id': sessionId,
    },
    body: JSON.stringify({ messages, language }),
  });
  return resp;
}

/**
 * Migrate guest conversations to a registered account.
 * Must be called after login/signup with a valid auth token.
 */
export async function migrateGuestConversations(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
  conversations: Array<{ id: string; title: string; messages: Array<{ role: string; content: string }> }>,
): Promise<{ success: boolean; migrated: number; id_map: Record<string, string> }> {
  const resp = await authFetch(`${BASE}/api/auth/migrate-guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversations }),
  });
  if (!resp.ok) throw new Error('Migration failed');
  return resp.json();
}
