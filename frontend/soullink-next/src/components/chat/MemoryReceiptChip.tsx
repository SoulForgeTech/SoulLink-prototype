'use client';

/**
 * MemoryReceiptChip — small indicator under an assistant bubble that surfaces
 * what the memory extractor just saved (or updated) for the current turn.
 *
 * Polls /api/conversations/:id/memory_events?after=<afterIso> for a short
 * window after the assistant message arrives. When events come back, the chip
 * expands to show the first couple of extracted facts plus a "View" button
 * that jumps into the Memory panel and highlights them.
 */

import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useT } from '@/hooks/useT';
import { CONVERSATIONS } from '@/lib/api/endpoints';
import { openModal, setMemoryHighlight } from '@/store/uiSlice';

interface MemoryItem {
  id: string;
  fact: string;
  tier: 'permanent' | 'long_term' | 'short_term';
}

interface MemoryEvent {
  id: string;
  created_at: string | null;
  added: MemoryItem[];
  updated: MemoryItem[];
}

interface Props {
  conversationId: string;
  /** Poll for events created strictly after this ISO timestamp */
  afterIso: string;
}

const TIER_EMOJI: Record<MemoryItem['tier'], string> = {
  permanent: '📌',
  long_term: '💡',
  short_term: '💬',
};

export default function MemoryReceiptChip({ conversationId, afterIso }: Props) {
  const authFetch = useAuthFetch();
  const dispatch = useAppDispatch();
  const t = useT();
  const language = useAppSelector((s) => s.settings.language);
  const isGuest = useAppSelector((s) => s.guest.isGuest);

  const [items, setItems] = useState<MemoryItem[]>([]);
  const [updatedCount, setUpdatedCount] = useState(0);

  useEffect(() => {
    if (isGuest || !conversationId) return;
    let cancelled = false;
    let attempt = 0;
    // Poll a handful of times: the async extractor typically writes within
    // 2-5s, so 5 attempts at 2.5s intervals (~12s total) covers it.
    const maxAttempts = 5;
    const intervalMs = 2500;

    const poll = async () => {
      if (cancelled) return;
      attempt += 1;
      try {
        const url = `${CONVERSATIONS.memoryEvents(conversationId)}?after=${encodeURIComponent(afterIso)}`;
        const resp = await authFetch(url);
        if (!resp.ok) throw new Error('memory events fetch failed');
        const data = (await resp.json()) as { events?: MemoryEvent[] };
        const events = data.events || [];
        if (events.length > 0 && !cancelled) {
          const added: MemoryItem[] = [];
          let updated = 0;
          for (const ev of events) {
            if (Array.isArray(ev.added)) added.push(...ev.added);
            if (Array.isArray(ev.updated)) updated += ev.updated.length;
          }
          if (added.length || updated) {
            setItems(added);
            setUpdatedCount(updated);
            return; // Stop polling — we have something to show.
          }
        }
      } catch {
        // swallow — next attempt will retry
      }
      if (attempt < maxAttempts && !cancelled) {
        setTimeout(poll, intervalMs);
      }
    };

    // Small initial delay so the first poll lands after extraction starts.
    const kickoff = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, [authFetch, conversationId, afterIso, isGuest]);

  if (items.length === 0 && updatedCount === 0) return null;

  const previewItems = items.slice(0, 2);
  const extraCount = Math.max(0, items.length - previewItems.length);
  const savedLabel = t('chat.memory.saved');
  const viewLabel = t('chat.memory.view');

  const handleView = () => {
    dispatch(setMemoryHighlight(items.map((it) => it.id).filter(Boolean)));
    dispatch(openModal({ modal: 'settings', tab: 'memory' }));
  };

  return (
    <div
      role="note"
      aria-label={savedLabel}
      style={{
        marginTop: 6,
        marginLeft: 48,
        marginRight: 12,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '4px 10px',
        borderRadius: 999,
        background: 'rgba(214,158,46,0.08)',
        border: '1px solid rgba(214,158,46,0.2)',
        fontSize: '0.72rem',
        color: '#744210',
        lineHeight: 1.35,
      }}
    >
      <span style={{ fontWeight: 600 }}>💡 {savedLabel}</span>
      {previewItems.map((it, i) => (
        <span key={it.id || i} style={{ color: '#4a5568' }}>
          {TIER_EMOJI[it.tier] || '•'} {truncate(it.fact, 40)}
          {i < previewItems.length - 1 ? ' · ' : ''}
        </span>
      ))}
      {extraCount > 0 && (
        <span style={{ color: '#a0aec0' }}>
          {language === 'zh-CN' ? `+${extraCount} 条` : `+${extraCount} more`}
        </span>
      )}
      <button
        onClick={handleView}
        style={{
          border: 'none',
          background: 'transparent',
          color: '#B7791F',
          cursor: 'pointer',
          fontSize: '0.72rem',
          fontWeight: 600,
          padding: 0,
          textDecoration: 'underline',
        }}
      >
        {viewLabel}
      </button>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
