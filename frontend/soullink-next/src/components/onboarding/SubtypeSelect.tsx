'use client';

/**
 * SubtypeSelect — personality subtype selection.
 *
 * Shows 4 subtype cards for the selected gender.
 * Each card: emoji icon, name, description.
 * On selection, saves gender + subtype + relationship to the API,
 * then advances to the naming step.
 */

import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { selectSubtype, setOnboardingStep } from '@/store/personalitySlice';
import { updateSettings } from '@/lib/api/user';
import { SUBTYPES } from '@/lib/constants';
import type { SubtypeDef } from '@/types';

export default function SubtypeSelect() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();

  const gender = useAppSelector((s) => s.personality.selectedGender) || 'female';
  const relationship = useAppSelector((s) => s.personality.selectedRelationship) || 'lover';

  const [isLoading, setIsLoading] = useState(false);

  const subtypes: SubtypeDef[] =
    SUBTYPES[gender as keyof typeof SUBTYPES] || SUBTYPES.female;

  const title =
    gender === 'female' ? "Choose Her Personality" : "Choose His Personality";

  async function handleSelect(subtypeId: string) {
    if (isLoading) return;
    setIsLoading(true);

    dispatch(selectSubtype(subtypeId));

    try {
      await updateSettings(authFetch, {
        companion_gender: gender as 'male' | 'female',
        companion_subtype: subtypeId,
        companion_relationship: relationship,
      });
    } catch (err) {
      console.error('Failed to save subtype settings:', err);
    }

    setIsLoading(false);
    dispatch(setOnboardingStep('naming'));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingTop: '16px', paddingBottom: '16px', animation: 'fadeInUp 0.4s ease-out' }}>
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>{title}</h1>
        <p style={{ marginTop: '8px', fontSize: '0.875rem', color: 'rgba(255,255,255,0.4)' }}>
          Pick the personality that resonates with you
        </p>
      </div>

      {/* Subtype cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {subtypes.map((s) => (
          <button
            key={s.id}
            onClick={() => handleSelect(s.id)}
            disabled={isLoading}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              borderRadius: '24px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              padding: '24px',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.2s',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
              pointerEvents: isLoading ? 'none' : 'auto',
              color: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.borderColor = 'rgba(107,163,214,0.4)';
                e.currentTarget.style.background = 'rgba(107,163,214,0.1)';
                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(107,163,214,0.1)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: '2.25rem', transition: 'transform 0.2s' }}>
              {s.icon}
            </span>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
              {s.name_en}
            </h3>
            <p style={{ textAlign: 'center', fontSize: '0.75rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
              {s.desc_en}
            </p>
          </button>
        ))}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{
            height: '24px',
            width: '24px',
            borderRadius: '50%',
            borderWidth: '2px',
            borderStyle: 'solid',
            borderColor: 'rgba(255,255,255,0.2)',
            borderTopColor: '#6BA3D6',
            animation: 'spin 1s linear infinite',
          }} />
        </div>
      )}
    </div>
  );
}
