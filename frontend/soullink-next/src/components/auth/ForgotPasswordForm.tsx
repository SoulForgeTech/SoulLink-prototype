'use client';

/**
 * ForgotPasswordForm — email input to request a password reset code.
 *
 * Matches the glassmorphic style of LoginForm/RegisterForm.
 * On success, calls onCodeSent(email) to transition to the ResetPasswordForm.
 */

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { forgotPassword } from '@/lib/api/auth';

interface ForgotPasswordFormProps {
  onCodeSent: (email: string) => void;
  onBack: () => void;
  lang?: 'en' | 'zh';
}

const i18n = {
  en: {
    title: 'Reset your password',
    subtitle: "Enter your email and we'll send you a reset code",
    email: 'Email', emailPh: 'your@email.com',
    submit: 'Send Reset Code', submitting: 'Sending...',
    enterEmail: 'Please enter your email address.',
    sendFailed: 'Failed to send reset code.',
    networkError: 'Network error. Please check your connection.',
    back: '\u2190 Back to sign in',
  },
  zh: {
    title: '重置密码',
    subtitle: '输入你的邮箱，我们会发送重置验证码',
    email: '邮箱', emailPh: '请输入邮箱',
    submit: '发送重置验证码', submitting: '发送中...',
    enterEmail: '请输入邮箱地址',
    sendFailed: '发送验证码失败',
    networkError: '网络错误，请检查网络连接',
    back: '\u2190 返回登录',
  },
};

export default function ForgotPasswordForm({ onCodeSent, onBack, lang = 'en' }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const t = i18n[lang];

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    setError('');

    if (!email.trim()) {
      setError(t.enterEmail);
      return;
    }

    setLoading(true);
    try {
      const data = await forgotPassword(email.trim());

      if (!data.success) {
        setError(data.error || t.sendFailed);
        return;
      }

      onCodeSent(email.trim());
    } catch {
      setError(t.networkError);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  /* ---- Shared inline styles matching LoginForm exactly ---- */
  const formGroupStyle: React.CSSProperties = { marginBottom: '16px', textAlign: 'left' };
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '6px', fontSize: '0.9rem',
    color: 'rgba(255, 255, 255, 0.8)',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px',
    background: 'rgba(255, 255, 255, 0.15)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '10px', color: 'white', fontSize: '1rem',
    outline: 'none', transition: 'all 0.2s', boxSizing: 'border-box',
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
    <div>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ fontSize: '48px', marginBottom: '8px' }}>🔑</div>
        <h3 style={{ color: 'white', fontSize: '1.3rem', margin: '0 0 8px 0' }}>
          {t.title}
        </h3>
        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.88rem', margin: 0 }}>
          {t.subtitle}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.2)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          color: '#fca5a5', padding: '12px', borderRadius: '8px',
          marginBottom: '16px', fontSize: '0.9rem',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
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

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '14px', background: '#e8b4b8',
            color: '#5a4a4a', border: 'none', borderRadius: '10px',
            fontSize: '1rem', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s', marginTop: '8px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            opacity: loading ? 0.6 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
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
              <span style={{
                display: 'inline-block', width: '16px', height: '16px',
                borderWidth: '2px', borderStyle: 'solid',
                borderColor: 'rgba(90,74,74,0.3)', borderTopColor: '#5a4a4a',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              {t.submitting}
            </>
          ) : (
            t.submit
          )}
        </button>
      </form>

      {/* Back link */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: 'rgba(255, 255, 255, 0.45)', cursor: 'pointer',
            fontSize: '0.85rem', padding: 0, transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)'; }}
        >
          {t.back}
        </button>
      </div>
    </div>
  );
}
