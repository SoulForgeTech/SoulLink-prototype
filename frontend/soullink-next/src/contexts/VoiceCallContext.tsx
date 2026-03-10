'use client';

/**
 * Voice Call Context — provides a SINGLE shared instance of useVoiceCall()
 * to all components in the tree.
 *
 * Why this exists:
 * - useVoiceCall() uses refs for long-lived objects (AudioContext, MediaRecorder, etc.)
 * - Multiple hook instances would have separate refs and couldn't share state
 * - The phone button (page.tsx) needs to call start() in user gesture context
 *   (critical for AudioContext to start in 'running' state, not 'suspended')
 * - VoiceCallOverlay needs stop/isActive/callState/callSeconds from the same instance
 *
 * By lifting the hook into a context provider, both components share the same
 * AudioContext, AnalyserNode, MediaRecorder, etc.
 */

import { createContext, useContext } from 'react';
import { useVoiceCall } from '@/hooks/useVoiceCall';

type VoiceCallContextType = ReturnType<typeof useVoiceCall>;

const VoiceCallContext = createContext<VoiceCallContextType | null>(null);

export function VoiceCallProvider({ children }: { children: React.ReactNode }) {
  const voiceCall = useVoiceCall();
  return (
    <VoiceCallContext.Provider value={voiceCall}>
      {children}
    </VoiceCallContext.Provider>
  );
}

/**
 * Consume the shared voice call instance.
 * Must be used within <VoiceCallProvider>.
 */
export function useVoiceCallContext(): VoiceCallContextType {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) {
    throw new Error('useVoiceCallContext must be used within <VoiceCallProvider>');
  }
  return ctx;
}
