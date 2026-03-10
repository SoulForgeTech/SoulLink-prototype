'use client';

/**
 * PersonalityQuestions — personality test questionnaire.
 *
 * Shows one question at a time with multiple-choice options.
 * Progress indicator ("3 / 10"), skip button at bottom.
 * Questions fetched from the API, answers submitted on completion.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import {
  setQuestions,
  answerQuestion,
  setTestStatus,
  setTarotCards,
  setDimensions,
  setOnboardingStep,
} from '@/store/personalitySlice';
import { getQuestions, submitTest } from '@/lib/api/personality';
import type { PersonalityQuestion, PersonalityOption } from '@/types';

export default function PersonalityQuestions() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();

  const questions = useAppSelector((s) => s.personality.questions);
  const currentIndex = useAppSelector((s) => s.personality.currentQuestionIndex);
  const answers = useAppSelector((s) => s.personality.answers);
  const testStatus = useAppSelector((s) => s.personality.testStatus);
  const isRetake = useAppSelector((s) => s.personality.isRetake);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch questions on mount
  useEffect(() => {
    if (questions.length > 0) return;

    let cancelled = false;

    async function load() {
      try {
        dispatch(setTestStatus('loading'));
        const data = await getQuestions(authFetch);
        if (!cancelled) {
          dispatch(setQuestions(data.questions));
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load questions. Please try again.');
          dispatch(setTestStatus('error'));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [authFetch, dispatch, questions.length]);

  // Submit answers once all questions are answered
  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    dispatch(setTestStatus('submitting'));

    try {
      const result = await submitTest(authFetch, answers, null);

      if (result.success) {
        if (result.tarot_cards) {
          dispatch(setTarotCards(result.tarot_cards));
        }
        if (result.dimensions) {
          dispatch(setDimensions(result.dimensions));
        }
        dispatch(setOnboardingStep('tarot'));
      } else {
        setError(result.error || 'Submission failed.');
        dispatch(setTestStatus('error'));
      }
    } catch {
      setError('Failed to submit answers. Please try again.');
      dispatch(setTestStatus('error'));
    } finally {
      setIsSubmitting(false);
    }
  }, [authFetch, answers, dispatch, isSubmitting]);

  // Auto-submit when all questions answered
  useEffect(() => {
    if (
      questions.length > 0 &&
      currentIndex >= questions.length &&
      testStatus === 'in_progress'
    ) {
      handleSubmit();
    }
  }, [currentIndex, questions.length, testStatus, handleSubmit]);

  // Handle option selection
  function handleOptionClick(question: PersonalityQuestion, score: number) {
    dispatch(answerQuestion({ question_id: question.id, score }));
  }

  // Skip test — retake goes back to chat, first-time goes to gender selection
  function handleSkip() {
    dispatch(setOnboardingStep(isRetake ? 'done' : 'gender'));
  }

  // Loading state
  if (testStatus === 'loading' || questions.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', paddingTop: '80px', paddingBottom: '80px' }}>
        <div style={{
          height: '32px',
          width: '32px',
          borderRadius: '50%',
          borderWidth: '2px',
          borderStyle: 'solid',
          borderColor: 'rgba(255,255,255,0.2)',
          borderTopColor: '#6BA3D6',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>Loading questions...</p>
      </div>
    );
  }

  // Submitting state
  if (isSubmitting || testStatus === 'submitting') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', paddingTop: '80px', paddingBottom: '80px' }}>
        <div style={{
          height: '32px',
          width: '32px',
          borderRadius: '50%',
          borderWidth: '2px',
          borderStyle: 'solid',
          borderColor: 'rgba(255,255,255,0.2)',
          borderTopColor: '#6BA3D6',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>Analyzing your soul...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', paddingTop: '80px', paddingBottom: '80px', textAlign: 'center' }}>
        <p style={{ color: '#f87171' }}>{error}</p>
        <button
          onClick={() => {
            setError(null);
            dispatch(setTestStatus('idle'));
            dispatch(setQuestions([]));
          }}
          style={{
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.1)',
            paddingLeft: '24px',
            paddingRight: '24px',
            paddingTop: '8px',
            paddingBottom: '8px',
            fontSize: '0.875rem',
            transition: 'background 0.2s',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // All answered — waiting for submit
  if (currentIndex >= questions.length) {
    return null;
  }

  const question = questions[currentIndex];
  const total = questions.length;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '32px', animation: 'fadeInUp 0.4s ease-out' }}
      key={`q-${currentIndex}`}
    >
      {/* Progress indicator */}
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>
          {currentIndex + 1} / {total}
        </span>
      </div>

      {/* Question text */}
      <h2 style={{ textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.6, color: 'rgba(255,255,255,0.9)' }}>
        {question.text}
      </h2>

      {/* Hint (if provided) */}
      {question.hint && (
        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'rgba(255,255,255,0.4)' }}>{question.hint}</p>
      )}

      {/* Options — grid layout for many short options (e.g. MBTI), column for normal */}
      {(() => {
        const isCompact = question.options.length > 6;
        return (
          <div
            style={
              isCompact
                ? { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }
                : { display: 'flex', flexDirection: 'column', gap: '12px' }
            }
          >
            {question.options.map((opt, idx) => {
              const isObject = typeof opt === 'object';
              const text = isObject ? (opt as PersonalityOption).text : (opt as string);
              const score = isObject ? (opt as PersonalityOption).score : idx + 1;

              return (
                <button
                  key={idx}
                  onClick={() => handleOptionClick(question, score)}
                  style={{
                    width: '100%',
                    borderRadius: isCompact ? '10px' : '16px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)',
                    padding: isCompact ? '10px 8px' : '16px 24px',
                    textAlign: isCompact ? 'center' : 'left',
                    color: 'rgba(255,255,255,0.8)',
                    backdropFilter: 'blur(4px)',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                    fontSize: isCompact ? '0.8rem' : '0.875rem',
                    fontWeight: isCompact ? 600 : 400,
                    letterSpacing: isCompact ? '0.5px' : undefined,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(107,163,214,0.5)';
                    e.currentTarget.style.background = 'rgba(107,163,214,0.1)';
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.8)';
                  }}
                >
                  <span>{text}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Skip / Close button */}
      <div style={{ paddingTop: '16px', textAlign: 'center' }}>
        <button
          onClick={handleSkip}
          style={{
            fontSize: '0.875rem',
            color: 'rgba(255,255,255,0.3)',
            transition: 'color 0.2s',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
        >
          {isRetake ? 'Close' : 'Skip personality test'}
        </button>
      </div>
    </div>
  );
}
