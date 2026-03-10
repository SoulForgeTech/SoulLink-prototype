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
        <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
          Choose Your Relationship
        </h1>
        <p style={{ marginTop: '8px', fontSize: '0.875rem', color: 'rgba(255,255,255,0.4)' }}>
          You want them to be your...?
        </p>
      </div>

      {/* Relationship cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {RELATIONSHIPS.map((r) => (
          <button
            key={r.value}
            onClick={() => handleSelect(r.value)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              borderRadius: '24px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              padding: '32px',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.2s',
              cursor: 'pointer',
              color: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(107,163,214,0.4)';
              e.currentTarget.style.background = 'rgba(107,163,214,0.1)';
              e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(107,163,214,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: '3.75rem', transition: 'transform 0.2s' }}>
              {r.emoji}
            </span>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: 0 }}>{r.label}</h3>
              <p style={{ marginTop: '4px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>{r.sublabel}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
