'use client';

/**
 * TarotCards — tarot card reveal page.
 *
 * Shows 3 cards face-down with a crystal ball emoji.
 * Clicking each card triggers a 3D flip animation revealing the card's
 * Roman numeral, name, and traits on a gradient background matching the old frontend.
 * Cards unlock sequentially. Once all 3 are flipped, a "View Results" button appears.
 */

import { useState, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { setOnboardingStep } from '@/store/personalitySlice';
import { TAROT_GRADIENTS } from '@/lib/constants';
import type { TarotCard } from '@/types';

// ==================== Helpers ====================

/** Get the gradient for a card based on its card_id (0-21). */
function getCardGradient(card: TarotCard): string {
  const id = card.card_id ?? card.index ?? 0;
  const pair = TAROT_GRADIENTS[id % TAROT_GRADIENTS.length];
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

/** Position labels for the 3-card spread. */
const POSITION_LABELS: Record<string, { en: string; zh: string }> = {
  past: { en: 'Past', zh: '过去' },
  present: { en: 'Present', zh: '现在' },
  future: { en: 'Future Companion', zh: '未来伙伴' },
};

// ==================== Single Card Component ====================

interface CardProps {
  card: TarotCard;
  index: number;
  isFlipped: boolean;
  isLocked: boolean;
  onFlip: () => void;
  language: string;
}

function TarotCardItem({ card, index, isFlipped, isLocked, onFlip, language }: CardProps) {
  const cardName = card.card_name || card.name;
  const cardNameZh = card.card_name_zh || card.name_zh;
  const numeral = card.card_numeral || '';
  const traits = language === 'zh-CN' ? (card.traits_zh || card.traits) : (card.traits_en || card.traits);
  const posLabel = card.position
    ? (language === 'zh-CN' ? POSITION_LABELS[card.position]?.zh : POSITION_LABELS[card.position]?.en) || card.position
    : '';
  const displayName = language === 'zh-CN' && cardNameZh ? cardNameZh : cardName;

  return (
    <div
      style={{
        perspective: '800px',
        cursor: isLocked ? 'default' : 'pointer',
        opacity: isLocked ? 0.5 : 1,
        transition: 'opacity 0.3s',
      }}
      onClick={() => !isLocked && onFlip()}
    >
      <div
        style={{
          position: 'relative',
          height: '220px',
          width: '140px',
          transition: 'transform 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'none',
        }}
      >
        {/* Card Back (face-down) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'linear-gradient(to bottom right, #1a1a3e, #0d0d2b)',
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
            backfaceVisibility: 'hidden',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '2rem' }}>{'\u{1F52E}'}</span>
          {posLabel && (
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {posLabel}
            </span>
          )}
          <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', margin: 0 }}>
            {isLocked ? '' : (language === 'zh-CN' ? '点击揭示' : 'Tap to reveal')}
          </p>
        </div>

        {/* Card Front (face-up) — gradient background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.3)',
            background: getCardGradient(card),
            padding: '12px 10px',
            boxShadow: '0 10px 25px -3px rgba(0,0,0,0.2)',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {/* Roman numeral */}
          {numeral && (
            <span style={{ fontSize: '1.1rem', fontWeight: 300, color: 'rgba(0,0,0,0.45)', fontFamily: 'serif', letterSpacing: '2px' }}>
              {numeral}
            </span>
          )}

          {/* Card name */}
          <h3 style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'rgba(0,0,0,0.75)', margin: 0, lineHeight: 1.3 }}>
            {displayName}
          </h3>

          {/* Position label */}
          {posLabel && (
            <span style={{ fontSize: '0.55rem', color: 'rgba(0,0,0,0.4)', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {posLabel}
            </span>
          )}

          {/* Traits */}
          {traits && (
            <p style={{ textAlign: 'center', fontSize: '0.6rem', lineHeight: 1.5, color: 'rgba(0,0,0,0.5)', margin: 0, padding: '0 2px' }}>
              {traits}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export default function TarotCards() {
  const dispatch = useAppDispatch();
  const tarotCards = useAppSelector((s) => s.personality.tarotCards);
  const isRetake = useAppSelector((s) => s.personality.isRetake);
  const language = useAppSelector((s) => s.settings.language);
  const [flipped, setFlipped] = useState<Set<number>>(new Set());

  const allFlipped = tarotCards.length > 0 && flipped.size >= tarotCards.length;

  const handleFlip = useCallback(
    (index: number) => {
      setFlipped((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
    },
    [],
  );

  function handleViewResults() {
    dispatch(setOnboardingStep('results'));
  }

  // Fallback if no cards (e.g., skipped test)
  if (tarotCards.length === 0) {
    dispatch(setOnboardingStep(isRetake ? 'done' : 'gender'));
    return null;
  }

  // Sequential unlocking: card N is locked until card N-1 is flipped
  const nextUnlockedIndex = flipped.size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingTop: '8px', paddingBottom: '16px', animation: 'fadeInUp 0.4s ease-out' }}>
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
          {language === 'zh-CN' ? '你的塔罗牌' : 'Your Cards'}
        </h1>
        <p style={{ marginTop: '6px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
          {language === 'zh-CN' ? '点击每张牌揭示你的灵魂解读' : 'Tap each card to reveal your soul reading'}
        </p>
      </div>

      {/* Cards row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        {tarotCards.map((card, i) => (
          <TarotCardItem
            key={i}
            card={card}
            index={i}
            isFlipped={flipped.has(i)}
            isLocked={i > nextUnlockedIndex}
            onFlip={() => handleFlip(i)}
            language={language}
          />
        ))}
      </div>

      {/* View Results button — appears after all flipped */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          transition: 'all 0.5s',
          opacity: allFlipped ? 1 : 0,
          transform: allFlipped ? 'translateY(0)' : 'translateY(16px)',
          pointerEvents: allFlipped ? 'auto' : 'none',
        }}
      >
        <button
          onClick={handleViewResults}
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
          {language === 'zh-CN' ? '查看结果' : 'View Results'}
        </button>
      </div>
    </div>
  );
}
