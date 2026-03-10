/**
 * Auth API functions.
 *
 * These endpoints are called WITHOUT authFetch (no token needed),
 * since they handle login/register/verification flows.
 */

import { AUTH } from './endpoints';
import type { AuthResponse } from '@/types';

/**
 * Email + password login.
 * Returns token pair on success, or requires_verification flag if email is unverified.
 */
export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const response = await fetch(AUTH.LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return response.json();
}

/**
 * Email + password registration.
 * Typically returns requires_verification: true so the user must verify their email.
 */
export async function register(
  email: string,
  password: string,
  name: string,
): Promise<AuthResponse> {
  const response = await fetch(AUTH.REGISTER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return response.json();
}

/**
 * Submit the 6-digit email verification code.
 * On success returns token pair + user object.
 */
export async function verifyEmail(
  email: string,
  code: string,
): Promise<AuthResponse> {
  const response = await fetch(AUTH.VERIFY_EMAIL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  return response.json();
}

/**
 * Resend the verification code to the given email.
 */
export async function resendCode(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(AUTH.RESEND_CODE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return response.json();
}

/**
 * Request a password reset code for the given email.
 * Backend always returns success to prevent email enumeration.
 */
export async function forgotPassword(
  email: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch(AUTH.FORGOT_PASSWORD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return response.json();
}

/**
 * Verify the 6-digit reset code and set a new password.
 * On success returns token pair + user object (same shape as login).
 */
export async function resetPassword(
  email: string,
  code: string,
  password: string,
): Promise<AuthResponse> {
  const response = await fetch(AUTH.RESET_PASSWORD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, password }),
  });
  return response.json();
}

/**
 * Google OAuth callback — send the credential (ID token) or authorization code
 * to the backend for verification.
 */
export async function googleCallback(payload: {
  credential?: string;
  code?: string;
  redirect_uri?: string;
}): Promise<AuthResponse> {
  const response = await fetch(AUTH.GOOGLE_CALLBACK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

/**
 * Exchange a refresh token for a new access token.
 * Called internally by the authFetch client, but exposed here for flexibility.
 */
export async function refreshToken(
  refresh_token: string,
): Promise<{ token: string; user: AuthResponse['user'] }> {
  const response = await fetch(AUTH.REFRESH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token }),
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  return response.json();
}

/**
 * Notify the server to revoke the refresh token (fire-and-forget).
 */
export function logout(refresh_token: string): void {
  fetch(AUTH.LOGOUT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token }),
  }).catch(() => {
    // Fire and forget — ignore errors.
  });
}

/**
 * Verify the current access token and get fresh user data.
 * Returns the user object on success or null on failure.
 */
export async function verifyToken(
  token: string,
): Promise<{ valid: boolean; user?: AuthResponse['user'] }> {
  // Note: network errors are intentionally NOT caught here so that
  // AuthGuard can distinguish "server says invalid" from "server unreachable"
  // and optimistically show the page when offline.
  const response = await fetch(AUTH.VERIFY, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.ok) {
    const data = await response.json();
    return { valid: true, user: data.user };
  }

  return { valid: false };
}
