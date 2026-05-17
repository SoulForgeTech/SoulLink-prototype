'use client';

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { verifyEmail, resendCode } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface VerifyFormProps {
  email: string;
  onSuccess: (data: AuthResponse) => void;
  onBack: () => void;
  lang?: 'en' | 'zh';
}

const i18n = {
  en: {
    chapterMark: 'CHAPTER · VERIFYING',
    title: 'Check your inbox.',
    subtitle: 'We left a six-digit mark for',
    codeLabel: 'Verification Code',
    submit: 'Confirm', submitting: 'Confirming...',
    stampMain: 'AWAITING',
    invalidCode: 'Invalid verification code.',
    networkError: 'Network error. Please try again.',
    noCode: "Didn't receive it?",
    resend: 'send another',
    codeSent: 'Code sent! Check your inbox.',
    resendFailed: 'Failed to resend code.',
    back: '← back',
  },
  zh: {
    chapterMark: '章节 · 验证',
    title: '去看看你的邮箱。',
    subtitle: '我们给这个邮箱留了一个六位数的印记：',
    codeLabel: '验证码',
    submit: '确认', submitting: '确认中...',
    stampMain: '等待中',
    invalidCode: '验证码无效',
    networkError: '网络错误，请重试',
    noCode: '没有收到?',
    resend: '再发一次',
    codeSent: '验证码已发送，请查看邮箱',
    resendFailed: '重新发送失败',
    back: '← 返回',
  },
};

export default function VerifyForm({ email, onSuccess, onBack, lang = 'en' }: VerifyFormProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendMsg, setResendMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const t = i18n[lang];

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = useCallback(
    async (submitCode: string) => {
      if (submitCode.length !== 6) return;
      setError('');
      setLoading(true);
      try {
        const data = await verifyEmail(email, submitCode);

        if (!data.success) {
          setError(data.error || t.invalidCode);
          setCode('');
          inputRef.current?.focus();
          return;
        }

        onSuccess(data);
      } catch {
        setError(t.networkError);
      } finally {
        setLoading(false);
      }
    },
    [email, onSuccess, t.invalidCode, t.networkError],
  );

  function handleChange(value: string) {
    const cleaned = value.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    // Auto-submit when 6 digits entered
    if (cleaned.length === 6) {
      handleSubmit(cleaned);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && code.length === 6) {
      handleSubmit(code);
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setResendMsg('');
    setError('');

    try {
      const data = await resendCode(email);
      if (data.success) {
        setResendMsg(t.codeSent);
        setCooldown(60);
      } else {
        setError(data.error || t.resendFailed);
      }
    } catch {
      setError(t.networkError);
    }
  }

  return (
    <>
      <div className="auth-chapter-mark">
        <span>{t.chapterMark}</span>
      </div>
      <h1 className="auth-title">{t.title}</h1>
      <p className="auth-sub">
        {t.subtitle}{' '}
        <em>{email}</em>
      </p>

      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(code); }} noValidate>
        {error && (
          <div className="auth-error" role="alert">
            <p className="auth-error-msg">— {error}</p>
          </div>
        )}

        <div className="auth-field">
          <label className="auth-field-label" htmlFor="verify-code">{t.codeLabel}</label>
          <div className="code-grid">
            <input
              id="verify-code"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="one-time-code"
              disabled={loading}
              aria-label={t.codeLabel}
            />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className="code-digit"
                data-empty={!code[i]}
                data-active={code.length === i}
                aria-hidden
              >
                {code[i] || '·'}
              </span>
            ))}
          </div>
        </div>

        <div className="auth-submit-row">
          <button
            type="submit"
            className="btn-stamp"
            disabled={loading || code.length < 6}
          >
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

        <div className="resend-row">
          <span>— {t.noCode}</span>
          <button
            type="button"
            className="resend-btn"
            onClick={handleResend}
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? `${t.resend} (${cooldown}s)` : t.resend}
          </button>
        </div>

        {resendMsg && (
          <p className="auth-success-inline">{resendMsg}</p>
        )}
      </form>

      <button type="button" className="back-link" onClick={onBack}>
        {t.back}
      </button>
    </>
  );
}
