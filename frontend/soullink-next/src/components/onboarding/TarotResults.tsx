'use client';

/**
 * TarotResults — personality profile results display.
 *
 * Shows the 3 revealed tarot cards (mini gradient cards),
 * personality dimension bars (center-balanced, -4 to +4),
 * and a "Continue" button to proceed to gender selection.
 */

import { useAppSelector, useAppDispatch } from '@/store';
import { setOnboardingStep } from '@/store/personalitySlice';
import { TAROT_GRADIENTS, DIMENSION_LABELS } from '@/lib/constants';
import type { TarotCard } from '@/types';

// ==================== Dimension Bar (center-balanced) ====================

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

  // value is -4 to +4, convert to 0-100% for bar position
  const clamped = Math.max(-4, Math.min(4, value));
  const percent = ((clamped + 4) / 8) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
        <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>
          {clamped > 0 ? `+${clamped}` : clamped}
        </span>
      </div>
      {/* Bar track with center marker */}
      <div style={{ position: 'relative', height: '8px', width: '100%', borderRadius: '9999px', background: 'rgba(255,255,255,0.1)' }}>
        {/* Center line */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.2)' }} />
        {/* Fill bar from center */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            borderRadius: '9999px',
            background: 'linear-gradient(to right, #6BA3D6, #9DC4E6)',
            transition: 'all 0.7s ease-out',
            ...(clamped >= 0
              ? { left: '50%', width: `${(clamped / 4) * 50}%` }
              : { right: '50%', width: `${(Math.abs(clamped) / 4) * 50}%` }),
          }}
        />
        {/* Position indicator dot */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${percent}%`,
            transform: 'translate(-50%, -50%)',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: '#6BA3D6',
            border: '2px solid rgba(255,255,255,0.8)',
            boxShadow: '0 0 6px rgba(107,163,214,0.5)',
            transition: 'left 0.7s ease-out',
          }}
        />
      </div>
      {/* Low/high labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)' }}>
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

// ==================== Mini Card ====================

function MiniCard({ card, language }: { card: TarotCard; language: string }) {
  const id = card.card_id ?? card.index ?? 0;
  const pair = TAROT_GRADIENTS[id % TAROT_GRADIENTS.length];
  const gradient = `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  const cardName = card.card_name || card.name;
  const cardNameZh = card.card_name_zh || card.name_zh;
  const displayName = language === 'zh-CN' && cardNameZh ? cardNameZh : cardName;
  const numeral = card.card_numeral || '';
  const traits = language === 'zh-CN' ? (card.traits_zh || card.traits) : (card.traits_en || card.traits);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      borderRadius: '16px',
      overflow: 'hidden',
    }}>
      {/* Gradient card face */}
      <div style={{
        width: '100%',
        padding: '20px 12px',
        background: gradient,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        borderRadius: '16px',
      }}>
        {numeral && (
          <span style={{ fontSize: '1rem', fontWeight: 300, color: 'rgba(0,0,0,0.4)', fontFamily: 'serif' }}>
            {numeral}
          </span>
        )}
        <h4 style={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 700, color: 'rgba(0,0,0,0.7)', margin: 0 }}>
          {displayName}
        </h4>
      </div>
      {traits && (
        <p style={{ textAlign: 'center', fontSize: '0.6rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.4)', margin: 0, padding: '0 4px' }}>
          {traits}
        </p>
      )}
    </div>
  );
}

// ==================== Main Component ====================

export default function TarotResults() {
  const dispatch = useAppDispatch();
  const tarotCards = useAppSelector((s) => s.personality.tarotCards);
  const dimensions = useAppSelector((s) => s.personality.dimensions);
  const mbtiType = useAppSelector((s) => s.personality.mbtiType);
  const isRetake = useAppSelector((s) => s.personality.isRetake);
  const language = useAppSelector((s) => s.settings.language);

  function handleContinue() {
    // Retake from sidebar: stop here and go back to chat
    // First-time onboarding: continue to gender selection
    dispatch(setOnboardingStep(isRetake ? 'done' : 'gender'));
  }

  // Ordered dimension keys
  const dimOrder = ['social_energy', 'emotional_expression', 'stress_response', 'life_approach', 'connection_style'];
  const dimEntries: [string, number][] = dimOrder
    .filter((k) => k in dimensions)
    .map((k) => [k, dimensions[k]]);
  // Fallback: if dimensions don't match expected keys, show whatever we have
  if (dimEntries.length === 0) {
    Object.entries(dimensions).forEach(([k, v]) => dimEntries.push([k, v]));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingTop: '16px', paddingBottom: '16px', animation: 'fadeInUp 0.4s ease-out' }}>
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
          {language === 'zh-CN' ? '你的灵魂档案' : 'Your Soul Profile'}
        </h1>
        {mbtiType && (
          <p style={{ marginTop: '8px', fontSize: '1.125rem', fontWeight: 500, color: '#6BA3D6' }}>{mbtiType}</p>
        )}
      </div>

      {/* Tarot cards row */}
      {tarotCards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {tarotCards.map((card, i) => (
            <MiniCard key={i} card={card} language={language} />
          ))}
        </div>
      )}

      {/* Dimension scores */}
      {dimEntries.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.05)',
          padding: '20px',
          backdropFilter: 'blur(4px)',
        }}>
          <h3 style={{ marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
            {language === 'zh-CN' ? '性格维度' : 'Personality Dimensions'}
          </h3>
          {dimEntries.map(([key, value]) => (
            <DimensionBar key={key} dimKey={key} value={value} language={language} />
          ))}
        </div>
      )}

      {/* Continue button */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '8px' }}>
        <button
          onClick={handleContinue}
          style={{
            borderRadius: '16px',
            background: 'linear-gradient(to right, #6BA3D6, #5A8DB8)',
            paddingLeft: '32px',
            paddingRight: '32px',
            paddingTop: '12px',
            paddingBottom: '12px',
            fontWeight: 600,
            color: 'white',
            boxShadow: '0 10px 15px -3px rgba(107,163,214,0.25)',
            transition: 'all 0.2s',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1rem',
          }}
        >
          {language === 'zh-CN' ? '继续' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
