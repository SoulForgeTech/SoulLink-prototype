'use client';

/**
 * ResetPasswordForm — enter 6-digit code + new password to reset.
 *
 * Combines VerifyForm (code input with resend cooldown) and RegisterForm
 * (password + confirm). On success, returns AuthResponse for auto-login.
 */

import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { resetPassword, forgotPassword } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface ResetPasswordFormProps {
  email: string;
  onSuccess: (data: AuthResponse) => void;
  onBack: () => void;
}

export default function ResetPasswordForm({ email, onSuccess, onBack }: ResetPasswordFormProps) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [resendMsg, setResendMsg] = useState('');
  const codeInputRef = useRef<HTMLInputElement>(null);

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

      if (code.length !== 6) { setError('Please enter the 6-digit code.'); return; }
      if (!password) { setError('Please enter a new password.'); return; }
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
      if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

      setLoading(true);
      try {
        const data = await resetPassword(email, code, password);

        if (!data.success) {
          setError(data.error || 'Password reset failed.');
          if (data.error?.toLowerCase().includes('code')) {
            setCode('');
            codeInputRef.current?.focus();
          }
          return;
        }

        onSuccess(data);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [email, code, password, confirmPassword, onSuccess],
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
        setResendMsg('New code sent! Check your email.');
        setCooldown(60);
      } else {
        setError(data.error || 'Failed to resend code.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  /* ---- Shared styles ---- */
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
  const codeInputStyle: React.CSSProperties = {
    ...inputStyle,
    textAlign: 'center', letterSpacing: '10px',
    fontFamily: "'Courier New', monospace", fontWeight: 700,
  };

  function handleInputFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
  }
  function handleInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
  }

  const canSubmit = code.length === 6 && !loading;

  return (
    <div>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ fontSize: '48px', marginBottom: '8px' }}>✉️</div>
        <h3 style={{ color: 'white', fontSize: '1.3rem', margin: '0 0 8px 0' }}>
          Enter reset code
        </h3>
        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.88rem', margin: 0 }}>
          We sent a 6-digit code to
        </p>
        <p style={{ color: '#e8b4b8', fontWeight: 600, fontSize: '0.95rem', margin: '4px 0 0 0' }}>
          {email}
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
        {/* Code input */}
        <div style={formGroupStyle}>
          <label style={labelStyle}>Reset Code</label>
          <input
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            placeholder="000000"
            autoComplete="one-time-code"
            disabled={loading}
            style={codeInputStyle}
          />
        </div>

        {/* New password */}
        <div style={formGroupStyle}>
          <label style={labelStyle}>New Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            disabled={loading}
            className="auth-input"
            style={inputStyle}
          />
        </div>

        {/* Confirm password */}
        <div style={formGroupStyle}>
          <label style={labelStyle}>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            placeholder="Re-enter your password"
            autoComplete="new-password"
            disabled={loading}
            className="auth-input"
            style={inputStyle}
          />
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            width: '100%', padding: '14px', background: '#e8b4b8',
            color: '#5a4a4a', border: 'none', borderRadius: '10px',
            fontSize: '1rem', fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'all 0.3s', marginTop: '8px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            opacity: canSubmit ? 1 : 0.6,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}
          onMouseEnter={(e) => {
            if (canSubmit) {
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
              Resetting...
            </>
          ) : (
            'Reset Password'
          )}
        </button>
      </form>

      {/* Resend + Back */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.85rem', margin: '0 0 8px 0' }}>
          {"Didn't receive the code? "}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0}
            style={{
              background: 'none', border: 'none',
              color: cooldown > 0 ? 'rgba(255, 255, 255, 0.3)' : '#e8b4b8',
              cursor: cooldown > 0 ? 'default' : 'pointer',
              fontSize: '0.85rem',
              textDecoration: cooldown > 0 ? 'none' : 'underline',
              padding: 0,
            }}
          >
            {cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend'}
          </button>
        </p>

        {resendMsg && (
          <p style={{ color: '#86efac', fontSize: '0.85rem', margin: '0 0 8px 0' }}>
            {resendMsg}
          </p>
        )}

        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: 'rgba(255, 255, 255, 0.45)', cursor: 'pointer',
            fontSize: '0.85rem', padding: 0, transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)'; }}
        >
          &larr; Back to sign in
        </button>
      </div>
    </div>
  );
}
