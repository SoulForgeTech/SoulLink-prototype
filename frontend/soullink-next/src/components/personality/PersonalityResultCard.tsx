'use client';

/**
 * PersonalityResultCard — compact personality test results for Settings.
 *
 * Displays MBTI type, tarot cards, and dimension bars in a compact card
 * that fits inside the Profile tab of SettingsModal.
 *
 * If test not taken, shows a prompt to take it.
 */

import { useAppSelector } from '@/store';
import { TAROT_GRADIENTS, DIMENSION_LABELS } from '@/lib/constants';
import type { TarotCard } from '@/types';

// ==================== Dimension Bar (light theme) ====================

function DimensionBar({
  dimKey,
  value,
  language,
}: {
  dimKey: string;
  value: number;
  language: string;
}) {
  const meta = DIMENSION_LABELS[dimKey];
  const label = meta ? (language === 'zh-CN' ? meta.zh : meta.en) : dimKey;
  const lowLabel = meta ? (language === 'zh-CN' ? meta.low_zh : meta.low_en) : '';
  const highLabel = meta ? (language === 'zh-CN' ? meta.high_zh : meta.high_en) : '';

  const clamped = Math.max(-4, Math.min(4, value));
  const percent = ((clamped + 4) / 8) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem' }}>
        <span style={{ color: '#4a5568', fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: 'monospace', color: '#a0aec0', fontSize: '0.65rem' }}>
          {clamped > 0 ? `+${clamped}` : clamped}
        </span>
      </div>
      <div style={{ position: 'relative', height: '6px', width: '100%', borderRadius: '9999px', background: 'rgba(0,0,0,0.06)' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(0,0,0,0.1)' }} />
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0, borderRadius: '9999px',
            background: 'linear-gradient(to right, #6BA3D6, #9DC4E6)',
            ...(clamped >= 0
              ? { left: '50%', width: `${(clamped / 4) * 50}%` }
              : { right: '50%', width: `${(Math.abs(clamped) / 4) * 50}%` }),
          }}
        />
        <div
          style={{
            position: 'absolute', top: '50%', left: `${percent}%`,
            transform: 'translate(-50%, -50%)',
            width: '10px', height: '10px', borderRadius: '50%',
            background: '#6BA3D6', border: '2px solid white',
            boxShadow: '0 0 4px rgba(107,163,214,0.4)',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: '#a0aec0' }}>
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

// ==================== Mini Tarot Card ====================

function MiniCard({ card, language }: { card: TarotCard; language: string }) {
  const id = card.card_id ?? card.index ?? 0;
  const pair = TAROT_GRADIENTS[id % TAROT_GRADIENTS.length];
  const gradient = `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  const cardName = card.card_name || card.name;
  const cardNameZh = card.card_name_zh || card.name_zh;
  const displayName = language === 'zh-CN' && cardNameZh ? cardNameZh : cardName;

  return (
    <div style={{
      flex: 1,
      padding: '10px 6px',
      background: gradient,
      borderRadius: '10px',
      textAlign: 'center',
    }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'rgba(0,0,0,0.6)' }}>
        {displayName}
      </span>
    </div>
  );
}

// ==================== Main Component ====================

interface PersonalityResultCardProps {
  onRetake?: () => void;
  onStartTest?: () => void;
}

export default function PersonalityResultCard({ onRetake, onStartTest }: PersonalityResultCardProps) {
  const mbtiType = useAppSelector((s) => s.personality.mbtiType);
  const dimensions = useAppSelector((s) => s.personality.dimensions);
  const tarotCards = useAppSelector((s) => s.personality.tarotCards);
  const testStatus = useAppSelector((s) => s.personality.testStatus);
  const language = useAppSelector((s) => s.settings.language);

  const isCompleted = testStatus === 'completed' && mbtiType;

  // Not taken yet
  if (!isCompleted) {
    return (
      <div style={{
        padding: '16px',
        borderRadius: '12px',
        background: 'rgba(107,163,214,0.06)',
        border: '1px solid rgba(107,163,214,0.15)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>🔮</div>
        <p style={{ fontSize: '0.85rem', color: '#4a5568', margin: '0 0 12px 0' }}>
          {language === 'zh-CN' ? '还没做性格测试' : "Haven't taken the test yet"}
        </p>
        {onStartTest && (
          <button
            onClick={onStartTest}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: '#6BA3D6',
              color: 'white',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {language === 'zh-CN' ? '开始测试' : 'Take the Test'}
          </button>
        )}
      </div>
    );
  }

  // Show results — compact layout
  return (
    <div style={{
      padding: '12px',
      borderRadius: '12px',
      background: 'rgba(107,163,214,0.06)',
      border: '1px solid rgba(107,163,214,0.15)',
    }}>
      {/* Row 1: MBTI badge + tarot cards + retake button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          padding: '3px 10px',
          borderRadius: '6px',
          background: 'linear-gradient(135deg, #6BA3D6, #9DC4E6)',
          color: 'white',
          fontSize: '0.85rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          {mbtiType}
        </span>
        {/* Tarot card names inline */}
        {tarotCards.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flex: 1, overflow: 'hidden' }}>
            {tarotCards.map((card, i) => {
              const cardNameZh = card.card_name_zh || card.name_zh;
              const cardName = card.card_name || card.name;
              const name = language === 'zh-CN' && cardNameZh ? cardNameZh : cardName;
              return (
                <span key={i} style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'rgba(107,163,214,0.1)',
                  fontSize: '0.65rem',
                  color: '#6BA3D6',
                  whiteSpace: 'nowrap',
                }}>
                  {name}
                </span>
              );
            })}
          </div>
        )}
        {onRetake && (
          <button
            onClick={onRetake}
            style={{
              padding: '3px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(107,163,214,0.3)',
              background: 'transparent',
              color: '#6BA3D6',
              fontSize: '0.65rem',
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {language === 'zh-CN' ? '重新测试' : 'Retake'}
          </button>
        )}
      </div>

      {/* Dimension bars — compact spacing */}
      {Object.keys(dimensions).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(dimensions).map(([key, value]) => (
            <DimensionBar key={key} dimKey={key} value={value as number} language={language} />
          ))}
        </div>
      )}
    </div>
  );
}
