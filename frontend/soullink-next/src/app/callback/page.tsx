'use client';

/**
 * Google OAuth callback page.
 *
 * Google redirects here after the user authorizes the app, with `?code=...` in the URL.
 * This page extracts the authorization code and sends it back to the opener window
 * (the login page popup) via postMessage, then closes itself.
 *
 * Registered redirect URI in Google Console: http://localhost:55920/callback
 */

import { useEffect } from 'react';

export default function OAuthCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (code && window.opener) {
      // Send the auth code back to the opener (login page)
      window.opener.postMessage(
        { type: 'google-auth-code', code },
        window.location.origin,
      );
      // Close the popup
      window.close();
    } else if (error) {
      // Google returned an error (user denied, etc.)
      if (window.opener) {
        window.opener.postMessage(
          { type: 'google-auth-error', error },
          window.location.origin,
        );
      }
      window.close();
    } else {
      // No code and no error — might be a direct visit
      // Redirect to login
      window.location.href = '/login';
    }
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a1a2e',
        color: 'rgba(255,255,255,0.7)',
        fontSize: '0.9rem',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid rgba(255,255,255,0.2)',
            borderTopColor: '#6BA3D6',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        Completing sign in...
      </div>
    </div>
  );
}
