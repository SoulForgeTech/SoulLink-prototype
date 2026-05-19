'use client';

/**
 * RelationshipSelect — relationship type selection.
 *
 * Two cards: Lover / Friend.
 * Click to select and advance to subtype selection.
 */

import { useAppDispatch } from '@/store';
import { selectRelationship, setOnboardingStep } from '@/store/personalitySlice';

interface RelOption {
  value: string;
  emoji: string;
  label: string;
  sublabel: string;
}

const RELATIONSHIPS: RelOption[] = [
  {
    value: 'lover',
    emoji: '\u{1F495}',
    label: 'Lover',
    sublabel: 'Romantic partner',
  },
  {
    value: 'friend',
    emoji: '\u{1F91D}',
    label: 'Friend',
    sublabel: 'Close companion',
  },
];

export default function RelationshipSelect() {
  const dispatch = useAppDispatch();

  function handleSelect(rel: string) {
    dispatch(selectRelationship(rel));
    dispatch(setOnboardingStep('subtype'));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px', paddingTop: '16px', paddingBottom: '16px', animation: 'fadeInUp 0.4s ease-out' }}>
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          Choose Your Relationship
        </h1>
        <p style={{ marginTop: '8px', fontSize: '0.875rem', color: 'var(--ink-soft)' }}>
          You want them to be your...?
        </p>
      </div>

      {/* Relationship cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {RELATIONSHIPS.map((r) => (
          <button
            key={r.value}
            onClick={() => handleSelect(r.value)}
            className="diary-paper-panel"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              borderRadius: '24px',
              padding: '32px',
              transition: 'all 0.2s',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
            }}
          >
            <span style={{ fontSize: '3.75rem', transition: 'transform 0.2s' }}>
              {r.emoji}
            </span>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{r.label}</h3>
              <p style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--ink-soft)', margin: 0 }}>{r.sublabel}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
