'use client';

/**
 * Memory Panel — shows what the AI remembers about the user.
 * Displayed as a tab in SettingsModal.
 *
 * Features:
 *   - Lists all Mem0 memories grouped by tier (Core / Important / Recent)
 *   - Each memory can be deleted
 *   - Supports zh-CN / en
 */

import { useState, useEffect, useCallback } from 'react';
import { useAppSelector } from '@/store';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { USER } from '@/lib/api/endpoints';
import { useT } from '@/hooks/useT';

// ==================== Types ====================

interface Memory {
  id: string;
  fact: string;
  tier: 'permanent' | 'long_term' | 'short_term';
  created_at?: string;
  expires_at?: string;
}

interface MemoriesResponse {
  memories: Memory[];
  total: number;
  counts: { permanent: number; long_term: number; short_term: number };
}

// ==================== Tier Config ====================

const TIER_CONFIG = {
  permanent: { emoji: '📌', color: '#E53E3E', bg: 'rgba(229,62,62,0.06)', border: 'rgba(229,62,62,0.15)' },
  long_term: { emoji: '💡', color: '#D69E2E', bg: 'rgba(214,158,46,0.06)', border: 'rgba(214,158,46,0.15)' },
  short_term: { emoji: '💬', color: '#718096', bg: 'rgba(113,128,150,0.06)', border: 'rgba(113,128,150,0.15)' },
};

// ==================== Component ====================

export default function MemoryPanel() {
  const authFetch = useAuthFetch();
  const t = useT();
  const language = useAppSelector((s) => s.settings.language);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [counts, setCounts] = useState({ permanent: 0, long_term: 0, short_term: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
        return; // Success
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500)); // Wait before retry
        }
      }
    }
    setError(language === 'zh-CN' ? '加载失败' : 'Failed to load');
    setLoading(false);
  }, [authFetch, language]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  // Delete a memory
  const handleDelete = async (id: string) => {
    const msg = t('settings.memory.delete.confirm');
    if (!confirm(msg)) return;

    setDeletingId(id);
    try {
      const resp = await authFetch(USER.deleteMemory(id), { method: 'DELETE' });
      if (resp.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
        setCounts((prev) => {
          const mem = memories.find((m) => m.id === id);
          if (!mem) return prev;
          return { ...prev, [mem.tier]: Math.max(0, prev[mem.tier] - 1) };
        });
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
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

  if (memories.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#a0aec0' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>🧠</div>
        {t('settings.memory.empty')}
      </div>
    );
  }

  // Group by tier
  const grouped: Record<string, Memory[]> = { permanent: [], long_term: [], short_term: [] };
  for (const m of memories) {
    (grouped[m.tier] || grouped.long_term).push(m);
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Header with counts */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap',
      }}>
        {(['permanent', 'long_term', 'short_term'] as const).map((tier) => {
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
      </div>

      {/* Memory groups */}
      {(['permanent', 'long_term', 'short_term'] as const).map((tier) => {
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
              {items.map((mem) => (
                <div key={mem.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '8px 12px', borderRadius: 10,
                  background: cfg.bg,
                  border: `1px solid ${cfg.border}`,
                  fontSize: '0.85rem', lineHeight: 1.5,
                  color: '#2D3748',
                }}>
                  <span style={{ flex: 1 }}>{mem.fact}</span>
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
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
