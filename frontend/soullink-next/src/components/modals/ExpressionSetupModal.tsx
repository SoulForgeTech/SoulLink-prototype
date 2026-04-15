'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { setCharacterExpressions, setCharacterDisplayMode } from '@/store/settingsSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useT } from '@/hooks/useT';

interface ExpressionSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'loading' | 'edit' | 'generating' | 'preview' | 'error';

const JOB_KEY = 'soullink_expr_job_id';
const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'shy', 'thinking', 'loving'];
const EMOJI: Record<string, string> = {
  neutral: '😐', happy: '😊', sad: '😢', angry: '😠',
  surprised: '😲', shy: '😳', thinking: '🤔', loving: '🥰',
};

export default function ExpressionSetupModal({ isOpen, onClose }: ExpressionSetupModalProps) {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const t = useT();
  const isGuest = useAppSelector((s) => s.guest.isGuest);
  const language = useAppSelector((s) => s.settings.language);
  const existingExpressions = useAppSelector((s) => s.settings.characterExpressions);
  const displayMode = useAppSelector((s) => s.settings.characterDisplayMode);

  const [style, setStyle] = useState('anime');
  const [appearance, setAppearance] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState('');
  const [step, setStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(5);
  const [phaseCompleted, setPhaseCompleted] = useState(0);
  const [phaseTotal, setPhaseTotal] = useState(0);
  const [error, setError] = useState('');
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewEmotion, setPreviewEmotion] = useState('neutral');
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // On open: decide what to show
  useEffect(() => {
    if (!isOpen) return;

    // Priority 1: existing expressions in Redux → show preview
    if (existingExpressions?.videos || existingExpressions?.idleVideos) {
      setPreviewData(existingExpressions as Record<string, unknown>);
      setPhase('preview');
      return;
    }

    // Priority 2: ongoing generation job → show progress
    const savedJobId = localStorage.getItem(JOB_KEY);
    if (savedJobId) {
      setPhase('generating');
      setProgress('Checking...');
      startPolling(savedJobId);
      return;
    }

    // Priority 3: no data → show edit
    loadAppearance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, existingExpressions]);

  const translateIfNeeded = useCallback(async (text: string): Promise<string> => {
    if (!text || language !== 'zh-CN') return text;
    // Check if already Chinese (has CJK characters)
    if (/[\u4e00-\u9fff]/.test(text)) return text;
    try {
      const resp = await authFetch('/api/characters/translate-appearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target: language }),
      });
      const data = await resp.json();
      return data.translated || text;
    } catch { return text; }
  }, [authFetch, language]);

  const loadAppearance = useCallback(() => {
    setPhase('loading');
    let rawAppearance = '';

    try {
      const raw = localStorage.getItem('soullink_user');
      if (raw) {
        const user = JSON.parse(raw);
        rawAppearance = user?.settings?.image_appearance || '';
      }
    } catch { /* */ }

    const finalize = async (text: string) => {
      const translated = await translateIfNeeded(text);
      setAppearance(translated);
      setPhase('edit');
    };

    if (rawAppearance) {
      finalize(rawAppearance);
      return;
    }

    if (!isGuest) {
      authFetch('/api/user/custom-status')
        .then((r) => r.json())
        .then((data) => {
          const desc = data?.appearance || data?.persona?.appearance || '';
          finalize(desc);
        })
        .catch(() => finalize(''));
    } else {
      finalize('');
    }
  }, [authFetch, isGuest, translateIfNeeded]);

  // Preview video playback
  useEffect(() => {
    if (phase !== 'preview' || !previewData || !previewVideoRef.current) return;
    const idle = previewData.idleVideos as Record<string, string> | undefined;
    const vids = previewData.videos as Record<string, string> | undefined;
    const url = idle?.[previewEmotion] || vids?.[previewEmotion];
    if (url) {
      previewVideoRef.current.src = url;
      previewVideoRef.current.loop = true;
      previewVideoRef.current.load();
      previewVideoRef.current.play().catch(() => {});
    }
  }, [phase, previewData, previewEmotion]);

  // Polling
  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const resp = await authFetch(`/api/characters/expression-status?job_id=${jobId}`);
        const data = await resp.json();
        setProgress(data.progress || '');
        setStep(data.step || 0);
        setTotalSteps(data.total_steps || 5);
        setPhaseCompleted(data.completed || 0);
        setPhaseTotal(data.phase_total || 0);
        if (data.status === 'done' && data.result) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPreviewData(data.result);
          dispatch(setCharacterExpressions(data.result as never));
          setPhase('preview');
          localStorage.removeItem(JOB_KEY);
        } else if (data.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(data.progress || 'Failed');
          setPhase('error');
          localStorage.removeItem(JOB_KEY);
        }
      } catch { /* keep polling */ }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
  }, [authFetch, dispatch]);

  const handleGenerate = useCallback(async () => {
    if (isGuest) { setError(t('expr.guest_error')); setPhase('error'); return; }
    if (!appearance.trim()) { setError(t('expr.no_appearance')); return; }
    setPhase('generating'); setProgress('Starting...'); setStep(0); setError('');
    try {
      const resp = await authFetch('/api/characters/generate-expressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style, appearance: appearance.trim() }),
      });
      const data = await resp.json();
      if (data.job_id) {
        localStorage.setItem(JOB_KEY, data.job_id);
        startPolling(data.job_id);
      } else { throw new Error(data.error || 'Failed'); }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Error');
    }
  }, [authFetch, style, appearance, isGuest, t, startPolling]);

  const handleActivate = useCallback(() => {
    if (previewData) {
      dispatch(setCharacterExpressions(previewData as never));
      dispatch(setCharacterDisplayMode('micro'));
    }
    onClose();
  }, [previewData, dispatch, onClose]);

  const handleDeactivate = useCallback(() => {
    dispatch(setCharacterDisplayMode('hidden'));
  }, [dispatch]);

  const handleRedo = useCallback(() => {
    setPreviewData(null);
    loadAppearance();
  }, [loadAppearance]);

  if (!isOpen) return null;

  const isActive = displayMode === 'micro' && !!(existingExpressions?.videos || existingExpressions?.idleVideos);
  const styleOptions = [
    { value: 'anime', icon: '🎨', label: t('expr.style.anime'), desc: t('expr.style.anime_desc') },
    { value: 'realistic', icon: '📷', label: t('expr.style.realistic'), desc: t('expr.style.realistic_desc') },
    { value: '3d', icon: '🎮', label: t('expr.style.3d'), desc: t('expr.style.3d_desc') },
    { value: 'illustration', icon: '✏️', label: t('expr.style.illustration'), desc: t('expr.style.illustration_desc') },
  ];
  const progressPercent = totalSteps > 0 ? Math.round((step / totalSteps) * 100) : 0;

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

        {/* ===== EDIT: generate new expressions ===== */}
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

        {/* ===== GENERATING: progress ===== */}
        {phase === 'generating' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px',
              border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#7c4dff',
              animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>{t('expr.generating')}</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 4 }}>
              {t(`expr.step.${step}`) !== `expr.step.${step}` ? t(`expr.step.${step}`) : progress}
            </p>
            {phaseTotal > 0 && (
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginBottom: 8 }}>
                ({phaseCompleted}/{phaseTotal})
              </p>
            )}
            <div style={{ width: '80%', margin: '0 auto', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)' }}>
              <div style={{ width: `${progressPercent}%`, height: '100%', borderRadius: 3,
                background: 'linear-gradient(90deg, #7c4dff, #448aff)', transition: 'width 0.5s ease' }} />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 4 }}>{step}/{totalSteps}</p>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 12 }}>{t('expr.generating_wait')}</p>
          </div>
        )}

        {/* ===== PREVIEW: always show when data exists ===== */}
        {phase === 'preview' && previewData && (<>
          <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 12, textAlign: 'center' }}>{t('expr.preview_title')}</h3>

          {/* Status badge */}
          {isActive && (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20,
                background: 'rgba(76,175,80,0.2)', color: '#4caf50', fontSize: 11, fontWeight: 600,
              }}>Active</span>
            </div>
          )}

          <div style={{ width: 160, height: 160, margin: '0 auto 12px', borderRadius: 16, overflow: 'hidden',
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
                {EMOJI[emo]}
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{t(`expr.emotion.${emo}`)}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {isActive ? (
              <button onClick={handleDeactivate} style={{
                flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,82,82,0.3)',
                background: 'rgba(255,82,82,0.1)', color: '#ff5252', fontSize: 13, cursor: 'pointer',
              }}>
                {t('expr.deactivate') || 'Deactivate'}
              </button>
            ) : (
              <button onClick={handleActivate} style={{
                flex: 2, padding: '12px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #7c4dff, #448aff)',
                color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
                {t('expr.preview_use')}
              </button>
            )}
          </div>

          <button onClick={handleRedo} style={{
            width: '100%', padding: '10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
            background: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
          }}>
            {t('expr.preview_redo')}
          </button>
        </>)}

        {/* ===== ERROR ===== */}
        {phase === 'error' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>😵</div>
            <p style={{ color: '#ff5252', fontSize: 15, marginBottom: 8 }}>{error}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => { setPhase('edit'); localStorage.removeItem(JOB_KEY); }} style={{
                padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                background: 'none', color: '#fff', fontSize: 13, cursor: 'pointer',
              }}>{t('expr.error_retry')}</button>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: 'none',
                background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
              }}>{t('expr.error_close')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
