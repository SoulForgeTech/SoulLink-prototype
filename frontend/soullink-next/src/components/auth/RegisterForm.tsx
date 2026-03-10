'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { register } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface RegisterFormProps {
  onSuccess: (data: AuthResponse) => void;
  onNeedVerification: (email: string) => void;
}

export default function RegisterForm({ onSuccess, onNeedVerification }: RegisterFormProps) {
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function validate(): string | null {
    if (!nickname.trim() || !email.trim() || !password || !confirmPassword) {
      return 'Please fill in all fields.';
    }
    if (nickname.trim().length < 2) {
      return 'Nickname must be at least 2 characters.';
    }
    if (password.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match.';
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
        setError(data.error || 'Registration failed. Please try again.');
        return;
      }

      onSuccess(data);
    } catch {
      setError('Network error. Please check your connection.');
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
          }}
        >
          {error}
        </div>
      )}

      {/* Nickname .form-group */}
      <div style={formGroupStyle}>
        <label style={labelStyle}>
          What should your companion call you? <span style={{ color: '#f87171' }}>*</span>
        </label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder="Your nickname"
          autoComplete="name"
          disabled={loading}
          className="auth-input"
          style={inputStyle}
        />
        <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
          This is how your AI companion will address you
        </div>
      </div>

      {/* Email .form-group */}
      <div style={formGroupStyle}>
        <label style={labelStyle}>
          Email <span style={{ color: '#f87171' }}>*</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder="your@email.com"
          autoComplete="email"
          disabled={loading}
          className="auth-input"
          style={inputStyle}
        />
      </div>

      {/* Password .form-group */}
      <div style={formGroupStyle}>
        <label style={labelStyle}>
          Password <span style={{ color: '#f87171' }}>*</span>
        </label>
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

      {/* Confirm Password .form-group */}
      <div style={formGroupStyle}>
        <label style={labelStyle}>
          Confirm Password <span style={{ color: '#f87171' }}>*</span>
        </label>
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
            Creating account...
          </>
        ) : (
          'Create Account'
        )}
      </button>
    </form>
  );
}
