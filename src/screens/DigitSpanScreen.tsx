/**
 * PulseGuard — DigitSpanScreen (memory sequence test)
 *
 * Adapted from DemoGuard for cognitive enrollment (no camera phase).
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useEffect, useState, useRef } from 'react';
import {
  generateDigitSpanTrials,
  evaluateDigitSpanTrial,
  computeDigitSpanResult,
} from '../demoguard/cognitive/digitSpanChallenge';
import type { DigitSpanSignal } from '../demoguard/cognitive/cognitiveTypes';
import type { DigitSpanTrialConfig, DigitSpanTrialResult } from '../demoguard/cognitive/digitSpanChallenge';
import { recordTaskStart, recordDigitSpanKey, recordDigitSpanSubmit } from '../demoguard/behavior/taskBehaviorRecorder';
import type { BehaviorSession } from '../demoguard/behavior/behaviorSession';
import { PhaseHeader } from '../components/PhaseHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useI18n } from '../i18n/I18nContext';

interface Props {
  session: BehaviorSession;
  onComplete: (signal: DigitSpanSignal) => void;
  onError: (reason: string) => void;
}

export function DigitSpanScreen({ session, onComplete }: Props) {
  const { t } = useI18n();
  const [trials] = useState<DigitSpanTrialConfig[]>(() => generateDigitSpanTrials());
  const [trialIdx, setTrialIdx] = useState(0);
  const [results, setResults] = useState<DigitSpanTrialResult[]>([]);
  const [showing, setShowing] = useState(true);
  const [input, setInput] = useState<number[]>([]);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    recordTaskStart(session, 'digit_span');
    showSequence();
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

  const showSequence = () => {
    setShowing(true);
    setInput([]);
    const span = trials[trialIdx].span;
    const duration = span * 800 + 500;
    showTimerRef.current = setTimeout(() => {
      setShowing(false);
    }, duration);
  };

  const handleDigit = (d: number) => {
    const newInput = [...input, d];
    setInput(newInput);
    recordDigitSpanKey(session, false);
  };

  const handleDelete = () => {
    if (input.length > 0) {
      setInput(input.slice(0, -1));
      recordDigitSpanKey(session, true);
    }
  };

  const handleSubmit = () => {
    const config = trials[trialIdx];
    const result = evaluateDigitSpanTrial(config, input);
    recordDigitSpanSubmit(session);
    const newResults = [...results, result];
    setResults(newResults);

    if (trialIdx + 1 >= trials.length) {
      const signal = computeDigitSpanResult(newResults);
      onComplete(signal);
    } else {
      setTrialIdx(trialIdx + 1);
      setInput([]);
      setTimeout(() => showSequence(), 500);
    }
  };

  const current = trials[trialIdx];

  return (
    <div className="screen">
      <PhaseHeader title={t('digitSpan.title')} progress={`3/6 — ${trialIdx + 1}/${trials.length}`} progressPct={50} />
      <ErrorBoundary onRetry={() => { setTrialIdx(0); setResults([]); showSequence(); }}>
        {showing ? (
          <div className="screen-center">
            <p className="muted">{t('digitSpan.memorize')}</p>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 8 }}>
              {current.sequence.join(' ')}
            </div>
          </div>
        ) : (
          <>
            <div className="screen-center" style={{ flex: '0 0 auto', padding: '16px 0' }}>
              <p className="muted">{t('digitSpan.enter')} ({current.span} {t('digitSpan.digits')}) :</p>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, minHeight: 40 }}>
                {input.join(' ') || '—'}
              </div>
            </div>
            <div className="input-pad">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                <button key={d} onClick={() => handleDigit(d)}>{d}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" onClick={handleDelete} style={{ flex: 1 }}>{t('digitSpan.delete')}</button>
              <button className="btn" onClick={handleSubmit} disabled={input.length === 0} style={{ flex: 1 }}>{t('digitSpan.submit')}</button>
            </div>
          </>
        )}
      </ErrorBoundary>
    </div>
  );
}
