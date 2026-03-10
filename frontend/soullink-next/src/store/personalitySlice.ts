import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  PersonalityQuestion,
  PersonalityAnswer,
  TarotCard,
  PersonalityResult,
} from '@/types';

// ==================== Types ====================

type TestStatus = 'idle' | 'loading' | 'in_progress' | 'submitting' | 'completed' | 'error';

/**
 * Onboarding step progression:
 *   questions -> tarot -> results -> gender -> relationship -> subtype -> naming -> done
 */
type OnboardingStep =
  | 'idle'
  | 'questions'
  | 'tarot'
  | 'results'
  | 'gender'
  | 'relationship'
  | 'subtype'
  | 'naming'
  | 'done';

interface PersonalityState {
  /** Current status of the personality test flow */
  testStatus: TestStatus;

  /** Questions fetched from the API */
  questions: PersonalityQuestion[];
  /** Index of the question currently displayed */
  currentQuestionIndex: number;
  /** User's answers (question_id -> score) */
  answers: PersonalityAnswer[];
  /** MBTI type determined after answering */
  mbtiType: string | null;
  /** Dimension scores from the test */
  dimensions: Record<string, number>;

  /** Tarot cards drawn after the test */
  tarotCards: TarotCard[];

  /** Full personality result from the API */
  results: PersonalityResult | null;

  /** Current step in the onboarding wizard */
  onboardingStep: OnboardingStep;

  /** Whether this is a retake from sidebar (skip gender/relationship/subtype/naming) */
  isRetake: boolean;

  /** Selected companion gender during onboarding */
  selectedGender: string | null;
  /** Selected relationship type during onboarding */
  selectedRelationship: string | null;
  /** Selected companion subtype during onboarding */
  selectedSubtype: string | null;
}

const initialState: PersonalityState = {
  testStatus: 'idle',
  questions: [],
  currentQuestionIndex: 0,
  answers: [],
  mbtiType: null,
  dimensions: {},
  tarotCards: [],
  results: null,
  onboardingStep: 'idle',
  isRetake: false,
  selectedGender: null,
  selectedRelationship: null,
  selectedSubtype: null,
};

// ==================== Slice ====================

const personalitySlice = createSlice({
  name: 'personality',
  initialState,
  reducers: {
    /** Set the overall test status */
    setTestStatus(state, action: PayloadAction<TestStatus>) {
      state.testStatus = action.payload;
    },

    /** Load questions from the API and start the test */
    setQuestions(state, action: PayloadAction<PersonalityQuestion[]>) {
      state.questions = action.payload;
      state.currentQuestionIndex = 0;
      state.answers = [];
      state.mbtiType = null;
      state.dimensions = {};
      state.testStatus = 'in_progress';
    },

    /** Record an answer and advance to the next question */
    answerQuestion(state, action: PayloadAction<PersonalityAnswer>) {
      state.answers.push(action.payload);
      state.currentQuestionIndex += 1;
    },

    /** Set the MBTI type after the questionnaire phase */
    setMbtiType(state, action: PayloadAction<string>) {
      state.mbtiType = action.payload;
    },

    /** Store dimension scores from the test results */
    setDimensions(state, action: PayloadAction<Record<string, number>>) {
      state.dimensions = action.payload;
    },

    /** Set the tarot cards drawn after the test */
    setTarotCards(state, action: PayloadAction<TarotCard[]>) {
      state.tarotCards = action.payload;
    },

    /** Store the full personality result */
    setResults(state, action: PayloadAction<PersonalityResult>) {
      state.results = action.payload;
      state.testStatus = 'completed';
    },

    /** Advance to a specific onboarding step */
    setOnboardingStep(state, action: PayloadAction<OnboardingStep>) {
      state.onboardingStep = action.payload;
    },

    /** Select companion gender */
    selectGender(state, action: PayloadAction<string>) {
      state.selectedGender = action.payload;
    },

    /** Select relationship type */
    selectRelationship(state, action: PayloadAction<string>) {
      state.selectedRelationship = action.payload;
    },

    /** Select companion subtype */
    selectSubtype(state, action: PayloadAction<string>) {
      state.selectedSubtype = action.payload;
    },

    /** Mark this session as a retake (skip post-results onboarding steps) */
    setRetake(state, action: PayloadAction<boolean>) {
      state.isRetake = action.payload;
    },

    /** Reset the entire personality test state (e.g. to retake) */
    resetTest(state) {
      Object.assign(state, initialState);
    },
  },
});

export const {
  setTestStatus,
  setQuestions,
  answerQuestion,
  setMbtiType,
  setDimensions,
  setTarotCards,
  setResults,
  setOnboardingStep,
  setRetake,
  selectGender,
  selectRelationship,
  selectSubtype,
  resetTest,
} = personalitySlice.actions;

export default personalitySlice.reducer;
