/**
 * Personality Test API functions.
 *
 * Handles the personality questionnaire flow:
 * check status, fetch questions, and submit answers.
 */

import { PERSONALITY } from './endpoints';
import type { AuthFetchFn } from './client';
import type {
  PersonalityTestStatus,
  PersonalityQuestion,
  PersonalityAnswer,
  PersonalityTestResult,
} from '@/types';

/**
 * Check whether the current user has already completed the personality test.
 */
export async function getTestStatus(
  authFetch: AuthFetchFn,
): Promise<PersonalityTestStatus> {
  const response = await authFetch(PERSONALITY.STATUS);

  if (!response.ok) {
    throw new Error(`Failed to check personality test status: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch the personality test questions.
 *
 * @param lang - Language code ('en' or 'zh-CN') for localized questions.
 */
export async function getQuestions(
  authFetch: AuthFetchFn,
  lang: string = 'en',
): Promise<{ questions: PersonalityQuestion[] }> {
  const response = await authFetch(`${PERSONALITY.QUESTIONS}?lang=${lang}`);

  if (!response.ok) {
    throw new Error(`Failed to load personality test questions: ${response.status}`);
  }

  return response.json();
}

/**
 * Submit the completed personality test answers.
 *
 * @param answers - Array of question/score pairs from the normal questions.
 * @param mbti - User's self-reported MBTI type, or null if skipped.
 */
export async function submitTest(
  authFetch: AuthFetchFn,
  answers: PersonalityAnswer[],
  mbti: string | null,
): Promise<PersonalityTestResult> {
  const response = await authFetch(PERSONALITY.SUBMIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, mbti }),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit personality test: ${response.status}`);
  }

  return response.json();
}
