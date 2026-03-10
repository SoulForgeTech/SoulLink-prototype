'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { login } from '@/lib/api/auth';
import type { AuthResponse } from '@/types';

interface LoginFormProps {
  onSuccess: (data: AuthResponse) => void;
  onNeedVerification: (email: string) => void;
}

export default function LoginForm({ onSuccess, onNeedVerification }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
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
        setError(data.error || 'Login failed. Please try again.');
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

      {/* Email .form-group */}
      <div style={formGroupStyle}>
        <label style={labelStyle}>Email</label>
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
        <label style={labelStyle}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder="Enter your password"
          autoComplete="current-password"
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
            Signing in...
          </>
        ) : (
          'Sign In'
        )}
      </button>
    </form>
  );
}
