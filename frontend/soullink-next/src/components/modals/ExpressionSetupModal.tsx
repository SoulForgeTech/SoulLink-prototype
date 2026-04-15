'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { setCharacterExpressions } from '@/store/settingsSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';

interface ExpressionSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'loading' | 'edit' | 'generating' | 'done' | 'error';

const STYLE_OPTIONS = [
  { value: 'anime', label: '🎨 Anime', desc: 'Japanese animation style' },
  { value: 'realistic', label: '📷 Realistic', desc: 'Photorealistic portrait' },
  { value: '3d', label: '🎮 3D Render', desc: 'Game-like 3D style' },
  { value: 'illustration', label: '✏️ Illustration', desc: 'Digital painting' },
];

export default function ExpressionSetupModal({ isOpen, onClose }: ExpressionSetupModalProps) {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const isGuest = useAppSelector((s) => s.guest.isGuest);

  const [style, setStyle] = useState('anime');
  const [appearance, setAppearance] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  // Fetch existing appearance when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPhase('loading');
    setError('');

    // Try to load appearance from localStorage user settings
    try {
      const raw = localStorage.getItem('soullink_user');
      if (raw) {
        const user = JSON.parse(raw);
        const saved = user?.settings?.image_appearance;
        if (saved) {
          setAppearance(saved);
          setPhase('edit');
          return;
        }
      }
    } catch { /* ignore */ }

    // If no saved appearance, try fetching from backend
    if (!isGuest) {
      authFetch('/api/user/custom-status')
        .then((r) => r.json())
        .then((data) => {
          const desc = data?.appearance || data?.persona?.appearance || '';
          setAppearance(desc || 'Anime character, upper body portrait');
          setPhase('edit');
        })
        .catch(() => {
          setAppearance('Anime character, upper body portrait');
          setPhase('edit');
        });
    } else {
      setAppearance('Anime character, upper body portrait');
      setPhase('edit');
    }
  }, [isOpen, authFetch, isGuest]);

  const handleGenerate = useCallback(async () => {
    if (isGuest) {
      setError('Sign up to create character expressions');
      setPhase('error');
      return;
    }

    if (!appearance.trim()) {
      setError('Please describe your character\'s appearance');
      return;
    }

    setPhase('generating');
    setProgress('Starting expression generation...');
    setError('');

    try {
      const response = await authFetch('/api/characters/generate-expressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style,
          appearance: appearance.trim(),
          generate_chibi: false,
          generate_full: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let result = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status) setProgress(data.status);
            if (data.phase === 'done' && data.result) {
              result = data.result;
            }
            if (data.phase === 'error') {
              throw new Error(data.error || 'Generation failed');
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (result) {
        dispatch(setCharacterExpressions(result));
        setPhase('done');
        setProgress('Expression set created!');
      } else {
        throw new Error('No result received');
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [authFetch, dispatch, style, appearance, isGuest]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
    }} onClick={onClose}>
      <div style={{
        background: 'rgba(25,25,40,0.95)', borderRadius: 20, padding: 24,
        maxWidth: 420, width: '90%', border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)', maxHeight: '85vh', overflowY: 'auto',
      }} onClick={(e) => e.stopPropagation()}>

        {phase === 'loading' && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', margin: '0 auto',
              border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#7c4dff',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        )}

        {phase === 'edit' && (
          <>
            <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 4, textAlign: 'center' }}>
              ✨ Create Character Animation
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
              Generate animated expressions for your companion
            </p>

            {/* Appearance description — editable */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Character Appearance
              </label>
              <textarea
                value={appearance}
                onChange={(e) => setAppearance(e.target.value)}
                placeholder="Describe your character's appearance: hair color, eye color, outfit, style..."
                rows={4}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13,
                  resize: 'vertical', fontFamily: 'inherit', outline: 'none',
                  lineHeight: 1.5,
                }}
              />
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 4 }}>
                Tip: Include hair color, eye color, outfit, and style for best results
              </p>
            </div>

            {/* Style selection */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Art Style
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setStyle(opt.value)}
                    style={{
                      padding: '10px 12px', borderRadius: 12, border: 'none',
                      background: style === opt.value ? 'rgba(124,77,255,0.3)' : 'rgba(255,255,255,0.05)',
                      color: '#fff', cursor: 'pointer', textAlign: 'left',
                      outline: style === opt.value ? '2px solid rgba(124,77,255,0.6)' : 'none',
                    }}
                  >
                    <div style={{ fontSize: 14 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p style={{ color: '#ff5252', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{error}</p>
            )}

            <button onClick={handleGenerate} style={{
              width: '100%', padding: '14px', borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, #7c4dff, #448aff)',
              color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>
              Generate Expressions
            </button>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
              Takes ~5 minutes · 8 emotions + idle animations
            </p>
          </>
        )}

        {phase === 'generating' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', margin: '0 auto 16px',
              border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#7c4dff',
              animation: 'spin 0.8s linear infinite',
            }} />
            <p style={{ color: '#fff', fontSize: 15, marginBottom: 8 }}>Generating...</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{progress}</p>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 16 }}>
              This takes a few minutes. You can keep chatting!
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <p style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>Expressions Ready!</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>
              Your character will now show emotions while chatting
            </p>
            <button onClick={onClose} style={{
              padding: '12px 32px', borderRadius: 12, border: 'none',
              background: '#7c4dff', color: '#fff', fontSize: 14, cursor: 'pointer',
            }}>
              Start Chatting
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>😵</div>
            <p style={{ color: '#ff5252', fontSize: 15, marginBottom: 8 }}>{error}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setPhase('edit')} style={{
                padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                background: 'none', color: '#fff', fontSize: 13, cursor: 'pointer',
              }}>
                Try Again
              </button>
              <button onClick={onClose} style={{
                padding: '10px 20px', borderRadius: 12, border: 'none',
                background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
              }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
