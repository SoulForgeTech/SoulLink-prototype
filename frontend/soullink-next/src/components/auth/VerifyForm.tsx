'use client';

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { verifyEmail, resendCode } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface VerifyFormProps {
  email: string;
  onSuccess: (data: AuthResponse) => void;
  onBack: () => void;
}

export default function VerifyForm({ email, onSuccess, onBack }: VerifyFormProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendMsg, setResendMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
          setError(data.error || 'Invalid verification code.');
          setCode('');
          inputRef.current?.focus();
          return;
        }

        onSuccess(data);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [email, onSuccess],
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
        setResendMsg('Code sent! Check your email.');
        setCooldown(60);
      } else {
        setError(data.error || 'Failed to resend code.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  /* ---- Styles matching original CSS exactly ---- */
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
    // .verify-code-input overrides
    textAlign: 'center',
    letterSpacing: '10px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 700,
  };

  return (
    <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
      {/* .verification-header */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        {/* .verification-icon */}
        <div style={{ fontSize: '48px', marginBottom: '8px' }}>✉</div>
        {/* h3 */}
        <h3 style={{ color: 'white', fontSize: '1.3rem', margin: '0 0 8px 0' }}>
          Check your email
        </h3>
        {/* .verification-subtitle */}
        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.88rem', margin: 0 }}>
          We sent a 6-digit code to
        </p>
        {/* .verification-email */}
        <p style={{ color: '#e8b4b8', fontWeight: 600, fontSize: '0.95rem', margin: '4px 0 0 0' }}>
          {email}
        </p>
      </div>

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
          }}
        >
          {error}
        </div>
      )}

      {/* Code input — single input with letter-spacing, matching original */}
      <div style={{ marginBottom: '16px', textAlign: 'left' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.8)' }}>
          Verification Code
        </label>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
          }}
          placeholder="000000"
          autoComplete="one-time-code"
          disabled={loading}
          style={{
            ...inputStyle,
            opacity: loading ? 0.5 : 1,
          }}
        />
      </div>

      {/* .auth-submit-btn */}
      <button
        onClick={() => handleSubmit(code)}
        disabled={loading || code.length < 6}
        style={{
          width: '100%',
          padding: '14px',
          background: '#e8b4b8',
          color: '#5a4a4a',
          border: 'none',
          borderRadius: '10px',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: (loading || code.length < 6) ? 'not-allowed' : 'pointer',
          transition: 'all 0.3s',
          marginTop: '8px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          opacity: (loading || code.length < 6) ? 0.6 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
        onMouseEnter={(e) => {
          if (!loading && code.length === 6) {
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
            Verifying...
          </>
        ) : (
          'Verify'
        )}
      </button>

      {/* .verification-actions */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        {/* Resend text */}
        <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.85rem', margin: '0 0 8px 0' }}>
          {"Didn't receive the code? "}
          <button
            onClick={handleResend}
            disabled={cooldown > 0}
            style={{
              background: 'none',
              border: 'none',
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

        {/* Resend success */}
        {resendMsg && (
          <p style={{ color: '#86efac', fontSize: '0.85rem', margin: '0 0 8px 0' }}>
            {resendMsg}
          </p>
        )}

        {/* Back link */}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.45)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            padding: 0,
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)'; }}
        >
          &larr; Back to registration
        </button>
      </div>
    </div>
  );
}
