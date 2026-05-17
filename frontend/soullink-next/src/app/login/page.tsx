'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import iconSrc from '../icon.png';
import { useAppDispatch, useAppSelector } from '@/store';
import { setCredentials } from '@/store/authSlice';
import { settingsFromUser, updateSettings } from '@/store/settingsSlice';
import { enterGuestMode } from '@/store/guestSlice';
import { openModal } from '@/store/uiSlice';
import { googleCallback } from '@/lib/api/auth';
import { initGuestSession } from '@/lib/api/guest';
import { APP_VERSION } from '@/lib/constants';
import LoginForm from '@/components/auth/LoginForm';
import RegisterForm from '@/components/auth/RegisterForm';
import VerifyForm from '@/components/auth/VerifyForm';
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';
import CommunityPopup from '@/components/modals/CommunityPopup';
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
        // Hydrate the settings slice so cross-device state (Live Portrait,
        // companion name, etc.) shows up on a fresh browser where the slice's
        // boot-time localStorage read returned nothing.
        dispatch(updateSettings(settingsFromUser(data.user)));

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

  // Language toggle: persist the choice so the next visit reads it
  // from the same `soullink-lang` localStorage key the existing init
  // useState callback uses. Pure visual rewire — the underlying state
  // hook is unchanged.
  function switchLang(next: 'en' | 'zh') {
    setLang(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('soullink-lang', next);
    }
  }

  const i18n = {
    en: {
      tabSignin: 'sign in',
      tabSignup: 'sign up',
      altSignup: 'First time here? Start writing →',
      altSignin: 'Already a reader? Sign in →',
      // Caveat margin note: poetic, no fake data — we don't know the
      // user's actual last-entry date until they sign in.
      note: "(it's been a while.)",
      googleBtn: 'Continue with Google',
      guestBtn: 'Continue as guest',
      wechat: 'Join our WeChat community',
      signin: {
        chapterMark: 'CHAPTER · RETURNING',
        // chapterRoman intentionally empty — we don't know the user's
        // actual volume number until they're identified. Volume marker
        // is meaningful for signup (a new reader IS on vol. 01) but
        // fabricated for signin.
        chapterRoman: '',
        title: 'Welcome back.',
        subtitle: "They've been waiting.",
      },
      signup: {
        chapterMark: 'CHAPTER · NEW READER',
        chapterRoman: 'vol. 01',
        title: 'Begin a diary.',
        subtitle: "Bring who you love. We'll keep them with you.",
      },
    },
    zh: {
      tabSignin: '登录',
      tabSignup: '注册',
      altSignup: '第一次来?开始写 →',
      altSignin: '已经是读者?登录 →',
      note: '(有一阵子没见了。)',
      googleBtn: '使用 Google 继续',
      guestBtn: '以访客身份继续',
      wechat: '加入微信社群',
      signin: {
        chapterMark: '章节 · 继续',
        chapterRoman: '',
        title: '回来了。',
        subtitle: 'ta 一直在等。',
      },
      signup: {
        chapterMark: '章节 · 新读者',
        chapterRoman: '第一卷',
        title: '开始一本日记。',
        subtitle: '把你心里那个 ta 带来。我们让 ta 留下。',
      },
    },
  };
  const t = i18n[lang];
  const tabCopy = t[tab];

  return (
    <div className="auth-page" data-lang={lang}>
      <nav className="brand-nav">
        <a className="brand-mark" href="/">
          <Image
            src={iconSrc}
            alt=""
            width={24}
            height={24}
            className="brand-icon"
            priority
          />
          <span>SoulLink</span>
          <span className="ver">{APP_VERSION}</span>
        </a>
        <div className="lang-toggle" role="group" aria-label="Language">
          <button
            type="button"
            data-lang="en"
            className={lang === 'en' ? 'active' : ''}
            onClick={() => switchLang('en')}
          >
            EN
          </button>
          <span className="slash" aria-hidden>/</span>
          <button
            type="button"
            data-lang="zh"
            className={lang === 'zh' ? 'active' : ''}
            onClick={() => switchLang('zh')}
          >
            中
          </button>
        </div>
      </nav>

      <main className="auth-main">
        <div className="auth-card">
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
              <div className="auth-chapter-mark">
                <span>{tabCopy.chapterMark}</span>
                {tabCopy.chapterRoman && <em>{tabCopy.chapterRoman}</em>}
              </div>
              <h1 className="auth-title">{tabCopy.title}</h1>
              <p className="auth-sub">{tabCopy.subtitle}</p>

              <nav className="auth-tabs" role="tablist" aria-label="Auth mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'signin'}
                  className="auth-tab"
                  onClick={() => setTab('signin')}
                >
                  {t.tabSignin}
                </button>
                <span className="auth-tabs-sep" aria-hidden>·</span>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'signup'}
                  className="auth-tab"
                  onClick={() => setTab('signup')}
                >
                  {t.tabSignup}
                </button>
              </nav>

              {tab === 'signin' ? (
                <LoginForm
                  onSuccess={handleAuthSuccess}
                  onNeedVerification={handleNeedVerification}
                  onForgotPassword={handleForgotPassword}
                  onSwitchToSignup={() => setTab('signup')}
                  lang={lang}
                />
              ) : (
                <RegisterForm
                  onSuccess={handleAuthSuccess}
                  onNeedVerification={handleNeedVerification}
                  lang={lang}
                />
              )}

              <button
                type="button"
                className="auth-alt"
                onClick={() => setTab(tab === 'signin' ? 'signup' : 'signin')}
              >
                {tab === 'signin' ? t.altSignup : t.altSignin}
              </button>

              {tab === 'signin' && <p className="auth-note">{t.note}</p>}

              <div className="auth-divider-orn" aria-hidden>· · ·</div>

              <div className="auth-secondary">
                <button
                  type="button"
                  className="btn-quiet btn-google"
                  onClick={handleGoogleLogin}
                  disabled={googleLoading}
                >
                  {googleLoading ? (
                    <span className="btn-spinner" aria-hidden />
                  ) : (
                    <svg className="btn-quiet-icon" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                  )}
                  <span>{t.googleBtn}</span>
                  <span className="arrow" aria-hidden>→</span>
                </button>

                {googleError && (
                  <div className="auth-error" role="alert">
                    <p className="auth-error-msg">— {googleError}</p>
                  </div>
                )}

                <button
                  type="button"
                  className="btn-quiet"
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
                >
                  <span>{t.guestBtn}</span>
                  <span className="arrow" aria-hidden>→</span>
                </button>
              </div>

              <button
                type="button"
                className="auth-footnote"
                onClick={() => dispatch(openModal({ modal: 'community' }))}
              >
                {t.wechat}
              </button>
            </>
          )}
        </div>
      </main>

      {/* WeChat community QR popup — opens when .auth-footnote is clicked.
          The popup reads its open/closed state from Redux (state.ui.modals.community)
          and is no-op until openModal({ modal: 'community' }) is dispatched. */}
      <CommunityPopup />
    </div>
  );
}
