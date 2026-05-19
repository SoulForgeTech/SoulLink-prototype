/**
 * Lorebook display + edit panel inside SettingsModal.
 *
 * Mounted only when the user has a custom_persona (preset users get nothing
 * here — see the SettingsModal conditional render). Shows the auto-extracted
 * lorebook entries: title, keys, content, enable toggle, inline edit, delete.
 *
 * Re-extract button forces a fresh canon-fetch + Gemini run; polls the
 * extraction-status endpoint to show progress and refreshes the list when
 * done.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { AuthFetchFn } from '@/lib/api/client';
import {
  getActiveCompanion,
  getExtractionStatus,
  updateLorebookEntry,
  deleteLorebookEntry,
  reExtractLorebook,
  type Companion,
  type LorebookEntry,
} from '@/lib/api/companions';

interface Props {
  authFetch: AuthFetchFn;
  language: 'en' | 'zh-CN';
}

const SHOW_ALL_THRESHOLD = 5;

export default function LorebookSection({ authFetch, language }: Props) {
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<LorebookEntry>>({});
  const [reextracting, setReextracting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const t = (en: string, zh: string) => (language === 'zh-CN' ? zh : en);

  // ---- Initial load + cleanup ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getActiveCompanion(authFetch).then(c => {
      if (cancelled) return;
      setCompanion(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [authFetch]);

  // ---- Poll extraction status during re-extract ----
  const startPolling = useCallback((companionId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const status = await getExtractionStatus(authFetch, companionId);
      if (!status) return;
      if (status.status === 'done' || status.status === 'failed') {
        if (pollRef.current) clearInterval(pollRef.current);
        setReextracting(false);
        // Refresh the companion to get the new entries
        const fresh = await getActiveCompanion(authFetch);
        if (fresh) setCompanion(fresh);
      }
    }, 2000);
  }, [authFetch]);

  // ---- Handlers ----
  const handleReExtract = async () => {
    if (!companion || reextracting) return;
    if (!confirm(t(
      'Re-analyze the persona and rebuild all lorebook entries from canon? Current edits to entries will be lost.',
      '重新分析人设并从原作素材重建所有条目？当前对条目的修改会丢失。'
    ))) return;
    setReextracting(true);
    const result = await reExtractLorebook(authFetch, companion.id);
    if (!result || !result.success) {
      setReextracting(false);
      alert(t('Re-extract failed.', '重新分析失败。'));
      return;
    }
    startPolling(companion.id);
  };

  const handleStartEdit = (entry: LorebookEntry) => {
    setEditingId(entry.id);
    setEditFields({
      title: entry.title,
      keys: [...entry.keys],
      content: entry.content,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditFields({});
  };

  const handleSaveEdit = async () => {
    if (!companion || !editingId) return;
    const updated = await updateLorebookEntry(authFetch, companion.id, editingId, editFields);
    if (!updated) {
      alert(t('Save failed.', '保存失败。'));
      return;
    }
    // Replace entry in companion state
    setCompanion(prev => prev ? {
      ...prev,
      lorebook_entries: prev.lorebook_entries.map(e => e.id === editingId ? updated : e),
    } : null);
    setEditingId(null);
    setEditFields({});
  };

  const handleToggleEnabled = async (entry: LorebookEntry) => {
    if (!companion) return;
    const updated = await updateLorebookEntry(authFetch, companion.id, entry.id, {
      enabled: !entry.enabled,
    });
    if (!updated) return;
    setCompanion(prev => prev ? {
      ...prev,
      lorebook_entries: prev.lorebook_entries.map(e => e.id === entry.id ? updated : e),
    } : null);
  };

  const handleDelete = async (entry: LorebookEntry) => {
    if (!companion) return;
    if (!confirm(t(`Delete entry "${entry.title}"?`, `删除条目「${entry.title}」？`))) return;
    const ok = await deleteLorebookEntry(authFetch, companion.id, entry.id);
    if (!ok) {
      alert(t('Delete failed.', '删除失败。'));
      return;
    }
    setCompanion(prev => prev ? {
      ...prev,
      lorebook_entries: prev.lorebook_entries.filter(e => e.id !== entry.id),
    } : null);
  };

  // ---- Render ----
  if (loading) {
    return <div style={{ fontSize: '0.75rem', color: '#a0aec0', padding: '8px 0' }}>{t('Loading...', '加载中...')}</div>;
  }
  if (!companion) {
    return null; // No companion yet — silently render nothing
  }

  const entries = companion.lorebook_entries || [];
  const card = companion.character_card || ({} as Companion['character_card']);
  const visibleEntries = showAll ? entries : entries.slice(0, SHOW_ALL_THRESHOLD);

  // Status banner copy varies by state
  let statusText: string;
  if (reextracting || companion.extraction_status === 'running') {
    statusText = t('Analyzing canon material...', '正在分析原作素材...');
  } else if (entries.length === 0) {
    if (card.canon_recognized) {
      statusText = t('Canon recognized but no entries — try re-analyzing.', '已识别原作但没有条目，可重新分析。');
    } else {
      statusText = t('No canon source identified — you can add memories manually.', 'AI 没识别出原作，可以手动添加记忆。');
    }
  } else {
    const sourceLabel = card.canon_ip
      ? t(`from ${card.canon_ip}`, `来自 ${card.canon_ip}`)
      : t('hand-curated', '自定义');
    statusText = t(
      `${entries.length} memory entries · ${sourceLabel}`,
      `${entries.length} 条记忆 · ${sourceLabel}`
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {/* Header + status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1a202c' }}>
          {t('Character Memory', '角色记忆')}
        </label>
        <button
          onClick={handleReExtract}
          disabled={reextracting}
          style={{
            fontSize: '0.7rem',
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.15)',
            background: 'transparent',
            color: '#4a5568',
            cursor: reextracting ? 'not-allowed' : 'pointer',
            opacity: reextracting ? 0.5 : 1,
          }}
        >
          {reextracting ? t('Analyzing...', '分析中...') : t('Re-analyze', '重新分析')}
        </button>
      </div>

      <div style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: entries.length > 0 ? '#F0FFF4' : '#FFFAF0',
        border: `1px solid ${entries.length > 0 ? '#C6F6D5' : '#FEEBC8'}`,
        fontSize: '0.75rem',
        color: entries.length > 0 ? '#276749' : '#9C4221',
        marginBottom: 8,
      }}>
        {entries.length > 0 ? '✓' : '✨'} {statusText}
      </div>

      {/* Entry list */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleEntries.map(entry => (
            <LorebookEntryRow
              key={entry.id}
              entry={entry}
              isEditing={editingId === entry.id}
              editFields={editFields}
              onEditFieldsChange={setEditFields}
              onStartEdit={() => handleStartEdit(entry)}
              onCancelEdit={handleCancelEdit}
              onSaveEdit={handleSaveEdit}
              onToggleEnabled={() => handleToggleEnabled(entry)}
              onDelete={() => handleDelete(entry)}
              language={language}
            />
          ))}
          {entries.length > SHOW_ALL_THRESHOLD && (
            <button
              onClick={() => setShowAll(!showAll)}
              style={{
                fontSize: '0.7rem',
                padding: '6px 0',
                background: 'transparent',
                border: 'none',
                color: 'var(--seal)',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {showAll
                ? t('Collapse', '收起')
                : t(`Show all ${entries.length}`, `展开全部 ${entries.length} 条`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Per-entry row ----

interface RowProps {
  entry: LorebookEntry;
  isEditing: boolean;
  editFields: Partial<LorebookEntry>;
  onEditFieldsChange: (fields: Partial<LorebookEntry>) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  language: 'en' | 'zh-CN';
}

function LorebookEntryRow(props: RowProps) {
  const { entry, isEditing, editFields, onEditFieldsChange, onStartEdit, onCancelEdit, onSaveEdit, onToggleEnabled, onDelete, language } = props;
  const t = (en: string, zh: string) => (language === 'zh-CN' ? zh : en);

  if (isEditing) {
    return (
      <div style={{
        padding: 10,
        borderRadius: 8,
        background: 'rgba(107,163,214,0.08)',
        border: '1px solid rgba(107,163,214,0.3)',
      }}>
        <input
          value={editFields.title ?? ''}
          onChange={e => onEditFieldsChange({ ...editFields, title: e.target.value })}
          placeholder={t('Title', '标题')}
          style={{
            width: '100%',
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.1)',
            fontSize: '0.85rem',
            marginBottom: 6,
            fontWeight: 600,
          }}
        />
        <input
          value={(editFields.keys ?? []).join(', ')}
          onChange={e => onEditFieldsChange({
            ...editFields,
            keys: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
          })}
          placeholder={t('Keywords (comma separated)', '关键词（逗号分隔）')}
          style={{
            width: '100%',
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.1)',
            fontSize: '0.75rem',
            marginBottom: 6,
            fontFamily: 'monospace',
          }}
        />
        <textarea
          value={editFields.content ?? ''}
          onChange={e => onEditFieldsChange({ ...editFields, content: e.target.value })}
          placeholder={t('Content', '内容')}
          rows={4}
          style={{
            width: '100%',
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.1)',
            fontSize: '0.75rem',
            marginBottom: 6,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancelEdit}
            style={{
              fontSize: '0.7rem', padding: '4px 12px', borderRadius: 4,
              border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', cursor: 'pointer',
            }}
          >
            {t('Cancel', '取消')}
          </button>
          <button
            onClick={onSaveEdit}
            style={{
              fontSize: '0.7rem', padding: '4px 12px', borderRadius: 4,
              border: 'none', background: 'var(--seal)', color: 'white', cursor: 'pointer',
            }}
          >
            {t('Save', '保存')}
          </button>
        </div>
      </div>
    );
  }

  // Read-only row
  const previewKeys = entry.keys.slice(0, 4).join(' · ') + (entry.keys.length > 4 ? ' ...' : '');
  const previewContent = entry.content.length > 90 ? entry.content.slice(0, 90) + '...' : entry.content;
  const isCanon = entry._source_hint === 'canon';

  return (
    <div style={{
      padding: 10,
      borderRadius: 8,
      background: entry.enabled ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.03)',
      border: '1px solid rgba(0,0,0,0.06)',
      opacity: entry.enabled ? 1 : 0.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1a202c', flex: 1 }}>
          {isCanon && <span title={t('From canon source', '来自原作')} style={{ marginRight: 4, color: '#3182CE' }}>📌</span>}
          {entry.title || t('(no title)', '(无标题)')}
        </span>
        <button
          onClick={onToggleEnabled}
          title={entry.enabled ? t('Disable', '停用') : t('Enable', '启用')}
          style={{
            fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
            border: 'none', background: entry.enabled ? '#48BB78' : '#CBD5E0',
            color: 'white', cursor: 'pointer',
          }}
        >
          {entry.enabled ? '✓' : '○'}
        </button>
        <button onClick={onStartEdit} style={{
          fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
          border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', cursor: 'pointer',
        }}>{t('Edit', '编辑')}</button>
        <button onClick={onDelete} style={{
          fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
          border: '1px solid #FED7D7', background: 'transparent', color: '#C53030', cursor: 'pointer',
        }}>{t('Delete', '删除')}</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: '#718096', marginBottom: 4, fontFamily: 'monospace' }}>
        {previewKeys}
      </div>
      <div style={{ fontSize: '0.75rem', color: '#4a5568', lineHeight: 1.5 }}>
        {previewContent}
      </div>
    </div>
  );
}
