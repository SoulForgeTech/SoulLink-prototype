'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { setCharacterExpressions } from '@/store/settingsSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';

interface ExpressionSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'loading' | 'edit' | 'generating' | 'preview' | 'done' | 'error';

const STYLE_OPTIONS = [
  { value: 'anime', label: '🎨 Anime', desc: 'Japanese animation style' },
  { value: 'realistic', label: '📷 Realistic', desc: 'Photorealistic portrait' },
  { value: '3d', label: '🎮 3D Render', desc: 'Game-like 3D style' },
  { value: 'illustration', label: '✏️ Illustration', desc: 'Digital painting' },
];

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'shy', 'thinking', 'loving'];
const EMOTION_LABELS: Record<string, string> = {
  neutral: '😐 Calm', happy: '😊 Happy', sad: '😢 Sad', angry: '😠 Angry',
  surprised: '😲 Surprised', shy: '😳 Shy', thinking: '🤔 Thinking', loving: '🥰 Loving',
};

export default function ExpressionSetupModal({ isOpen, onClose }: ExpressionSetupModalProps) {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const isGuest = useAppSelector((s) => s.guest.isGuest);

  const [style, setStyle] = useState('anime');
  const [appearance, setAppearance] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [previewEmotion, setPreviewEmotion] = useState('neutral');
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // Load existing appearance when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // Check if there's an ongoing generation (saved in localStorage)
    try {
      const genState = localStorage.getItem('soullink_expression_generating');
      if (genState) {
        const state = JSON.parse(genState);
        const elapsed = Date.now() - state.startedAt;
        if (elapsed < 10 * 60 * 1000) { // within 10 minutes
          setPhase('generating');
          setProgress(state.lastProgress || 'Generation in progress...');
          return;
        } else {
          localStorage.removeItem('soullink_expression_generating');
        }
      }
    } catch { /* ignore */ }

    setPhase('loading');
    setError('');

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

  // Preview: play video when emotion changes
  useEffect(() => {
    if (phase !== 'preview' || !result || !previewVideoRef.current) return;
    const videos = result.idleVideos as Record<string, string> | undefined;
    const url = videos?.[previewEmotion] || (result.videos as Record<string, string>)?.[previewEmotion];
    if (url && previewVideoRef.current) {
      previewVideoRef.current.src = url;
      previewVideoRef.current.loop = true;
      previewVideoRef.current.load();
      previewVideoRef.current.play().catch(() => {});
    }
  }, [phase, result, previewEmotion]);

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
    setProgress('Starting...');
    setError('');

    // Save generating state to localStorage
    localStorage.setItem('soullink_expression_generating', JSON.stringify({
      startedAt: Date.now(), style, appearance: appearance.trim(),
      lastProgress: 'Starting...',
    }));

    try {
      const response = await authFetch('/api/characters/generate-expressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style, appearance: appearance.trim(),
          generate_chibi: false, generate_full: true,
        }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let genResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status) {
              setProgress(data.status);
              // Update localStorage with latest progress
              try {
                const gs = JSON.parse(localStorage.getItem('soullink_expression_generating') || '{}');
                gs.lastProgress = data.status;
                localStorage.setItem('soullink_expression_generating', JSON.stringify(gs));
              } catch { /* ignore */ }
            }
            if (data.phase === 'done' && data.result) genResult = data.result;
            if (data.phase === 'error') throw new Error(data.error || 'Generation failed');
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      localStorage.removeItem('soullink_expression_generating');

      if (genResult) {
        setResult(genResult);
        setPhase('preview');
      } else {
        throw new Error('No result received');
      }
    } catch (err) {
      localStorage.removeItem('soullink_expression_generating');
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [authFetch, style, appearance, isGuest]);

  const handleApply = useCallback(() => {
    if (result) {
      dispatch(setCharacterExpressions(result as never));
      setPhase('done');
    }
  }, [result, dispatch]);

  if (!isOpen) return null;

  // Don't allow closing during generation
  const canClose = phase !== 'generating';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
    }} onClick={canClose ? onClose : undefined}>
      <div style={{
        background: 'rgba(25,25,40,0.95)', borderRadius: 20, padding: 24,
        maxWidth: 420, width: '90%', border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)', maxHeight: '85vh', overflowY: 'auto',
      }} onClick={(e) => e.stopPropagation()}>

        {/* Loading */}
        {phase === 'loading' && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', margin: '0 auto',
              border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#7c4dff',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        )}

        {/* Edit: appearance + style */}
        {phase === 'edit' && (
          <>
            <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 4, textAlign: 'center' }}>
              ✨ Create Character Animation
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
              Generate animated expressions for your companion
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Character Appearance
              </label>
              <textarea
                value={appearance}
                onChange={(e) => setAppearance(e.target.value)}
                placeholder="Describe your character's appearance..."
                rows={4}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13,
                  resize: 'vertical', fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                }}
              />
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 4 }}>
                Tip: Include hair color, eye color, outfit, and style for best results
              </p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Art Style
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {STYLE_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setStyle(opt.value)} style={{
                    padding: '10px 12px', borderRadius: 12, border: 'none',
                    background: style === opt.value ? 'rgba(124,77,255,0.3)' : 'rgba(255,255,255,0.05)',
                    color: '#fff', cursor: 'pointer', textAlign: 'left',
                    outline: style === opt.value ? '2px solid rgba(124,77,255,0.6)' : 'none',
                  }}>
                    <div style={{ fontSize: 14 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {error && <p style={{ color: '#ff5252', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{error}</p>}

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

        {/* Generating — cannot close */}
        {phase === 'generating' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px',
              border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#7c4dff',
              animation: 'spin 0.8s linear infinite',
            }} />
            <p style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>Generating Expressions...</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 4 }}>{progress}</p>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 16 }}>
              Please wait, do not close this window.
            </p>
          </div>
        )}

        {/* Preview — show all emotions */}
        {phase === 'preview' && result && (
          <>
            <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 12, textAlign: 'center' }}>
              🎉 Preview Expressions
            </h3>

            {/* Video preview */}
            <div style={{
              width: 160, height: 160, margin: '0 auto 16px',
              borderRadius: 16, overflow: 'hidden',
              background: 'rgba(255,255,255,0.05)',
              border: '2px solid rgba(124,77,255,0.3)',
            }}>
              <video
                ref={previewVideoRef}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                muted playsInline
              />
            </div>

            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              {EMOTION_LABELS[previewEmotion] || previewEmotion}
            </p>

            {/* Emotion grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 20,
            }}>
              {EMOTIONS.map((emo) => (
                <button key={emo} onClick={() => setPreviewEmotion(emo)} style={{
                  padding: '8px 4px', borderRadius: 10, border: 'none',
                  background: previewEmotion === emo ? 'rgba(124,77,255,0.3)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', cursor: 'pointer', fontSize: 11, textAlign: 'center',
                  outline: previewEmotion === emo ? '2px solid rgba(124,77,255,0.5)' : 'none',
                }}>
                  {EMOTION_LABELS[emo]?.split(' ')[0] || '😐'}
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                    {emo}
                  </div>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPhase('edit')} style={{
                flex: 1, padding: '12px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.15)', background: 'none',
                color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer',
              }}>
                Redo
              </button>
              <button onClick={handleApply} style={{
                flex: 2, padding: '12px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #7c4dff, #448aff)',
                color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
                Use These Expressions
              </button>
            </div>
          </>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <p style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>Expressions Active!</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>
              Your character will now react with emotions while chatting
            </p>
            <button onClick={onClose} style={{
              padding: '12px 32px', borderRadius: 12, border: 'none',
              background: '#7c4dff', color: '#fff', fontSize: 14, cursor: 'pointer',
            }}>
              Start Chatting
            </button>
          </div>
        )}

        {/* Error */}
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
