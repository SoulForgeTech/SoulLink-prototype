'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { register } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface RegisterFormProps {
  onSuccess: (data: AuthResponse) => void;
  onNeedVerification: (email: string) => void;
  lang?: 'en' | 'zh';
}

const i18n = {
  en: {
    nicknameLabel: 'What should your companion call you?',
    nicknamePh: 'Your nickname',
    nicknameHint: 'This is how your AI companion will address you',
    email: 'Email', emailPh: 'your@email.com',
    password: 'Password', passwordPh: 'At least 6 characters',
    confirmPassword: 'Confirm Password', confirmPh: 'Re-enter your password',
    submit: 'Begin',
    submitting: 'Beginning...',
    stampMain: 'vol.01',
    stampSub: 'new reader',
    fillAll: 'Please fill in all fields.',
    nickMin: 'Nickname must be at least 2 characters.',
    passMin: 'Password must be at least 6 characters.',
    passMatch: 'Passwords do not match.',
    regFailed: 'Registration failed. Please try again.',
    networkError: 'Network error. Please check your connection.',
  },
  zh: {
    nicknameLabel: '你希望 AI 伴侣怎么称呼你？',
    nicknamePh: '你的昵称',
    nicknameHint: 'AI 伴侣会用这个名字称呼你',
    email: '邮箱', emailPh: '请输入邮箱',
    password: '密码', passwordPh: '至少6位字符',
    confirmPassword: '确认密码', confirmPh: '再次输入密码',
    submit: '开始',
    submitting: '开始中...',
    stampMain: '第一卷',
    stampSub: '新读者',
    fillAll: '请填写所有字段',
    nickMin: '昵称至少需要2个字符',
    passMin: '密码至少需要6个字符',
    passMatch: '两次输入的密码不一致',
    regFailed: '注册失败，请重试',
    networkError: '网络错误，请检查网络连接',
  },
};

export default function RegisterForm({ onSuccess, onNeedVerification, lang = 'en' }: RegisterFormProps) {
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const t = i18n[lang];

  function validate(): string | null {
    if (!nickname.trim() || !email.trim() || !password || !confirmPassword) {
      return t.fillAll;
    }
    if (nickname.trim().length < 2) {
      return t.nickMin;
    }
    if (password.length < 6) {
      return t.passMin;
    }
    if (password !== confirmPassword) {
      return t.passMatch;
    }
    return null;
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const data = await register(email.trim(), password, nickname.trim());

      if (data.requires_verification) {
        onNeedVerification(data.email || email.trim());
        return;
      }

      if (!data.success) {
        setError(data.error || t.regFailed);
        return;
      }

      onSuccess(data);
    } catch {
      setError(t.networkError);
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
          <p className="auth-error-msg">— {error}</p>
        </div>
      )}

      <div className="auth-field">
        <label className="auth-field-label" htmlFor="register-nickname">
          {t.nicknameLabel} <span className="auth-required" aria-hidden>*</span>
        </label>
        <input
          id="register-nickname"
          type="text"
          className="auth-input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.nicknamePh}
          autoComplete="name"
          disabled={loading}
        />
        <p className="auth-field-hint">{t.nicknameHint}</p>
      </div>

      <div className="auth-field">
        <label className="auth-field-label" htmlFor="register-email">
          {t.email} <span className="auth-required" aria-hidden>*</span>
        </label>
        <input
          id="register-email"
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
        <label className="auth-field-label" htmlFor="register-password">
          {t.password} <span className="auth-required" aria-hidden>*</span>
        </label>
        <input
          id="register-password"
          type="password"
          className="auth-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.passwordPh}
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      <div className="auth-field">
        <label className="auth-field-label" htmlFor="register-confirm">
          {t.confirmPassword} <span className="auth-required" aria-hidden>*</span>
        </label>
        <input
          id="register-confirm"
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
          <span className="stamp-sub">{t.stampSub}</span>
        </div>
      </div>
    </form>
  );
}
