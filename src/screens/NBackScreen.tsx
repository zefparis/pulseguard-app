/**
 * PulseGuard — NBackScreen (1-back matching test) — UX overhaul
 *
 * Adapted from DemoGuard for cognitive enrollment (no camera phase).
 *
 * Phase 1: Intro screen with static visual example
 * Phase 2: 2 practice trials with explicit correct/incorrect feedback
 * Phase 3: Real test (8 trials) with single counter, permanent instruction,
 *          and discreet visual feedback (no answer reveal)
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  NBACK_TRIALS,
  generateNBackTrials,
  evaluateNBackTrial,
  computeNBackResult,
  generateNBackPracticeTrials,
} from '../demoguard/cognitive/nBackChallenge';
import type { NBackSignal } from '../demoguard/cognitive/cognitiveTypes';
import type { NBackTrialConfig, NBackTrialResult } from '../demoguard/cognitive/nBackChallenge';
import { recordTaskStart, recordNBackDecision } from '../demoguard/behavior/taskBehaviorRecorder';
import type { BehaviorSession } from '../demoguard/behavior/behaviorSession';
import { PhaseHeader } from '../components/PhaseHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useI18n } from '../i18n/I18nContext';

type ScreenPhase = 'intro' | 'practice' | 'test';

type FeedbackState = 'none' | 'correct' | 'incorrect' | 'answered';

interface Props {
  session: BehaviorSession;
  onComplete: (signal: NBackSignal) => void;
  onError: (reason: string) => void;
}

export function NBackScreen({ session, onComplete }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<ScreenPhase>('intro');
  const [trials, setTrials] = useState<NBackTrialConfig[]>([]);
  const [practiceTrials] = useState<NBackTrialConfig[]>(() => generateNBackPracticeTrials());
  const [trialIdx, setTrialIdx] = useState(0);
  const [results, setResults] = useState<NBackTrialResult[]>([]);
  const [showing, setShowing] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackState>('none');
  const trialStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    recordTaskStart(session, 'n_back');
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [session]);

  const showTrial = useCallback(() => {
    setShowing(true);
    setFeedback('none');
    trialStartRef.current = performance.now();
    timerRef.current = setTimeout(() => setShowing(false), 2000);
  }, []);

  const startPractice = () => {
    setPhase('practice');
    setTrialIdx(0);
    setResults([]);
    setTimeout(() => showTrial(), 100);
  };

  const startTest = () => {
    const newTrials = generateNBackTrials(NBACK_TRIALS);
    setTrials(newTrials);
    setPhase('test');
    setTrialIdx(0);
    setResults([]);
    setTimeout(() => showTrial(), 100);
  };

  const handleResponse = (saidMatch: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const currentTrials = phase === 'practice' ? practiceTrials : trials;
    const config = currentTrials[trialIdx];
    const responseMs = performance.now() - trialStartRef.current;
    const result = evaluateNBackTrial(config, saidMatch, responseMs);

    if (phase === 'practice') {
      const isCorrect = (config.isTarget && saidMatch) || (!config.isTarget && !saidMatch);
      setFeedback(isCorrect ? 'correct' : 'incorrect');
      const newResults = [...results, result];
      setResults(newResults);

      if (trialIdx + 1 >= practiceTrials.length) {
        setTimeout(() => startTest(), 1200);
      } else {
        setTrialIdx(trialIdx + 1);
        setTimeout(() => showTrial(), 1200);
      }
    } else {
      recordNBackDecision(session, result.isHit || result.isCorrectRejection, responseMs);
      setFeedback('answered');
      const newResults = [...results, result];
      setResults(newResults);

      if (trialIdx + 1 >= trials.length) {
        const signal = computeNBackResult(newResults);
        setTimeout(() => onComplete(signal), 400);
      } else {
        setTrialIdx(trialIdx + 1);
        setTimeout(() => showTrial(), 400);
      }
    }
  };

  // ── Intro Phase ──
  if (phase === 'intro') {
    return (
      <div className="screen">
        <PhaseHeader title={t('nback.title')} progress="4/6" progressPct={66} />
        <div className="nback-intro">
          <p className="nback-intro-title">
            {t('nback.intro.youWillSee')}
          </p>
          <p className="nback-intro-subtitle">
            {t('nback.intro.subtitle')}
          </p>

          <div className="nback-example">
            <div className="nback-example-row">
              <span className="nback-example-letter">C</span>
              <span className="nback-example-arrow">→</span>
              <span className="nback-example-letter">C</span>
              <span className="nback-example-badge nback-example-same">{t('nback.intro.same')}</span>
            </div>
            <div className="nback-example-row">
              <span className="nback-example-letter">F</span>
              <span className="nback-example-arrow">→</span>
              <span className="nback-example-letter">B</span>
              <span className="nback-example-badge nback-example-diff">{t('nback.intro.different')}</span>
            </div>
          </div>

          <p className="muted" style={{ textAlign: 'center', marginBottom: 16 }}>
            {t('nback.intro.practiceInfo')}
          </p>

          <button className="btn" onClick={startPractice} style={{ width: '100%' }}>
            {t('nback.intro.start')}
          </button>
        </div>
      </div>
    );
  }

  // ── Practice / Test Phase ──
  const currentTrials = phase === 'practice' ? practiceTrials : trials;
  const totalTrials = currentTrials.length;
  const isPractice = phase === 'practice';

  return (
    <div className="screen">
      <PhaseHeader
        title={isPractice ? t('nback.training') : t('nback.title')}
        progress={`4/6 — ${trialIdx + 1}/${totalTrials}`}
        progressPct={66}
      />
      <ErrorBoundary onRetry={() => { setTrialIdx(0); setResults([]); showTrial(); }}>
        <div
          className="nback-letter"
          style={
            feedback === 'correct' ? { color: 'var(--success)' }
            : feedback === 'incorrect' ? { color: 'var(--danger)' }
            : undefined
          }
        >
          {showing ? currentTrials[trialIdx].letter : '—'}
        </div>

        {!showing && feedback === 'none' && (
          <>
            <p className="nback-instruction">
              {t('nback.instruction')}
            </p>
            <div className="nback-buttons">
              <button className="btn btn-secondary" onClick={() => handleResponse(false)}>{t('nback.no')}</button>
              <button className="btn" onClick={() => handleResponse(true)}>{t('nback.yes')}</button>
            </div>
          </>
        )}

        {showing && feedback === 'none' && (
          <p className="muted" style={{ textAlign: 'center', minHeight: 24 }}>&nbsp;</p>
        )}

        {feedback === 'correct' && (
          <p className="nback-feedback nback-feedback-correct">{t('nback.correct')}</p>
        )}
        {feedback === 'incorrect' && (
          <p className="nback-feedback nback-feedback-incorrect">
            {currentTrials[trialIdx].isTarget ? t('nback.wasSame') : t('nback.wasDifferent')}
          </p>
        )}
        {feedback === 'answered' && (
          <p className="nback-feedback nback-feedback-answered">✓</p>
        )}
      </ErrorBoundary>
    </div>
  );
}
