'use client';

/**
 * PersonalityQuestions — personality test questionnaire.
 *
 * Shows one question at a time with multiple-choice options.
 * Progress indicator ("3 / 10"), skip button at bottom.
 * Questions fetched from the API, answers submitted on completion.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useT } from '@/hooks/useT';
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
  const t = useT();

  const questions = useAppSelector((s) => s.personality.questions);
  const currentIndex = useAppSelector((s) => s.personality.currentQuestionIndex);
  const answers = useAppSelector((s) => s.personality.answers);
  const testStatus = useAppSelector((s) => s.personality.testStatus);
  const isRetake = useAppSelector((s) => s.personality.isRetake);
  const language = useAppSelector((s) => s.settings.language);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track which language the cached questions were fetched in. When the user
  // toggles the EN/中文 button mid-test, clear the cache so the effect below
  // refetches in the new language.
  const fetchedLangRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedLangRef.current && fetchedLangRef.current !== language && questions.length > 0) {
      dispatch(setQuestions([]));
    }
  }, [language, questions.length, dispatch]);

  // Fetch questions on mount + when cache is cleared due to language change.
  useEffect(() => {
    if (questions.length > 0) return;

    let cancelled = false;

    async function load() {
      try {
        dispatch(setTestStatus('loading'));
        // Backend accepts `?lang=en|zh-CN` (see app_new.py
        // /api/personality-test/questions). Default getQuestions(authFetch)
        // would send lang='en' regardless of user's current setting — pass
        // the live value so the test follows the language toggle.
        const data = await getQuestions(authFetch, language);
        if (!cancelled) {
          fetchedLangRef.current = language;
          dispatch(setQuestions(data.questions));
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('test.error.load'));
          dispatch(setTestStatus('error'));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [authFetch, dispatch, questions.length, language, t]);

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
        setError(result.error || t('test.error.submit'));
        dispatch(setTestStatus('error'));
      }
    } catch {
      setError(t('test.error.submit'));
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
          borderColor: 'var(--ink-line)',
          borderTopColor: 'var(--seal)',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ fontSize: '0.875rem', color: 'var(--ink-soft)' }}>{t('test.loading')}</p>
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
          borderColor: 'var(--ink-line)',
          borderTopColor: 'var(--seal)',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ fontSize: '0.875rem', color: 'var(--ink-soft)' }}>{t('test.submitting')}</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', paddingTop: '80px', paddingBottom: '80px', textAlign: 'center' }}>
        <p style={{ color: 'var(--seal)' }}>{error}</p>
        <button
          onClick={() => {
            setError(null);
            dispatch(setTestStatus('idle'));
            dispatch(setQuestions([]));
          }}
          style={{
            borderRadius: 'var(--r-md)',
            background: 'rgba(26,26,28,0.05)',
            border: '1px solid var(--ink-line)',
            paddingLeft: '24px',
            paddingRight: '24px',
            paddingTop: '8px',
            paddingBottom: '8px',
            fontSize: '0.875rem',
            color: 'var(--ink)',
            fontFamily: 'var(--font-body)',
            transition: 'background 0.2s',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(26,26,28,0.10)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(26,26,28,0.05)'; }}
        >
          {t('test.try_again')}
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
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--ink-soft)' }}>
          {currentIndex + 1} / {total}
        </span>
      </div>

      {/* Question text */}
      <h2 style={{ textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.6, color: 'var(--ink)' }}>
        {question.text}
      </h2>

      {/* Hint (if provided) */}
      {question.hint && (
        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--ink-faint)' }}>{question.hint}</p>
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
                    borderRadius: isCompact ? 'var(--r-sm)' : 'var(--r-md)',
                    border: '1px solid var(--ink-line)',
                    background: 'rgba(26, 26, 28, 0.03)',
                    padding: isCompact ? '10px 8px' : '16px 24px',
                    textAlign: isCompact ? 'center' : 'left',
                    color: 'var(--ink)',
                    fontFamily: 'var(--font-body)',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                    fontSize: isCompact ? '0.8rem' : '0.95rem',
                    fontWeight: isCompact ? 600 : 500,
                    letterSpacing: isCompact ? '0.5px' : undefined,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--seal)';
                    e.currentTarget.style.background = 'rgba(184, 49, 47, 0.08)';
                    e.currentTarget.style.color = 'var(--ink)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ink-line)';
                    e.currentTarget.style.background = 'rgba(26, 26, 28, 0.03)';
                    e.currentTarget.style.color = 'var(--ink)';
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
            color: 'var(--ink-soft)',
            fontFamily: 'var(--font-body)',
            textDecoration: 'underline',
            textUnderlineOffset: '4px',
            textDecorationColor: 'var(--ink-line)',
            transition: 'color 0.2s, text-decoration-color 0.2s',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--ink)';
            e.currentTarget.style.textDecorationColor = 'var(--ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--ink-soft)';
            e.currentTarget.style.textDecorationColor = 'var(--ink-line)';
          }}
        >
          {isRetake ? t('test.close') : t('test.skip')}
        </button>
      </div>
    </div>
  );
}
