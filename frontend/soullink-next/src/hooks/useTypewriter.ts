'use client';

/**
 * DOM-based typewriter effect hook.
 *
 * Instead of updating React state per character (which would cause
 * excessive re-renders), this hook directly manipulates a DOM container
 * to append characters one at a time with realistic timing.
 *
 * Speed profile:
 *   - Normal characters: 20ms
 *   - Punctuation (.,!?;:): 30-40ms
 *   - Queue backlog (>50 chars waiting): 5-10ms (catch up fast)
 */

import { useRef, useCallback, type RefObject } from 'react';

/** Punctuation that triggers a longer pause. */
const SLOW_CHARS = new Set(['.', ',', '!', '?', ';', ':', '\u3002', '\uFF0C', '\uFF01', '\uFF1F']);

interface UseTypewriterOptions {
  /** Normal character delay in ms (default: 20). */
  normalDelay?: number;
  /** Punctuation delay in ms (default: 35). */
  punctuationDelay?: number;
  /** Fast catch-up delay when backlog is large (default: 5). */
  fastDelay?: number;
  /** Backlog threshold to switch to fast mode (default: 50). */
  backlogThreshold?: number;
}

interface UseTypewriterReturn {
  /** Enqueue text chunks to be rendered character-by-character. */
  enqueue: (text: string) => void;
  /** Returns a promise that resolves when the queue is fully drained. */
  drain: () => Promise<void>;
  /** Stop the typewriter and clear the queue. */
  stop: () => void;
  /** Get the full accumulated text (what has been rendered so far + queue). */
  getFullText: () => string;
}

export function useTypewriter(
  containerRef: RefObject<HTMLElement | null>,
  options: UseTypewriterOptions = {},
): UseTypewriterReturn {
  const {
    normalDelay = 20,
    punctuationDelay = 35,
    fastDelay = 5,
    backlogThreshold = 50,
  } = options;

  const queueRef = useRef<string[]>([]);
  const isRunningRef = useRef(false);
  const renderedTextRef = useRef('');
  const drainResolversRef = useRef<Array<() => void>>([]);
  const stoppedRef = useRef(false);

  const processQueue = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    stoppedRef.current = false;

    const tick = () => {
      if (stoppedRef.current) {
        isRunningRef.current = false;
        return;
      }

      if (queueRef.current.length === 0) {
        isRunningRef.current = false;
        // Resolve all drain promises.
        const resolvers = drainResolversRef.current.splice(0);
        for (const resolve of resolvers) resolve();
        return;
      }

      const char = queueRef.current.shift()!;
      renderedTextRef.current += char;

      // Append to DOM directly.
      const container = containerRef.current;
      if (container) {
        if (char === '\n') {
          container.appendChild(document.createElement('br'));
        } else {
          container.appendChild(document.createTextNode(char));
        }
      }

      // Calculate delay based on character type and queue backlog.
      let delay: number;
      if (queueRef.current.length > backlogThreshold) {
        delay = fastDelay;
      } else if (SLOW_CHARS.has(char)) {
        delay = punctuationDelay;
      } else {
        delay = normalDelay;
      }

      setTimeout(tick, delay);
    };

    tick();
  }, [containerRef, normalDelay, punctuationDelay, fastDelay, backlogThreshold]);

  const enqueue = useCallback(
    (text: string) => {
      for (const char of text) {
        queueRef.current.push(char);
      }
      processQueue();
    },
    [processQueue],
  );

  const drain = useCallback((): Promise<void> => {
    if (queueRef.current.length === 0 && !isRunningRef.current) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      drainResolversRef.current.push(resolve);
    });
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    isRunningRef.current = false;
    // Resolve any pending drain promises.
    const resolvers = drainResolversRef.current.splice(0);
    for (const resolve of resolvers) resolve();
  }, []);

  const getFullText = useCallback(() => {
    return renderedTextRef.current + queueRef.current.join('');
  }, []);

  return { enqueue, drain, stop, getFullText };
}
