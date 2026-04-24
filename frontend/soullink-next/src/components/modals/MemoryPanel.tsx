'use client';

/**
 * Memory Panel — shows what the AI remembers about the user.
 * Displayed as a tab in SettingsModal.
 *
 * Features:
 *   - Lists all Mem0 memories grouped by tier (Core / Important / Recent)
 *   - Inline edit (text + tier) and delete
 *   - Manual add (bypasses LLM extraction via infer=False on the backend)
 *   - Honours ui.memoryHighlightIds to briefly highlight rows when jumped in
 *     from a chat receipt chip
 *   - Supports zh-CN / en
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { USER } from '@/lib/api/endpoints';
import { useT } from '@/hooks/useT';
import { clearMemoryHighlight } from '@/store/uiSlice';

// ==================== Types ====================

type Tier = 'permanent' | 'long_term' | 'short_term';

interface Memory {
  id: string;
  fact: string;
  tier: Tier;
  created_at?: string;
  expires_at?: string;
}

interface MemoriesResponse {
  memories: Memory[];
  total: number;
  counts: { permanent: number; long_term: number; short_term: number };
}

// ==================== Tier Config ====================

const TIER_CONFIG: Record<Tier, { emoji: string; color: string; bg: string; border: string }> = {
  permanent: { emoji: '📌', color: '#E53E3E', bg: 'rgba(229,62,62,0.06)', border: 'rgba(229,62,62,0.15)' },
  long_term: { emoji: '💡', color: '#D69E2E', bg: 'rgba(214,158,46,0.06)', border: 'rgba(214,158,46,0.15)' },
  short_term: { emoji: '💬', color: '#718096', bg: 'rgba(113,128,150,0.06)', border: 'rgba(113,128,150,0.15)' },
};

const TIERS: readonly Tier[] = ['permanent', 'long_term', 'short_term'] as const;

// ==================== Component ====================

export default function MemoryPanel() {
  const authFetch = useAuthFetch();
  const dispatch = useAppDispatch();
  const t = useT();
  const language = useAppSelector((s) => s.settings.language);
  const isGuest = useAppSelector((s) => s.guest.isGuest);
  const highlightIds = useAppSelector((s) => s.ui.memoryHighlightIds);

  // Guest mode: show lock prompt
  if (isGuest) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#a0aec0' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔒</div>
        <p style={{ fontSize: '0.85rem', color: '#4a5568', margin: '0 0 8px 0' }}>
          {language === 'zh-CN' ? '注册后解锁记忆功能' : 'Sign up to unlock memories'}
        </p>
        <p style={{ fontSize: '0.75rem', color: '#a0aec0' }}>
          {language === 'zh-CN' ? 'AI 会记住你们的对话，建立长期记忆' : 'AI will remember your conversations and build long-term memory'}
        </p>
        <button onClick={() => { window.location.href = '/login'; }} style={{ marginTop: 12, padding: '8px 24px', borderRadius: 8, border: 'none', background: '#6BA3D6', color: 'white', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
          {language === 'zh-CN' ? '立即注册' : 'Sign Up Now'}
        </button>
      </div>
    );
  }

  const [memories, setMemories] = useState<Memory[]>([]);
  const [counts, setCounts] = useState({ permanent: 0, long_term: 0, short_term: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTier, setEditTier] = useState<Tier>('long_term');
  const [savingEdit, setSavingEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [addTier, setAddTier] = useState<Tier>('long_term');
  const [submittingAdd, setSubmittingAdd] = useState(false);
  // Track which ids should flash after a jump-from-chip; cleared after 4s.
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Fetch memories on mount
  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError('');
    // Retry up to 3 times — Qdrant embedded mode may fail if request
    // hits the wrong Gunicorn worker (only one can hold the lock)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await authFetch(USER.MEMORIES);
        if (!resp.ok) throw new Error('Failed to fetch');
        const data: MemoriesResponse = await resp.json();
        setMemories(data.memories || []);
        setCounts(data.counts || { permanent: 0, long_term: 0, short_term: 0 });
        setLoading(false);
        return;
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
    setError(language === 'zh-CN' ? '加载失败' : 'Failed to load');
    setLoading(false);
  }, [authFetch, language]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  // When opened via the chat receipt chip, scroll to the first highlighted
  // memory and flash its background briefly.
  useEffect(() => {
    if (!highlightIds || highlightIds.length === 0) return;
    if (loading) return; // wait for list
    setFlashIds(highlightIds);
    const first = highlightIds[0];
    requestAnimationFrame(() => {
      const node = itemRefs.current[first];
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setFlashIds([]);
      dispatch(clearMemoryHighlight());
    }, 4000);
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [highlightIds, loading, dispatch]);

  // Recount helper — derives counts from current memories list.
  const recount = useCallback((list: Memory[]) => ({
    permanent: list.filter((m) => m.tier === 'permanent').length,
    long_term: list.filter((m) => m.tier === 'long_term').length,
    short_term: list.filter((m) => m.tier === 'short_term').length,
  }), []);

  // Delete a memory
  const handleDelete = async (id: string) => {
    const msg = t('settings.memory.delete.confirm');
    if (!confirm(msg)) return;

    setDeletingId(id);
    try {
      const resp = await authFetch(USER.deleteMemory(id), { method: 'DELETE' });
      if (resp.ok) {
        setMemories((prev) => {
          const next = prev.filter((m) => m.id !== id);
          setCounts(recount(next));
          return next;
        });
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  // Start editing a memory
  const startEdit = (mem: Memory) => {
    setEditingId(mem.id);
    setEditText(mem.fact);
    setEditTier(mem.tier);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async (id: string) => {
    const trimmed = editText.trim();
    if (trimmed.length < 2) return;
    setSavingEdit(true);
    try {
      const resp = await authFetch(USER.updateMemory(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact: trimmed, tier: editTier }),
      });
      if (resp.ok) {
        setMemories((prev) => {
          const next = prev.map((m) => (m.id === id ? { ...m, fact: trimmed, tier: editTier } : m));
          setCounts(recount(next));
          return next;
        });
        setEditingId(null);
      }
    } catch {
      // ignore
    } finally {
      setSavingEdit(false);
    }
  };

  const submitAdd = async () => {
    const trimmed = addText.trim();
    if (trimmed.length < 2) return;
    setSubmittingAdd(true);
    try {
      const resp = await authFetch(USER.MEMORIES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact: trimmed, tier: addTier }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { memory?: Memory };
        if (data.memory && data.memory.id) {
          const newMem: Memory = {
            id: data.memory.id,
            fact: data.memory.fact,
            tier: data.memory.tier,
          };
          setMemories((prev) => {
            const next = [newMem, ...prev];
            setCounts(recount(next));
            return next;
          });
        } else {
          // Backend accepted but returned no id (rare) — refetch.
          await fetchMemories();
        }
        setAddText('');
        setAddTier('long_term');
        setAdding(false);
      }
    } catch {
      // ignore
    } finally {
      setSubmittingAdd(false);
    }
  };

  // Get tier label
  const tierLabel = (tier: string) => {
    const key = `settings.memory.${tier}` as const;
    return t(key) || tier;
  };

  if (loading) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#a0aec0' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>🧠</div>
        {t('settings.memory.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#E53E3E' }}>
        {error}
        <button
          onClick={fetchMemories}
          style={{
            display: 'block', margin: '12px auto', padding: '6px 16px',
            border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
            background: 'white', cursor: 'pointer',
          }}
        >
          {language === 'zh-CN' ? '重试' : 'Retry'}
        </button>
      </div>
    );
  }

  // Group by tier
  const grouped: Record<Tier, Memory[]> = { permanent: [], long_term: [], short_term: [] };
  for (const m of memories) {
    (grouped[m.tier] || grouped.long_term).push(m);
  }

  const flashSet = new Set(flashIds);

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Header with counts + add button */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {TIERS.map((tier) => {
          const cfg = TIER_CONFIG[tier];
          const count = counts[tier];
          return (
            <span key={tier} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 12,
              fontSize: '0.75rem', fontWeight: 500,
              color: cfg.color,
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
            }}>
              {cfg.emoji} {tierLabel(tier)} {count}
            </span>
          );
        })}
        <button
          onClick={() => setAdding((v) => !v)}
          style={{
            marginLeft: 'auto',
            padding: '4px 12px',
            border: '1px solid rgba(107,163,214,0.4)',
            borderRadius: 999,
            background: adding ? 'rgba(107,163,214,0.12)' : 'white',
            color: '#2B6CB0',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + {t('settings.memory.add')}
        </button>
      </div>

      {/* Manual add form */}
      {adding && (
        <div style={{
          marginBottom: 16,
          padding: 12,
          border: '1px dashed rgba(107,163,214,0.4)',
          borderRadius: 10,
          background: 'rgba(107,163,214,0.04)',
        }}>
          <textarea
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder={t('settings.memory.add.placeholder')}
            rows={2}
            style={{
              width: '100%', padding: 8, borderRadius: 6,
              border: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem',
              fontFamily: 'inherit', resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <select
              value={addTier}
              onChange={(e) => setAddTier(e.target.value as Tier)}
              style={{
                padding: '4px 8px', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.1)', fontSize: '0.8rem',
              }}
            >
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {TIER_CONFIG[tier].emoji} {tierLabel(tier)}
                </option>
              ))}
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                onClick={() => { setAdding(false); setAddText(''); }}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: '0.8rem',
                  border: '1px solid rgba(0,0,0,0.1)', background: 'white',
                  cursor: 'pointer',
                }}
              >
                {t('settings.memory.cancel')}
              </button>
              <button
                onClick={submitAdd}
                disabled={addText.trim().length < 2 || submittingAdd}
                style={{
                  padding: '4px 14px', borderRadius: 6, fontSize: '0.8rem',
                  border: 'none', background: '#6BA3D6', color: 'white',
                  fontWeight: 600,
                  cursor: addText.trim().length < 2 || submittingAdd ? 'not-allowed' : 'pointer',
                  opacity: addText.trim().length < 2 || submittingAdd ? 0.5 : 1,
                }}
              >
                {t('settings.memory.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {memories.length === 0 && !adding && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#a0aec0' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>🧠</div>
          {t('settings.memory.empty')}
        </div>
      )}

      {/* Memory groups */}
      {TIERS.map((tier) => {
        const items = grouped[tier];
        if (!items || items.length === 0) return null;
        const cfg = TIER_CONFIG[tier];

        return (
          <div key={tier} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: '0.8rem', fontWeight: 600, color: cfg.color,
              marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {cfg.emoji} {tierLabel(tier)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((mem) => {
                const isEditing = editingId === mem.id;
                const flashing = flashSet.has(mem.id);
                return (
                  <div
                    key={mem.id}
                    ref={(el) => { itemRefs.current[mem.id] = el; }}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 12px', borderRadius: 10,
                      background: flashing ? 'rgba(246,224,94,0.35)' : cfg.bg,
                      border: `1px solid ${flashing ? 'rgba(236,201,75,0.7)' : cfg.border}`,
                      fontSize: '0.85rem', lineHeight: 1.5,
                      color: '#2D3748',
                      transition: 'background 0.6s ease, border 0.6s ease',
                    }}
                  >
                    {isEditing ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={2}
                          style={{
                            width: '100%', padding: 6, borderRadius: 6,
                            border: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem',
                            fontFamily: 'inherit', resize: 'vertical',
                            boxSizing: 'border-box',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select
                            value={editTier}
                            onChange={(e) => setEditTier(e.target.value as Tier)}
                            style={{
                              padding: '3px 6px', borderRadius: 6,
                              border: '1px solid rgba(0,0,0,0.1)', fontSize: '0.78rem',
                            }}
                          >
                            {TIERS.map((tier2) => (
                              <option key={tier2} value={tier2}>
                                {TIER_CONFIG[tier2].emoji} {tierLabel(tier2)}
                              </option>
                            ))}
                          </select>
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                            <button
                              onClick={cancelEdit}
                              style={{
                                padding: '3px 10px', borderRadius: 6, fontSize: '0.78rem',
                                border: '1px solid rgba(0,0,0,0.1)', background: 'white',
                                cursor: 'pointer',
                              }}
                            >
                              {t('settings.memory.cancel')}
                            </button>
                            <button
                              onClick={() => saveEdit(mem.id)}
                              disabled={editText.trim().length < 2 || savingEdit}
                              style={{
                                padding: '3px 12px', borderRadius: 6, fontSize: '0.78rem',
                                border: 'none', background: '#6BA3D6', color: 'white',
                                fontWeight: 600,
                                cursor: editText.trim().length < 2 || savingEdit ? 'not-allowed' : 'pointer',
                                opacity: editText.trim().length < 2 || savingEdit ? 0.5 : 1,
                              }}
                            >
                              {t('settings.memory.save')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span style={{ flex: 1 }}>{mem.fact}</span>
                        <button
                          onClick={() => startEdit(mem)}
                          title={t('settings.memory.edit')}
                          style={{
                            flexShrink: 0, width: 24, height: 24,
                            border: 'none', borderRadius: 6,
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#718096', transition: 'color 0.2s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#2B6CB0'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#718096'; }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(mem.id)}
                          disabled={deletingId === mem.id}
                          style={{
                            flexShrink: 0, width: 24, height: 24,
                            border: 'none', borderRadius: 6,
                            background: deletingId === mem.id ? 'rgba(0,0,0,0.05)' : 'transparent',
                            cursor: deletingId === mem.id ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#a0aec0', transition: 'color 0.2s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#E53E3E'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#a0aec0'; }}
                          title={language === 'zh-CN' ? '删除' : 'Delete'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
