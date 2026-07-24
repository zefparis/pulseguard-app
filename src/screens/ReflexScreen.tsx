/**
 * PulseGuard — ReflexScreen (5-round reaction time test)
 *
 * Adapted from DemoGuard for cognitive enrollment (no camera phase).
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useEffect, useState, useRef } from 'react';
import {
  REFLEX_ROUNDS,
  getRandomReflexDelay,
  evaluateReflexRound,
  computeReflexResult,
} from '../demoguard/cognitive/reflexChallenge';
import type { ReflexSignal } from '../demoguard/cognitive/cognitiveTypes';
import type { ReflexRoundResult } from '../demoguard/cognitive/reflexChallenge';
import { recordTaskStart, recordReflexTap } from '../demoguard/behavior/taskBehaviorRecorder';
import type { BehaviorSession } from '../demoguard/behavior/behaviorSession';
import { PhaseHeader } from '../components/PhaseHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useI18n } from '../i18n/I18nContext';

interface Props {
  session: BehaviorSession;
  onComplete: (signal: ReflexSignal) => void;
  onError: (reason: string) => void;
}

type State = 'waiting' | 'ready' | 'go' | 'too-early' | 'done';

export function ReflexScreen({ session, onComplete }: Props) {
  const { t } = useI18n();
  const [round, setRound] = useState(0);
  const [state, setState] = useState<State>('waiting');
  const [results, setResults] = useState<ReflexRoundResult[]>([]);
  const goTimeRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    recordTaskStart(session, 'reflex');
    startRound();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startRound = () => {
    if (round >= REFLEX_ROUNDS) {
      const signal = computeReflexResult(results);
      onComplete(signal);
      return;
    }
    setState('waiting');
    const delay = getRandomReflexDelay();
    timeoutRef.current = setTimeout(() => {
      goTimeRef.current = performance.now();
      setState('go');
    }, delay);
  };

  const handleTap = () => {
    if (state === 'waiting') {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setState('too-early');
      recordReflexTap(session, 0, true);
      setTimeout(() => startRound(), 1000);
      return;
    }
    if (state === 'go') {
      const ms = performance.now() - goTimeRef.current;
      const result = evaluateReflexRound(ms);
      recordReflexTap(session, ms, result.too_fast);
      const newResults = [...results, result];
      setResults(newResults);
      setRound(round + 1);
      setState('done');
      setTimeout(() => {
        if (round + 1 >= REFLEX_ROUNDS) {
          const signal = computeReflexResult(newResults);
          onComplete(signal);
        } else {
          startRound();
        }
      }, 500);
    }
  };

  const areaClass = state === 'go' ? 'reflex-area go' : state === 'too-early' ? 'reflex-area too-early' : 'reflex-area ready';

  return (
    <div className="screen">
      <PhaseHeader title={t('reflex.title')} progress={`1/6 — ${t('reflex.round')} ${Math.min(round + 1, REFLEX_ROUNDS)}/${REFLEX_ROUNDS}`} progressPct={16} />
      <ErrorBoundary onRetry={() => { setRound(0); setResults([]); startRound(); }}>
        <div className={areaClass} onClick={handleTap}>
          {state === 'waiting' && <p>{t('reflex.waitGreen')}</p>}
          {state === 'go' && <p style={{ fontSize: 24, fontWeight: 700 }}>{t('reflex.tap')}</p>}
          {state === 'too-early' && <p>{t('reflex.tooEarly')}</p>}
          {state === 'done' && <p>{Math.round(results[results.length - 1]?.ms ?? 0)} {t('reflex.ms')}</p>}
        </div>
      </ErrorBoundary>
    </div>
  );
}
