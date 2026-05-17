'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { login } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface LoginFormProps {
  onSuccess: (data: AuthResponse) => void;
  onNeedVerification: (email: string) => void;
  onForgotPassword: () => void;
  /** Switch the parent tab to the signup form (called from EMAIL_NOT_FOUND CTA). */
  onSwitchToSignup?: () => void;
  lang?: 'en' | 'zh';
}

const i18n = {
  en: {
    email: 'Email', emailPh: 'your@email.com',
    password: 'Password', passwordPh: 'Enter your password',
    forgot: 'Forgot password?',
    submit: 'Open the diary',
    submitting: 'Opening...',
    stampMain: 'RESUMING',
    // stampSub intentionally empty — we don't know the user's actual
    // volume number until they're authenticated. Removing rather than
    // faking the data.
    stampSub: '',
    fillAll: 'Please fill in all fields.',
    loginFailed: 'Login failed. Please try again.',
    networkError: 'Network error. Please check your connection.',
    errEmailNotFound: 'This email is not registered.',
    errWrongPassword: 'Wrong password.',
    errGoogleAccount: 'This account uses Google Sign-In. Please log in with Google.',
    errRateLimited: 'Too many failed attempts. Please try again in a few minutes.',
    ctaSignup: 'Sign up instead',
    ctaForgot: 'Forgot password?',
  },
  zh: {
    email: '邮箱', emailPh: '请输入邮箱',
    password: '密码', passwordPh: '请输入密码',
    forgot: '忘记密码？',
    submit: '打开日记',
    submitting: '打开中...',
    stampMain: '继续',
    stampSub: '',
    fillAll: '请填写所有字段',
    loginFailed: '登录失败，请重试',
    networkError: '网络错误，请检查网络连接',
    errEmailNotFound: '该邮箱尚未注册',
    errWrongPassword: '密码错误',
    errGoogleAccount: '该邮箱使用 Google 登录，请用 Google 方式登录',
    errRateLimited: '尝试次数过多，请稍后再试',
    ctaSignup: '去注册',
    ctaForgot: '忘记密码？',
  },
};

interface ErrorState {
  message: string;
  code?: string;
}

export default function LoginForm({ onSuccess, onNeedVerification, onForgotPassword, onSwitchToSignup, lang = 'en' }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ErrorState | null>(null);
  const [loading, setLoading] = useState(false);
  const t = i18n[lang];

  /** Map backend error code → localized message. Falls back to backend message. */
  function messageForCode(code: string | undefined, fallback: string): string {
    switch (code) {
      case 'EMAIL_NOT_FOUND': return t.errEmailNotFound;
      case 'WRONG_PASSWORD':  return t.errWrongPassword;
      case 'GOOGLE_ACCOUNT':  return t.errGoogleAccount;
      case 'RATE_LIMITED':    return t.errRateLimited;
      default:                return fallback || t.loginFailed;
    }
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError({ message: t.fillAll });
      return;
    }

    setLoading(true);
    try {
      const data = await login(email.trim(), password);

      if (data.requires_verification) {
        onNeedVerification(data.email || email.trim());
        return;
      }

      if (!data.success) {
        setError({
          message: messageForCode(data.code, data.error || ''),
          code: data.code,
        });
        return;
      }

      onSuccess(data);
    } catch {
      setError({ message: t.networkError });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      {error && (
        <div className="auth-error" role="alert">
          <p className="auth-error-msg">— {error.message}</p>
          {error.code === 'EMAIL_NOT_FOUND' && onSwitchToSignup && (
            <button type="button" className="auth-error-cta" onClick={onSwitchToSignup}>
              {t.ctaSignup} →
            </button>
          )}
          {error.code === 'WRONG_PASSWORD' && (
            <button type="button" className="auth-error-cta" onClick={onForgotPassword}>
              {t.ctaForgot} →
            </button>
          )}
        </div>
      )}

      <div className="auth-field">
        <label className="auth-field-label" htmlFor="login-email">{t.email}</label>
        <input
          id="login-email"
          type="email"
          className="auth-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.emailPh}
          autoComplete="email"
          disabled={loading}
        />
      </div>

      <div className="auth-field">
        <label className="auth-field-label" htmlFor="login-password">{t.password}</label>
        <input
          id="login-password"
          type="password"
          className="auth-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.passwordPh}
          autoComplete="current-password"
          disabled={loading}
        />
      </div>

      <button
        type="button"
        className="auth-alt-small"
        onClick={onForgotPassword}
      >
        {t.forgot}
      </button>

      <div className="auth-submit-row">
        <button type="submit" className="btn-stamp" disabled={loading}>
          {loading ? (
            <>
              <span className="btn-spinner" aria-hidden />
              <span>{t.submitting}</span>
            </>
          ) : (
            <>
              <span>{t.submit}</span>
              <span className="arrow" aria-hidden>→</span>
            </>
          )}
        </button>

        <div className="wax-stamp" aria-hidden>
          <span>{t.stampMain}</span>
          {t.stampSub && <span className="stamp-sub">{t.stampSub}</span>}
        </div>
      </div>
    </form>
  );
}
