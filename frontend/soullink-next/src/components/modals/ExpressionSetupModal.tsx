'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { setCharacterExpressions } from '@/store/settingsSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useT } from '@/hooks/useT';

interface ExpressionSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'loading' | 'edit' | 'generating' | 'preview' | 'done' | 'error';

const GEN_STATE_KEY = 'soullink_expr_gen_state';
const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'shy', 'thinking', 'loving'];

export default function ExpressionSetupModal({ isOpen, onClose }: ExpressionSetupModalProps) {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const t = useT();
  const isGuest = useAppSelector((s) => s.guest.isGuest);

  const [style, setStyle] = useState('anime');
  const [appearance, setAppearance] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [previewEmotion, setPreviewEmotion] = useState('neutral');
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // On open: check for saved generation state or load appearance
  useEffect(() => {
    if (!isOpen) return;

    // Check for completed result waiting for preview
    try {
      const saved = localStorage.getItem(GEN_STATE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.phase === 'preview' && state.result) {
          setResult(state.result);
          setPhase('preview');
          return;
        }
        if (state.phase === 'generating') {
          const elapsed = Date.now() - (state.startedAt || 0);
          if (elapsed < 15 * 60 * 1000) {
            setPhase('generating');
            setProgress(state.lastProgress || t('expr.generating'));
            return;
          }
          localStorage.removeItem(GEN_STATE_KEY);
        }
      }
    } catch { /* ignore */ }

    // Load appearance
    setPhase('loading');
    try {
      const raw = localStorage.getItem('soullink_user');
      if (raw) {
        const user = JSON.parse(raw);
        const saved = user?.settings?.image_appearance;
        if (saved) { setAppearance(saved); setPhase('edit'); return; }
      }
    } catch { /* ignore */ }

    if (!isGuest) {
      authFetch('/api/user/custom-status')
        .then((r) => r.json())
        .then((data) => {
          setAppearance(data?.appearance || data?.persona?.appearance || '');
          setPhase('edit');
        })
        .catch(() => { setAppearance(''); setPhase('edit'); });
    } else {
      setAppearance('');
      setPhase('edit');
    }
  }, [isOpen, authFetch, isGuest, t]);

  // Preview video playback
  useEffect(() => {
    if (phase !== 'preview' || !result || !previewVideoRef.current) return;
    const idle = result.idleVideos as Record<string, string> | undefined;
    const vids = result.videos as Record<string, string> | undefined;
    const url = idle?.[previewEmotion] || vids?.[previewEmotion];
    if (url) {
      previewVideoRef.current.src = url;
      previewVideoRef.current.loop = true;
      previewVideoRef.current.load();
      previewVideoRef.current.play().catch(() => {});
    }
  }, [phase, result, previewEmotion]);

  const handleGenerate = useCallback(async () => {
    if (isGuest) { setError(t('expr.guest_error')); setPhase('error'); return; }
    if (!appearance.trim()) { setError(t('expr.no_appearance')); return; }

    setPhase('generating');
    setProgress(t('expr.generating'));
    setError('');

    // Save state so user can close and come back
    localStorage.setItem(GEN_STATE_KEY, JSON.stringify({
      phase: 'generating', startedAt: Date.now(),
      lastProgress: t('expr.generating'), style, appearance: appearance.trim(),
    }));

    const abort = new AbortController();
    fetchAbortRef.current = abort;

    try {
      const response = await authFetch('/api/characters/generate-expressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style, appearance: appearance.trim(), generate_chibi: false, generate_full: true }),
        signal: abort.signal,
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let genResult = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status) {
              setProgress(data.status);
              const gs = JSON.parse(localStorage.getItem(GEN_STATE_KEY) || '{}');
              gs.lastProgress = data.status;
              localStorage.setItem(GEN_STATE_KEY, JSON.stringify(gs));
            }
            if (data.phase === 'done' && data.result) genResult = data.result;
            if (data.phase === 'error') throw new Error(data.error || 'Failed');
          } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }

      if (genResult) {
        setResult(genResult);
        setPhase('preview');
        localStorage.setItem(GEN_STATE_KEY, JSON.stringify({ phase: 'preview', result: genResult }));
      } else { throw new Error('No result'); }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // modal closed, fetch continues in bg
      localStorage.removeItem(GEN_STATE_KEY);
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [authFetch, style, appearance, isGuest, t]);

  const handleApply = useCallback(() => {
    if (result) {
      dispatch(setCharacterExpressions(result as never));
      localStorage.removeItem(GEN_STATE_KEY);
      setPhase('done');
    }
  }, [result, dispatch]);

  if (!isOpen) return null;

  const styleOptions = [
    { value: 'anime', icon: '🎨', label: t('expr.style.anime'), desc: t('expr.style.anime_desc') },
    { value: 'realistic', icon: '📷', label: t('expr.style.realistic'), desc: t('expr.style.realistic_desc') },
    { value: '3d', icon: '🎮', label: t('expr.style.3d'), desc: t('expr.style.3d_desc') },
    { value: 'illustration', icon: '✏️', label: t('expr.style.illustration'), desc: t('expr.style.illustration_desc') },
  ];

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
            <div style={{ width: 32, height: 32, borderRadius: '50%', margin: '0 auto',
              border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#7c4dff',
              animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        {phase === 'edit' && (<>
          <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 4, textAlign: 'center' }}>{t('expr.title')}</h3>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>{t('expr.subtitle')}</p>

          <div style={{ marginBottom: 16 }}>
            <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, display: 'block', marginBottom: 6 }}>{t('expr.appearance_label')}</label>
            <textarea value={appearance} onChange={(e) => setAppearance(e.target.value)}
              placeholder={t('expr.appearance_placeholder')} rows={4}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13, resize: 'vertical',
                fontFamily: 'inherit', outline: 'none', lineHeight: 1.5 }} />
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 4 }}>{t('expr.appearance_tip')}</p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, display: 'block', marginBottom: 6 }}>{t('expr.style_label')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {styleOptions.map((opt) => (
                <button key={opt.value} onClick={() => setStyle(opt.value)} style={{
                  padding: '10px 12px', borderRadius: 12, border: 'none',
                  background: style === opt.value ? 'rgba(124,77,255,0.3)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', cursor: 'pointer', textAlign: 'left',
                  outline: style === opt.value ? '2px solid rgba(124,77,255,0.6)' : 'none',
                }}>
                  <div style={{ fontSize: 14 }}>{opt.icon} {opt.label}</div>
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
          }}>{t('expr.generate_btn')}</button>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'center', marginTop: 8 }}>{t('expr.generate_time')}</p>
        </>)}

        {phase === 'generating' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px',
              border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#7c4dff',
              animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>{t('expr.generating')}</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{progress}</p>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 16 }}>{t('expr.generating_wait')}</p>
          </div>
        )}

        {phase === 'preview' && result && (<>
          <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 12, textAlign: 'center' }}>{t('expr.preview_title')}</h3>
          <div style={{ width: 160, height: 160, margin: '0 auto 16px', borderRadius: 16, overflow: 'hidden',
            background: 'rgba(255,255,255,0.05)', border: '2px solid rgba(124,77,255,0.3)' }}>
            <video ref={previewVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
            {t(`expr.emotion.${previewEmotion}`)}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 20 }}>
            {EMOTIONS.map((emo) => (
              <button key={emo} onClick={() => setPreviewEmotion(emo)} style={{
                padding: '8px 4px', borderRadius: 10, border: 'none',
                background: previewEmotion === emo ? 'rgba(124,77,255,0.3)' : 'rgba(255,255,255,0.05)',
                color: '#fff', cursor: 'pointer', fontSize: 18, textAlign: 'center',
                outline: previewEmotion === emo ? '2px solid rgba(124,77,255,0.5)' : 'none',
              }}>
                {{'neutral':'😐','happy':'😊','sad':'😢','angry':'😠','surprised':'😲','shy':'😳','thinking':'🤔','loving':'🥰'}[emo]}
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{t(`expr.emotion.${emo}`)}</div>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setPhase('edit'); localStorage.removeItem(GEN_STATE_KEY); }} style={{
              flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)',
              background: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer',
            }}>{t('expr.preview_redo')}</button>
            <button onClick={handleApply} style={{
              flex: 2, padding: '12px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #7c4dff, #448aff)',
              color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>{t('expr.preview_use')}</button>
          </div>
        </>)}

        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <p style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>{t('expr.done_title')}</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>{t('expr.done_desc')}</p>
            <button onClick={onClose} style={{
              padding: '12px 32px', borderRadius: 12, border: 'none',
              background: '#7c4dff', color: '#fff', fontSize: 14, cursor: 'pointer',
            }}>{t('expr.done_btn')}</button>
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
              }}>{t('expr.error_retry')}</button>
              <button onClick={onClose} style={{
                padding: '10px 20px', borderRadius: 12, border: 'none',
                background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
              }}>{t('expr.error_close')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
