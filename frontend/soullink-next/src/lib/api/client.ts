/**
 * Authenticated fetch wrapper — drop-in replacement for all authenticated API calls.
 *
 * Ported from the original authFetch() in index.html (lines 8082-8121).
 *
 * Behaviour:
 * 1. If no token is available but a refresh token exists, try refreshing first.
 * 2. Injects Authorization: Bearer <token> header.
 * 3. On 401 response, attempt token refresh and retry the original request once.
 * 4. On refresh failure, calls the onLogout callback.
 * 5. Returns the native Response object (required for SSE streaming).
 */

import { AUTH } from './endpoints';
import type { RefreshResponse } from '@/types';

export interface AuthFetchOptions {
  /** Returns the current access token (JWT). */
  getToken: () => string | null;
  /** Returns the current refresh token. */
  getRefreshToken: () => string | null;
  /** Called when a new token pair is obtained via refresh. */
  onTokenRefreshed: (token: string, user: RefreshResponse['user']) => void;
  /** Called when both token and refresh have failed — user must re-authenticate. */
  onLogout: () => void;
}

/**
 * Creates a configured authFetch function bound to the given auth callbacks.
 *
 * Usage:
 * ```ts
 * const authFetch = createAuthFetch({
 *   getToken: () => store.token,
 *   getRefreshToken: () => store.refreshToken,
 *   onTokenRefreshed: (token, user) => { store.token = token; store.user = user; },
 *   onLogout: () => { store.clear(); router.push('/login'); },
 * });
 *
 * const response = await authFetch('/api/conversations');
 * ```
 */
export function createAuthFetch(opts: AuthFetchOptions) {
  const { getToken, getRefreshToken, onTokenRefreshed, onLogout } = opts;

  /**
   * Attempt to exchange the refresh token for a new access token.
   * Returns true on success, false on failure.
   */
  async function tryRefreshToken(): Promise<boolean> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const resp = await fetch(AUTH.REFRESH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (resp.ok) {
        const data: RefreshResponse = await resp.json();
        onTokenRefreshed(data.token, data.user);
        return true;
      }
    } catch (e) {
      console.error('Refresh token failed:', e);
    }

    return false;
  }

  /**
   * Authenticated fetch — mirrors the original authFetch() from the vanilla JS app.
   * Returns the raw Response so callers can handle SSE streaming, JSON parsing, etc.
   */
  async function authFetch(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(options.headers);

    // Sync check: if the stored token was cleared externally, drop the in-memory copy.
    let token = getToken();

    // Inject bearer token if available.
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    // If no token but we have a refresh token, try refreshing preemptively
    // instead of sending a request that will certainly 401.
    if (!token && getRefreshToken()) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        token = getToken();
        headers.set('Authorization', `Bearer ${token}`);
      } else {
        onLogout();
        return new Response(JSON.stringify({ error: 'Session expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let response = await fetch(url, { ...options, headers });

    // 401 and we have a refresh token → attempt refresh + retry once.
    if (response.status === 401 && getRefreshToken()) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        token = getToken();
        headers.set('Authorization', `Bearer ${token}`);
        response = await fetch(url, { ...options, headers });
      } else {
        // Refresh also failed → force logout.
        onLogout();
      }
    }

    return response;
  }

  return authFetch;
}

/** Type of the authFetch function returned by createAuthFetch. */
export type AuthFetchFn = ReturnType<typeof createAuthFetch>;
