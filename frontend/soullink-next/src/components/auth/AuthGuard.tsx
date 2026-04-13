'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store';
import { setCredentials, logout } from '@/store/authSlice';
import { verifyToken, refreshToken as refreshTokenApi } from '@/lib/api/auth';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { token, refreshToken: storedRefreshToken, isAuthenticated } = useAppSelector((state) => state.auth);
  const [checking, setChecking] = useState(true);

  const isGuest = useAppSelector((state) => state.guest.isGuest);

  useEffect(() => {
    async function check() {
      // Guest mode -- skip auth verification entirely
      if (isGuest) {
        setChecking(false);
        return;
      }

      // No token at all -- redirect immediately
      if (!token) {
        router.replace('/login');
        return;
      }

      // Token exists -- verify it with the server
      try {
        let result = await verifyToken(token);

        // Access token expired but refresh token exists -- try to refresh
        if (!result.valid && storedRefreshToken) {
          try {
            const refreshed = await refreshTokenApi(storedRefreshToken);
            if (refreshed.token) {
              // Re-verify with new token
              result = await verifyToken(refreshed.token);
              if (result.valid && result.user) {
                // Save new access token
                dispatch(
                  setCredentials({
                    token: refreshed.token,
                    refreshToken: storedRefreshToken,
                    user: result.user,
                  }),
                );
              }
            }
          } catch {
            // Refresh failed -- fall through to normal invalid handling
          }
        }

        if (result.valid && result.user) {
          // Merge server user data with existing localStorage user data
          // to preserve fields like avatar_url that may not be returned
          // by the verify endpoint but were set during the session.
          let mergedUser = result.user;
          try {
            const storedRaw = localStorage.getItem('soullink_user');
            if (storedRaw) {
              const storedUser = JSON.parse(storedRaw);
              mergedUser = { ...storedUser, ...result.user };
              if (!result.user.avatar_url && storedUser.avatar_url) {
                mergedUser.avatar_url = storedUser.avatar_url;
              }
              if (storedUser.settings || result.user.settings) {
                mergedUser.settings = {
                  ...(storedUser.settings || {}),
                  ...(result.user.settings || {}),
                };
              }
            }
          } catch {
            // If parsing fails, just use server data
          }
          dispatch(
            setCredentials({
              token,
              user: mergedUser,
            }),
          );
          setChecking(false);
        } else {
          // Both token and refresh failed -- clear and redirect
          dispatch(logout());
          router.replace('/login');
        }
      } catch {
        // Network error -- if we have a token, optimistically show the page
        if (isAuthenticated) {
          setChecking(false);
        } else {
          router.replace('/login');
        }
      }
    }

    check();
  }, [token, storedRefreshToken, isAuthenticated, isGuest, router, dispatch]);

  if (checking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-dark)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '32px',
              height: '32px',
              borderWidth: '3px',
              borderStyle: 'solid',
              borderColor: 'rgba(255,255,255,0.2)',
              borderTopColor: 'var(--primary-color)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.875rem' }}>Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
