'use client';

/**
 * Inline banner shown when the backend detects a character preset
 * in a user's chat message. Lets the user apply or dismiss it.
 *
 * Renders above the scroll anchor in MessageList — non-intrusive,
 * does not block the chat flow.
 */

import { useState, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { clearDetectedPersona } from '@/store/chatSlice';
import { setCustomPersonaActive } from '@/store/settingsSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { confirmPersona } from '@/lib/api/persona';

const i18n = {
  en: {
    detected: 'Character preset detected',
    apply: 'Apply as companion persona?',
    replace: 'Replace current persona?',
    applyBtn: 'Apply',
    dismissBtn: 'Dismiss',
    applying: 'Applying...',
    success: 'Persona applied!',
    error: 'Failed to apply persona.',
  },
  'zh-CN': {
    detected: '检测到角色预设',
    apply: '是否应用为伴侣人设？',
    replace: '是否替换当前人设？',
    applyBtn: '应用',
    dismissBtn: '忽略',
    applying: '应用中...',
    success: '人设已应用！',
    error: '应用失败，请重试',
  },
} as const;

export default function PersonaDetectedBanner() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const detectedPersona = useAppSelector((s) => s.chat.detectedPersona);
  const language = useAppSelector((s) => s.settings.language);
  const hasExistingPersona = useAppSelector((s) => s.settings.customPersonaActive);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const t = i18n[language as keyof typeof i18n] || i18n.en;

  const handleApply = useCallback(async () => {
    if (!detectedPersona) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await confirmPersona(
        authFetch,
        detectedPersona.core_persona,
        detectedPersona.name || undefined,
        detectedPersona.appearance,
      );
      if (res.success) {
        setResult('success');
        dispatch(setCustomPersonaActive(true));
        // Auto-dismiss after showing success briefly
        setTimeout(() => dispatch(clearDetectedPersona()), 1500);
      } else {
        setResult('error');
      }
    } catch {
      setResult('error');
    } finally {
      setLoading(false);
    }
  }, [detectedPersona, authFetch, dispatch]);

  const handleDismiss = useCallback(() => {
    dispatch(clearDetectedPersona());
  }, [dispatch]);

  if (!detectedPersona) return null;

  const displayName = detectedPersona.name || '?';

  return (
    <div
      style={{
        margin: '8px 0',
        padding: '14px 18px',
        background: 'rgba(255, 255, 255, 0.12)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
        animation: 'fadeInUp 0.4s ease-out',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '1.2rem' }}>🎭</span>
        <span style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '0.92rem', fontWeight: 600 }}>
          {t.detected}：<span style={{ color: '#e8b4b8' }}>{displayName}</span>
        </span>
      </div>

      {/* Description */}
      <p style={{ color: 'rgba(255, 255, 255, 0.65)', fontSize: '0.82rem', margin: '0 0 12px 0' }}>
        {hasExistingPersona ? t.replace : t.apply}
      </p>

      {/* Result message */}
      {result === 'success' && (
        <p style={{ color: '#86efac', fontSize: '0.85rem', margin: '0 0 8px 0' }}>
          ✓ {t.success}
        </p>
      )}
      {result === 'error' && (
        <p style={{ color: '#fca5a5', fontSize: '0.85rem', margin: '0 0 8px 0' }}>
          {t.error}
        </p>
      )}

      {/* Buttons */}
      {result !== 'success' && (
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleApply}
            disabled={loading}
            style={{
              padding: '8px 20px',
              background: '#e8b4b8',
              color: '#5a4a4a',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'all 0.2s',
            }}
          >
            {loading ? t.applying : t.applyBtn}
          </button>
          <button
            onClick={handleDismiss}
            disabled={loading}
            style={{
              padding: '8px 20px',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '8px',
              fontSize: '0.85rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {t.dismissBtn}
          </button>
        </div>
      )}
    </div>
  );
}
