'use client';

/**
 * ForgotPasswordForm — email input to request a password reset code.
 *
 * On success, calls onCodeSent(email) to transition to the ResetPasswordForm.
 */

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { forgotPassword } from '@/lib/api/auth';

interface ForgotPasswordFormProps {
  onCodeSent: (email: string, noPassword?: boolean) => void;
  onBack: () => void;
  lang?: 'en' | 'zh';
}

const i18n = {
  en: {
    chapterMark: 'CHAPTER · FORGOTTEN',
    title: 'A few pages went missing.',
    subtitle: "Tell us your email — we'll send a fresh key.",
    email: 'Email', emailPh: 'your@email.com',
    submit: 'Send the key', submitting: 'Sending...',
    stampMain: 'FORGOT',
    enterEmail: 'Please enter your email address.',
    sendFailed: 'Failed to send reset code.',
    networkError: 'Network error. Please check your connection.',
    back: '← back to sign in',
  },
  zh: {
    chapterMark: '章节 · 遗忘',
    title: '几页弄丢了。',
    subtitle: '告诉我们邮箱 — 我们寄一把新钥匙。',
    email: '邮箱', emailPh: '请输入邮箱',
    submit: '发送钥匙', submitting: '发送中...',
    stampMain: '遗忘',
    enterEmail: '请输入邮箱地址',
    sendFailed: '发送验证码失败',
    networkError: '网络错误，请检查网络连接',
    back: '← 返回登录',
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

      onCodeSent(email.trim(), data.no_password);
    } catch {
      setError(t.networkError);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <>
      <div className="auth-chapter-mark">
        <span>{t.chapterMark}</span>
      </div>
      <h1 className="auth-title">{t.title}</h1>
      <p className="auth-sub">{t.subtitle}</p>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && (
          <div className="auth-error" role="alert">
            <p className="auth-error-msg">— {error}</p>
          </div>
        )}

        <div className="auth-field">
          <label className="auth-field-label" htmlFor="forgot-email">{t.email}</label>
          <input
            id="forgot-email"
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
          </div>
        </div>
      </form>

      <button type="button" className="back-link" onClick={onBack}>
        {t.back}
      </button>
    </>
  );
}
