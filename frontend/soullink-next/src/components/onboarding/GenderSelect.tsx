'use client';

/**
 * GenderSelect — companion gender selection.
 *
 * Two large cards: "Her" and "Him".
 * Click to select and advance to relationship selection.
 */

import { useAppDispatch } from '@/store';
import { selectGender, setOnboardingStep } from '@/store/personalitySlice';

interface GenderOption {
  value: 'female' | 'male';
  emoji: string;
  label: string;
  sublabel: string;
}

const GENDERS: GenderOption[] = [
  {
    value: 'female',
    emoji: '\u{1F483}',
    label: 'Her',
    sublabel: 'Female companion',
  },
  {
    value: 'male',
    emoji: '\u{1F57A}',
    label: 'Him',
    sublabel: 'Male companion',
  },
];

export default function GenderSelect() {
  const dispatch = useAppDispatch();

  function handleSelect(gender: 'female' | 'male') {
    dispatch(selectGender(gender));
    dispatch(setOnboardingStep('relationship'));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px', paddingTop: '16px', paddingBottom: '16px', animation: 'fadeInUp 0.4s ease-out' }}>
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          Choose Companion Type
        </h1>
        <p style={{ marginTop: '8px', fontSize: '0.875rem', color: 'var(--ink-soft)' }}>
          You want your soulmate to be...?
        </p>
      </div>

      {/* Gender cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {GENDERS.map((g) => (
          <button
            key={g.value}
            onClick={() => handleSelect(g.value)}
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
              {g.emoji}
            </span>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{g.label}</h3>
              <p style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--ink-soft)', margin: 0 }}>{g.sublabel}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
