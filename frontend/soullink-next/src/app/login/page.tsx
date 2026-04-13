'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/store';
import { setCredentials } from '@/store/authSlice';
import { enterGuestMode } from '@/store/guestSlice';
import { googleCallback } from '@/lib/api/auth';
import { initGuestSession } from '@/lib/api/guest';
import LoginForm from '@/components/auth/LoginForm';
import RegisterForm from '@/components/auth/RegisterForm';
import VerifyForm from '@/components/auth/VerifyForm';
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';
import type { AuthResponse } from '@/types';

type AuthTab = 'signin' | 'signup';
type View = 'auth' | 'verify' | 'forgot' | 'reset';

export default function LoginPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { isAuthenticated } = useAppSelector((state) => state.auth);

  const [tab, setTab] = useState<AuthTab>('signin');
  const [view, setView] = useState<View>('auth');
  const [verifyEmail, setVerifyEmail] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetNoPassword, setResetNoPassword] = useState(false);
  const [lang, setLang] = useState<'en' | 'zh'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('soullink-lang') as 'en' | 'zh') || 'en';
    }
    return 'en';
  });
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/chat');
    }
  }, [isAuthenticated, router]);

  const handleAuthSuccess = useCallback(
    async (data: AuthResponse) => {
      if (data.token && data.user) {
        dispatch(
          setCredentials({
            token: data.token,
            refreshToken: data.refresh_token,
            user: data.user,
          }),
        );

        // Migrate guest conversations if coming from guest mode
        const guestSessionId = localStorage.getItem('soullink_guest_session_id');
        if (guestSessionId) {
          try {
            const { loadGuestConversations, clearGuestStorage } = await import('@/lib/guestStorage');
            const { migrateGuestConversations } = await import('@/lib/api/guest');
            const { exitGuestMode } = await import('@/store/guestSlice');

            const guestConvs = loadGuestConversations();
            if (guestConvs.length > 0) {
              // Create an auth-aware fetch using the new token
              const migrateFetch = (url: string, init?: RequestInit) =>
                fetch(url, {
                  ...init,
                  headers: {
                    ...init?.headers,
                    Authorization: `Bearer ${data.token}`,
                  },
                });

              await migrateGuestConversations(migrateFetch, guestConvs);
              console.log('[AUTH] Guest conversations migrated');
            }

            dispatch(exitGuestMode());
            clearGuestStorage();
          } catch (err) {
            console.warn('[AUTH] Guest migration failed:', err);
            // Non-blocking — user still enters chat normally
          }
        }

        router.push('/chat');
      }
    },
    [dispatch, router],
  );

  const handleNeedVerification = useCallback((email: string) => {
    setVerifyEmail(email);
    setView('verify');
  }, []);

  const handleForgotPassword = useCallback(() => {
    setView('forgot');
  }, []);

  const handleResetCodeSent = useCallback((email: string, noPassword?: boolean) => {
    setResetEmail(email);
    setResetNoPassword(!!noPassword);
    setView('reset');
  }, []);

  function handleGoogleLogin() {
    setGoogleError('');
    setGoogleLoading(true);

    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      setGoogleError('Google OAuth is not configured.');
      setGoogleLoading(false);
      return;
    }

    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const redirectUri = `${window.location.origin}/callback`;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', googleClientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('prompt', 'select_account');

    const popup = window.open(
      authUrl.toString(),
      'google-oauth',
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'google-auth-code') {
        window.removeEventListener('message', onMessage);
        handleGoogleCode(event.data.code);
      }
    }
    window.addEventListener('message', onMessage);

    const interval = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(interval);
        window.removeEventListener('message', onMessage);
        setGoogleLoading(false);
      }
    }, 500);
  }

  async function handleGoogleCode(code: string) {
    try {
      const redirectUri = `${window.location.origin}/callback`;
      const data = await googleCallback({ code, redirect_uri: redirectUri });
      if (data.success && data.token && data.user) {
        handleAuthSuccess(data);
      } else {
        setGoogleError(data.error || 'Google login failed.');
      }
    } catch {
      setGoogleError('Network error during Google login.');
    } finally {
      setGoogleLoading(false);
    }
  }

  const t = {
    en: {
      subtitle: 'Your AI Companion, Always Here',
      signin: 'Sign In',
      signup: 'Sign Up',
      or: 'or',
      googleBtn: 'Continue with Google',
      tryIt: '✨ Try it out — no signup needed',
      wechat: '💬 Join our WeChat community',
      langToggle: '中文',
    },
    zh: {
      subtitle: '你的 AI 灵魂伴侣',
      signin: '登录',
      signup: '注册',
      or: '或者',
      googleBtn: '使用 Google 登录',
      tryIt: '✨ 先试试看 — 无需注册',
      wechat: '💬 加入微信社群',
      langToggle: 'EN',
    },
  }[lang];

  return (
    /* #login-page: fixed inset-0, flex center, bg image, z-1000 */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: "url('/images/bg.webp')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        zIndex: 1000,
      }}
    >
      {/* ::before overlay — rgba(0,0,0,0.4) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: -1,
        }}
      />

      {/* .login-container */}
      <div
        style={{
          position: 'relative',
          textAlign: 'center',
          width: '440px',
          maxWidth: '92vw',
          padding: '40px 50px',
          background: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          maxHeight: '90vh',
          overflowY: 'auto',
          animation: 'fadeInUp 0.6s ease-out',
        }}
      >
        {/* .login-lang-toggle — inside container, absolute top-right */}
        <button
          onClick={() => setLang((prev) => {
            const next = prev === 'en' ? 'zh' : 'en';
            localStorage.setItem('soullink-lang', next);
            return next;
          })}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            padding: '5px 12px',
            background: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: 'rgba(255, 255, 255, 0.85)',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontFamily: "'Poppins', sans-serif",
            letterSpacing: '0.3px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)';
          }}
        >
          {t.langToggle}
        </button>

        {/* .login-logo */}
        <div style={{ fontSize: '3rem', marginBottom: '10px', animation: 'pulse 2s ease-in-out infinite' }}>
          💫
        </div>

        {/* .login-title */}
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 700,
            color: '#fff',
            textShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
            marginBottom: '10px',
          }}
        >
          SoulLink
        </h1>

        {/* .login-subtitle */}
        <p
          style={{
            color: 'rgba(255, 255, 255, 0.85)',
            marginBottom: '40px',
            fontSize: '1.1rem',
            textShadow: '0 1px 5px rgba(0, 0, 0, 0.2)',
          }}
        >
          {t.subtitle}
        </p>

        {/* Auth content */}
        {view === 'verify' ? (
          <VerifyForm
            email={verifyEmail}
            onSuccess={handleAuthSuccess}
            onBack={() => setView('auth')}
            lang={lang}
          />
        ) : view === 'forgot' ? (
          <ForgotPasswordForm
            onCodeSent={handleResetCodeSent}
            onBack={() => setView('auth')}
            lang={lang}
          />
        ) : view === 'reset' ? (
          <ResetPasswordForm
            email={resetEmail}
            onSuccess={handleAuthSuccess}
            onBack={() => setView('auth')}
            lang={lang}
            noPassword={resetNoPassword}
          />
        ) : (
          <>
            {/* .auth-form wrapper */}
            <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
              {/* .auth-tabs */}
              <div
                style={{
                  display: 'flex',
                  marginBottom: '24px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                }}
              >
                <button
                  onClick={() => setTab('signin')}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'transparent',
                    border: 'none',
                    color: tab === 'signin' ? 'white' : 'rgba(255, 255, 255, 0.6)',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    borderBottom: tab === 'signin' ? '2px solid rgba(255, 255, 255, 0.8)' : '2px solid transparent',
                  }}
                >
                  {t.signin}
                </button>
                <button
                  onClick={() => setTab('signup')}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'transparent',
                    border: 'none',
                    color: tab === 'signup' ? 'white' : 'rgba(255, 255, 255, 0.6)',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    borderBottom: tab === 'signup' ? '2px solid rgba(255, 255, 255, 0.8)' : '2px solid transparent',
                  }}
                >
                  {t.signup}
                </button>
              </div>

              {/* Form */}
              {tab === 'signin' ? (
                <LoginForm
                  onSuccess={handleAuthSuccess}
                  onNeedVerification={handleNeedVerification}
                  onForgotPassword={handleForgotPassword}
                  lang={lang}
                />
              ) : (
                <RegisterForm
                  onSuccess={handleAuthSuccess}
                  onNeedVerification={handleNeedVerification}
                  lang={lang}
                />
              )}
            </div>

            {/* .auth-divider */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                margin: '24px 0',
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.2)' }} />
              <span style={{ padding: '0 16px' }}>{t.or}</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.2)' }} />
            </div>
          </>
        )}

        {/* .google-login-btn — only show on auth view */}
        {view === 'auth' && (
          <>
            <button
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 28px',
                background: 'white',
                color: '#333',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: 500,
                cursor: googleLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
                opacity: googleLoading ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!googleLoading) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
              }}
            >
              {googleLoading ? (
                <span
                  style={{
                    display: 'inline-block',
                    width: '20px',
                    height: '20px',
                    border: '2px solid #d1d5db',
                    borderTopColor: '#4b5563',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              ) : (
                <svg style={{ width: '20px', height: '20px' }} viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              {t.googleBtn}
            </button>

            {googleError && (
              <div
                style={{
                  marginTop: '12px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '0.9rem',
                }}
              >
                {googleError}
              </div>
            )}
          </>
        )}

        {/* Guest mode — "Try it out" button */}
        {view === 'auth' && (
          <button
            onClick={async () => {
              try {
                const existingId = localStorage.getItem('soullink_guest_session_id') || '';
                const result = await initGuestSession(existingId);
                dispatch(enterGuestMode(result.session_id));
                router.push('/chat');
              } catch (err) {
                console.error('Guest init failed:', err);
              }
            }}
            style={{
              marginTop: '12px',
              padding: '12px 28px',
              background: 'transparent',
              color: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              width: '100%',
              maxWidth: '320px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
            }}
          >
            {t.tryIt}
          </button>
        )}

        {/* .login-community-link */}
        <div
          style={{
            marginTop: '16px',
            textAlign: 'center',
            cursor: 'pointer',
            fontSize: '0.78rem',
            color: 'rgba(255, 255, 255, 0.7)',
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'; }}
        >
          {t.wechat}
        </div>
      </div>
    </div>
  );
}
