'use client';

/**
 * ResetPasswordForm — enter 6-digit code + new password to reset.
 *
 * Combines VerifyForm (code input with resend cooldown) and RegisterForm
 * (password + confirm). On success, returns AuthResponse for auto-login.
 *
 * `noPassword=true` branch is used when a Google-OAuth account has no
 * password yet and the user wants to set one — verify email + assign
 * the first password in a single flow.
 */

import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { resetPassword, forgotPassword } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface ResetPasswordFormProps {
  email: string;
  onSuccess: (data: AuthResponse) => void;
  onBack: () => void;
  lang?: 'en' | 'zh';
  noPassword?: boolean;
}

const i18n = {
  en: {
    chapterMark: 'CHAPTER · REWRITING',
    title: 'Rewrite the page.',
    subtitle: 'Use the code we just sent to',
    noPassChapterMark: 'CHAPTER · NEW PASSWORD',
    noPassTitle: 'Set a password.',
    noPassSubtitle: 'Your Google account has no password yet. Verify your email to set one for',
    codeLabel: 'Verification Code',
    newPassword: 'New Password', newPasswordPh: 'At least 6 characters',
    confirmPassword: 'Confirm Password', confirmPh: 'Re-enter your password',
    submit: 'Save the new key', submitting: 'Saving...',
    submitSetNew: 'Save password', submittingSetNew: 'Saving...',
    stampMain: 'REWRITE',
    stampMainNoPass: 'NEW KEY',
    enterCode: 'Please enter the 6-digit code.',
    enterPassword: 'Please enter a new password.',
    passMin: 'Password must be at least 6 characters.',
    passMatch: 'Passwords do not match.',
    resetFailed: 'Password reset failed.',
    networkError: 'Network error. Please try again.',
    noCode: "Didn't receive it?",
    resend: 'send another',
    codeSent: 'New code sent! Check your inbox.',
    resendFailed: 'Failed to resend code.',
    back: '← back to sign in',
  },
  zh: {
    chapterMark: '章节 · 重写',
    title: '重写这一页。',
    subtitle: '请使用刚刚发送到这个邮箱的验证码：',
    noPassChapterMark: '章节 · 新密码',
    noPassTitle: '设置一个密码。',
    noPassSubtitle: '你的 Google 账号尚未设置密码。验证邮箱后即可为这个账号设置密码：',
    codeLabel: '验证码',
    newPassword: '新密码', newPasswordPh: '至少6位字符',
    confirmPassword: '确认密码', confirmPh: '再次输入密码',
    submit: '保存新钥匙', submitting: '保存中...',
    submitSetNew: '保存密码', submittingSetNew: '保存中...',
    stampMain: '重写',
    stampMainNoPass: '新钥匙',
    enterCode: '请输入6位验证码',
    enterPassword: '请输入新密码',
    passMin: '密码至少需要6个字符',
    passMatch: '两次输入的密码不一致',
    resetFailed: '密码重置失败',
    networkError: '网络错误，请重试',
    noCode: '没有收到?',
    resend: '再发一次',
    codeSent: '新验证码已发送，请查看邮箱',
    resendFailed: '重新发送失败',
    back: '← 返回登录',
  },
};

export default function ResetPasswordForm({ email, onSuccess, onBack, lang = 'en', noPassword = false }: ResetPasswordFormProps) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [resendMsg, setResendMsg] = useState('');
  const codeInputRef = useRef<HTMLInputElement>(null);
  const t = i18n[lang];

  // Focus code input on mount
  useEffect(() => {
    codeInputRef.current?.focus();
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((p) => p - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      setError('');

      if (code.length !== 6) { setError(t.enterCode); return; }
      if (!password) { setError(t.enterPassword); return; }
      if (password.length < 6) { setError(t.passMin); return; }
      if (password !== confirmPassword) { setError(t.passMatch); return; }

      setLoading(true);
      try {
        const data = await resetPassword(email, code, password);

        if (!data.success) {
          setError(data.error || t.resetFailed);
          if (data.error?.toLowerCase().includes('code')) {
            setCode('');
            codeInputRef.current?.focus();
          }
          return;
        }

        onSuccess(data);
      } catch {
        setError(t.networkError);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email, code, password, confirmPassword, onSuccess, t],
  );

  function handleCodeChange(value: string) {
    setCode(value.replace(/\D/g, '').slice(0, 6));
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setResendMsg('');
    setError('');

    try {
      const data = await forgotPassword(email);
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

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  const canSubmit = code.length === 6 && !loading;

  return (
    <>
      <div className="auth-chapter-mark">
        <span>{noPassword ? t.noPassChapterMark : t.chapterMark}</span>
      </div>
      <h1 className="auth-title">{noPassword ? t.noPassTitle : t.title}</h1>
      <p className="auth-sub">
        {noPassword ? t.noPassSubtitle : t.subtitle}{' '}
        <em>{email}</em>
      </p>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && (
          <div className="auth-error" role="alert">
            <p className="auth-error-msg">— {error}</p>
          </div>
        )}

        <div className="auth-field">
          <label className="auth-field-label" htmlFor="reset-code">{t.codeLabel}</label>
          <div className="code-grid">
            <input
              id="reset-code"
              ref={codeInputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
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

        <div className="auth-field">
          <label className="auth-field-label" htmlFor="reset-password">{t.newPassword}</label>
          <input
            id="reset-password"
            type="password"
            className="auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.newPasswordPh}
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <div className="auth-field">
          <label className="auth-field-label" htmlFor="reset-confirm">{t.confirmPassword}</label>
          <input
            id="reset-confirm"
            type="password"
            className="auth-input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.confirmPh}
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <div className="auth-submit-row">
          <button type="submit" className="btn-stamp" disabled={!canSubmit}>
            {loading ? (
              <>
                <span className="btn-spinner" aria-hidden />
                <span>{noPassword ? t.submittingSetNew : t.submitting}</span>
              </>
            ) : (
              <>
                <span>{noPassword ? t.submitSetNew : t.submit}</span>
                <span className="arrow" aria-hidden>→</span>
              </>
            )}
          </button>

          <div className="wax-stamp" aria-hidden>
            <span>{noPassword ? t.stampMainNoPass : t.stampMain}</span>
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
