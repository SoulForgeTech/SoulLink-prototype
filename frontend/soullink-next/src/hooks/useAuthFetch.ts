'use client';

/**
 * Auth-aware fetch hook.
 *
 * Creates an authFetch function bound to the Redux store so that
 * every API call automatically injects the Bearer token, handles
 * 401 → refresh → retry, and triggers logout when refresh fails.
 */

import { useMemo, useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { setCredentials, logout as logoutAction } from '@/store/authSlice';
import { createAuthFetch, type AuthFetchFn } from '@/lib/api/client';

/**
 * Returns a stable `authFetch` function that reads tokens from the
 * Redux store and handles refresh / logout automatically.
 *
 * The returned function has the same signature as `window.fetch`
 * but adds the Authorization header and retries on 401.
 */
export function useAuthFetch(): AuthFetchFn {
  const dispatch = useAppDispatch();

  // Use refs so the authFetch closure always reads the latest values
  // without needing to recreate the function on every render.
  const tokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  const token = useAppSelector((s) => s.auth.token);
  const refreshToken = useAppSelector((s) => s.auth.refreshToken);

  tokenRef.current = token;
  refreshTokenRef.current = refreshToken;

  const getToken = useCallback(() => tokenRef.current, []);
  const getRefreshToken = useCallback(() => refreshTokenRef.current, []);

  const onTokenRefreshed = useCallback(
    (newToken: string, user: Parameters<typeof setCredentials>[0]['user']) => {
      dispatch(setCredentials({ token: newToken, user }));
    },
    [dispatch],
  );

  const onLogout = useCallback(() => {
    dispatch(logoutAction());
    // Next.js App Router — navigate to login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, [dispatch]);

  const authFetch = useMemo(
    () =>
      createAuthFetch({
        getToken,
        getRefreshToken,
        onTokenRefreshed,
        onLogout,
      }),
    [getToken, getRefreshToken, onTokenRefreshed, onLogout],
  );

  return authFetch;
}
