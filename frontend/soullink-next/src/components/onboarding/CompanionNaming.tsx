'use client';

/**
 * CompanionNaming — name input + model selection.
 *
 * Background image with dark overlay + blur.
 * Text input for companion name (placeholder = default for subtype).
 * 3 model cards (Gemini, GPT-4o, Grok) with Grok recommended.
 * "Start Chatting" button saves name + model and finishes onboarding.
 */

import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { setOnboardingStep } from '@/store/personalitySlice';
import { setCompanionName as setReduxCompanionName, setModel as setReduxModel } from '@/store/settingsSlice';
import { setUser } from '@/store/authSlice';
import { updateSettings } from '@/lib/api/user';
import { MODEL_DEFINITIONS, SUBTYPE_DEFAULTS } from '@/lib/constants';
import type { ModelDef } from '@/types';

export default function CompanionNaming() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const user = useAppSelector((s) => s.auth.user);

  const selectedSubtype = useAppSelector((s) => s.personality.selectedSubtype);
  const selectedGender = useAppSelector((s) => s.personality.selectedGender);
  const selectedRelationship = useAppSelector((s) => s.personality.selectedRelationship);
  const defaultName = selectedSubtype
    ? SUBTYPE_DEFAULTS[selectedSubtype] || 'Companion'
    : 'Companion';

  const [name, setName] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('grok');
  const [isSaving, setIsSaving] = useState(false);

  async function handleConfirm() {
    if (isSaving) return;
    setIsSaving(true);

    const companionName = name.trim() || defaultName;

    try {
      await updateSettings(authFetch, {
        companion_name: companionName,
        model: selectedModel,
        companion_gender: (selectedGender === 'male' ? 'male' : 'female') as 'male' | 'female',
        companion_subtype: selectedSubtype || '',
        companion_relationship: selectedRelationship || 'lover',
      });
    } catch (err) {
      console.error('Failed to save companion name/model:', err);
    }

    // Update Redux so header and other components reflect the new name/model immediately
    dispatch(setReduxCompanionName(companionName));
    dispatch(setReduxModel(selectedModel));

    // CRITICAL: Also update the user object in auth slice / localStorage
    // so that on page reload, settings are not stale
    if (user) {
      const updatedSettings = {
        ...(user.settings || {}),
        companion_name: companionName,
        model: selectedModel,
        companion_gender: (selectedGender === 'male' ? 'male' : 'female') as 'male' | 'female',
        companion_subtype: selectedSubtype || '',
        companion_relationship: selectedRelationship || 'lover',
      };
      dispatch(setUser({ ...user, settings: updatedSettings }));
    }

    setIsSaving(false);
    dispatch(setOnboardingStep('done'));
  }

  return (
    <div style={{ position: 'relative', animation: 'fadeInUp 0.4s ease-out' }}>
      {/* Background image + overlay */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundImage: "url('/images/bg.png')",
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(10, 10, 26, 0.65)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        />
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '32px',
          paddingTop: '16px',
          paddingBottom: '16px',
        }}
      >
        {/* Title */}
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '1.875rem',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.9)',
            }}
          >
            Give your companion a name
          </h1>
          <p
            style={{
              marginTop: '8px',
              fontSize: '0.875rem',
              color: 'rgba(255, 255, 255, 0.4)',
            }}
          >
            You can always change it later in settings
          </p>
        </div>

        {/* Name input */}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName}
          maxLength={20}
          style={{
            width: '100%',
            maxWidth: '280px',
            borderRadius: '12px',
            border: '2px solid rgba(255, 255, 255, 0.15)',
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '12px 16px',
            textAlign: 'center',
            fontSize: '1.125rem',
            color: 'white',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#6BA3D6';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
          }}
        />

        {/* Model selection title */}
        <h3
          style={{
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          Choose an AI model
        </h3>

        {/* Model cards */}
        <div
          style={{
            display: 'flex',
            width: '100%',
            maxWidth: '360px',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {MODEL_DEFINITIONS.map((model: ModelDef) => (
            <ModelCard
              key={model.id}
              model={model}
              isSelected={selectedModel === model.id}
              onSelect={() => setSelectedModel(model.id)}
            />
          ))}
        </div>

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={isSaving}
          style={{
            marginTop: '8px',
            borderRadius: '12px',
            background: 'linear-gradient(to right, #6BA3D6, #5A8DB8)',
            padding: '12px 40px',
            fontWeight: 600,
            color: 'white',
            border: 'none',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            boxShadow: '0 10px 15px -3px rgba(107, 163, 214, 0.3)',
            transition: 'all 0.2s',
            opacity: isSaving ? 0.5 : 1,
            fontSize: '1rem',
          }}
          onMouseEnter={(e) => {
            if (!isSaving) {
              e.currentTarget.style.boxShadow = '0 10px 25px -3px rgba(107, 163, 214, 0.5)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(107, 163, 214, 0.3)';
          }}
        >
          {isSaving ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '16px',
                  height: '16px',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  borderTopColor: 'white',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              Saving...
            </span>
          ) : (
            'Start Chatting \u2728'
          )}
        </button>
      </div>
    </div>
  );
}

// ==================== Model Card ====================

function ModelCard({
  model,
  isSelected,
  onSelect,
}: {
  model: ModelDef;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderRadius: '16px',
        border: isSelected
          ? '1px solid rgba(107, 163, 214, 0.6)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        padding: '16px',
        textAlign: 'left',
        transition: 'all 0.2s',
        background: isSelected
          ? 'rgba(107, 163, 214, 0.15)'
          : 'rgba(255, 255, 255, 0.05)',
        boxShadow: isSelected
          ? '0 4px 6px -1px rgba(107, 163, 214, 0.1)'
          : 'none',
        cursor: 'pointer',
        color: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
        }
      }}
    >
      {/* Model icon */}
      <div
        style={{
          display: 'flex',
          width: '40px',
          height: '40px',
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
          background: 'rgba(255, 255, 255, 0.1)',
        }}
        dangerouslySetInnerHTML={{ __html: model.svg }}
      />

      {/* Model info */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.9)',
            }}
          >
            {model.name}
          </span>
          {model.recommended && (
            <span
              style={{
                borderRadius: '9999px',
                background: 'rgba(107, 163, 214, 0.2)',
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 500,
                color: '#6BA3D6',
              }}
            >
              Recommended
            </span>
          )}
        </div>
        <p
          style={{
            marginTop: '2px',
            fontSize: '0.75rem',
            color: 'rgba(255, 255, 255, 0.4)',
          }}
        >
          {model.desc_en}
        </p>
      </div>

      {/* Badge */}
      {model.badge_en && (
        <span
          style={{
            flexShrink: 0,
            borderRadius: '9999px',
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '4px 10px',
            fontSize: '10px',
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          {model.badge_en}
        </span>
      )}
    </button>
  );
}
