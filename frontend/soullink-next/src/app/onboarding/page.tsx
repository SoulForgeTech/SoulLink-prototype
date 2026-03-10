'use client';

/**
 * Onboarding flow page.
 *
 * Multi-step wizard:
 *   questions -> tarot -> results -> gender -> relationship -> subtype -> naming -> done
 *
 * The current step is tracked in Redux (personalitySlice.onboardingStep).
 * Each step renders a dedicated component that advances the step when done.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store';
import { setOnboardingStep } from '@/store/personalitySlice';

import PersonalityQuestions from '@/components/onboarding/PersonalityQuestions';
import TarotCards from '@/components/onboarding/TarotCards';
import TarotResults from '@/components/onboarding/TarotResults';
import GenderSelect from '@/components/onboarding/GenderSelect';
import RelationshipSelect from '@/components/onboarding/RelationshipSelect';
import SubtypeSelect from '@/components/onboarding/SubtypeSelect';
import CompanionNaming from '@/components/onboarding/CompanionNaming';

// ==================== Progress Map ====================

const STEPS = [
  'questions',
  'tarot',
  'results',
  'gender',
  'relationship',
  'subtype',
  'naming',
] as const;

function getStepIndex(step: string): number {
  const idx = STEPS.indexOf(step as (typeof STEPS)[number]);
  return idx >= 0 ? idx : 0;
}

// ==================== Component ====================

export default function OnboardingPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const step = useAppSelector((s) => s.personality.onboardingStep);

  // Start the flow on mount if step is idle
  useEffect(() => {
    if (step === 'idle') {
      dispatch(setOnboardingStep('questions'));
    }
  }, [step, dispatch]);

  // Navigate away when done
  useEffect(() => {
    if (step === 'done') {
      router.replace('/chat');
    }
  }, [step, router]);

  // Progress percentage
  const currentIndex = getStepIndex(step);
  const progressPercent = ((currentIndex + 1) / STEPS.length) * 100;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'safe center',
        padding: '32px 16px',
      }}
    >
      {/* Progress bar */}
      {step !== 'idle' && step !== 'done' && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            zIndex: 50,
            height: '4px',
            width: '100%',
            background: 'rgba(255, 255, 255, 0.1)',
          }}
        >
          <div
            style={{
              height: '100%',
              background: '#6BA3D6',
              transition: 'width 0.5s ease-out',
              width: `${progressPercent}%`,
            }}
          />
        </div>
      )}

      {/* Step content */}
      <div style={{ width: '100%', maxWidth: '32rem' }}>
        {step === 'questions' && <PersonalityQuestions />}
        {step === 'tarot' && <TarotCards />}
        {step === 'results' && <TarotResults />}
        {step === 'gender' && <GenderSelect />}
        {step === 'relationship' && <RelationshipSelect />}
        {step === 'subtype' && <SubtypeSelect />}
        {step === 'naming' && <CompanionNaming />}

        {/* Loading fallback for idle/done */}
        {(step === 'idle' || step === 'done') && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                borderTopColor: '#6BA3D6',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
