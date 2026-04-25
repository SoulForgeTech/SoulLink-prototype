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
    forgot: 'Forgot password?', submit: 'Sign In', submitting: 'Signing in...',
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
    forgot: '忘记密码？', submit: '登录', submitting: '登录中...',
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

  /* ---- Shared inline styles matching original CSS exactly ---- */
  const formGroupStyle: React.CSSProperties = {
    marginBottom: '16px',
    textAlign: 'left',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '6px',
    fontSize: '0.9rem',
    color: 'rgba(255, 255, 255, 0.8)',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255, 255, 255, 0.15)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '10px',
    color: 'white',
    fontSize: '1rem',
    outline: 'none',
    transition: 'all 0.2s',
    boxSizing: 'border-box',
    opacity: loading ? 0.5 : 1,
  };

  function handleInputFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
  }

  function handleInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* .auth-error */}
      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.9rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div>{error.message}</div>
          {/* Code-aware CTA: signup for missing email, forgot-password for bad password */}
          {error.code === 'EMAIL_NOT_FOUND' && onSwitchToSignup && (
            <button
              type="button"
              onClick={onSwitchToSignup}
              style={{
                alignSelf: 'flex-start',
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: '#fff',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {t.ctaSignup}
            </button>
          )}
          {error.code === 'WRONG_PASSWORD' && (
            <button
              type="button"
              onClick={onForgotPassword}
              style={{
                alignSelf: 'flex-start',
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: '#fff',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {t.ctaForgot}
            </button>
          )}
        </div>
      )}

      {/* Email .form-group */}
      <div style={formGroupStyle}>
        <label style={labelStyle}>{t.email}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={t.emailPh}
          autoComplete="email"
          disabled={loading}
          className="auth-input"
          style={inputStyle}
        />
      </div>

      {/* Password .form-group */}
      <div style={formGroupStyle}>
        <label style={labelStyle}>{t.password}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={t.passwordPh}
          autoComplete="current-password"
          disabled={loading}
          className="auth-input"
          style={inputStyle}
        />
      </div>

      {/* Forgot password link */}
      <div style={{ textAlign: 'right', marginBottom: '8px', marginTop: '-8px' }}>
        <button
          type="button"
          onClick={onForgotPassword}
          style={{
            background: 'none', border: 'none',
            color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer',
            fontSize: '0.82rem', padding: 0, transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#e8b4b8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)'; }}
        >
          {t.forgot}
        </button>
      </div>

      {/* .auth-submit-btn */}
      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: '14px',
          background: '#e8b4b8',
          color: '#5a4a4a',
          border: 'none',
          borderRadius: '10px',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'all 0.3s',
          marginTop: '8px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          opacity: loading ? 0.6 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
        onMouseEnter={(e) => {
          if (!loading) {
            e.currentTarget.style.background = '#d9a5a9';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#e8b4b8';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        }}
      >
        {loading ? (
          <>
            <span
              style={{
                display: 'inline-block',
                width: '16px',
                height: '16px',
                borderWidth: '2px',
                borderStyle: 'solid',
                borderColor: 'rgba(90,74,74,0.3)',
                borderTopColor: '#5a4a4a',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            {t.submitting}
          </>
        ) : (
          t.submit
        )}
      </button>
    </form>
  );
}
