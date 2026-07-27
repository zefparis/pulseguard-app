/**
 * PulseGuard — Cognitive Re-test (inactivity-triggered)
 *
 * Runs a 3-test subset (Reflex → Stroop → N-Back) of the full enrollment
 * battery when the app returns to foreground after prolonged inactivity
 * (≥ 4 × checkFrequencyMs). Submits results via the standard /signals
 * endpoint with trigger_reason: 'inactivity_retest' so the backend can
 * distinguish re-tests from normal periodic checks.
 *
 * Reuses the same screen components as PulseGuardEnrollment — no duplication
 * of test logic. The cognitive summary is computed with the same engine
 * (computeCognitiveSummary), with absent tests left as null (the scoring
 * engine handles partial completion gracefully).
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useState, useRef, useCallback } from 'react';
import { BehaviorSession } from '../demoguard/behavior/behaviorSession';
import { computeCognitiveSummary } from '../demoguard/cognitive/cognitiveScoring';
import type {
  CognitiveSignals,
  ReflexSignal,
  StroopSignal,
  NBackSignal,
} from '../demoguard/cognitive/cognitiveTypes';
import { ReflexScreen } from '../screens/ReflexScreen';
import { StroopScreen } from '../screens/StroopScreen';
import { NBackScreen } from '../screens/NBackScreen';
import { submitPulseGuardSnapshot, type PulseGuardSnapshotPayload, type PulseGuardApiError } from '../pulseguard/api';
import { PULSEGUARD_SOURCE, PULSEGUARD_VERSION } from '../pulseguard/constants';
import { useI18n } from '../i18n/I18nContext';

type RetestPhase = 'intro' | 'reflex' | 'stroop' | 'n_back' | 'submitting' | 'done' | 'error';

interface Props {
  linkToken: string;
  onComplete: () => void;
}

export function PulseGuardCognitiveRetest({ linkToken, onComplete }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<RetestPhase>('intro');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessionRef = useRef<BehaviorSession>(new BehaviorSession());
  const signalsRef = useRef<CognitiveSignals>({
    reflex: null,
    stroop: null,
    digit_span: null,
    n_back: null,
    trail_tap: null,
    vocal_ran: null,
    summary: null,
  });

  const startRetest = () => {
    sessionRef.current = new BehaviorSession();
    signalsRef.current = {
      reflex: null,
      stroop: null,
      digit_span: null,
      n_back: null,
      trail_tap: null,
      vocal_ran: null,
      summary: null,
    };
    setPhase('reflex');
  };

  const submitRetest = useCallback(async () => {
    setPhase('submitting');
    setErrorMessage(null);

    const signals = signalsRef.current;
    const summary = computeCognitiveSummary(signals);
    signals.summary = summary;

    const behavior = sessionRef.current.getPayload();
    const touchDiagnosticsBehavior = sessionRef.current.getTouchDiagnostics();

    const payload: PulseGuardSnapshotPayload = {
      hcs_session_public_id: `pg_${linkToken.slice(-12)}`,
      source: PULSEGUARD_SOURCE,
      link_token: linkToken,
      pulse_guard: {
        version: PULSEGUARD_VERSION,
        snapshot_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        signals: {
          cognitive_signals: {
            reflex: signals.reflex,
            stroop: signals.stroop,
            n_back: signals.n_back,
            summary,
          },
          behavior,
          touchDiagnosticsBehavior,
        },
        trigger_reason: 'inactivity_retest',
      },
    };

    try {
      await submitPulseGuardSnapshot(payload);
      setPhase('done');
    } catch (err) {
      const isApiError = (e: unknown): e is PulseGuardApiError =>
        e instanceof Error && e.name === 'PulseGuardApiError';
      const msg = isApiError(err) ? err.message : 'Re-test submission failed';
      setErrorMessage(msg);
      setPhase('error');
    }
  }, [linkToken]);

  const onReflexComplete = (signal: ReflexSignal) => {
    signalsRef.current.reflex = signal;
    setPhase('stroop');
  };

  const onStroopComplete = (signal: StroopSignal) => {
    signalsRef.current.stroop = signal;
    setPhase('n_back');
  };

  const onNBackComplete = (signal: NBackSignal) => {
    signalsRef.current.n_back = signal;
    submitRetest();
  };

  const onError = (reason: string) => {
    setErrorMessage(reason);
    setPhase('error');
  };

  if (phase === 'intro') {
    return (
      <div className="screen-center">
        <div style={{ fontSize: 48 }}>🧠</div>
        <h1>{t('retest.title')}</h1>
        <p className="muted" style={{ maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>
          {t('retest.intro')}
        </p>
        <button className="btn" onClick={startRetest} style={{ marginTop: 24, width: '80%' }}>
          {t('retest.start')}
        </button>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="screen-center">
        <div className="spinner" />
        <p className="muted">{t('retest.submitting')}</p>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="screen-center">
        <div style={{ fontSize: 48 }}>✅</div>
        <h1>{t('retest.complete')}</h1>
        <p className="muted" style={{ maxWidth: 320, textAlign: 'center' }}>
          {t('retest.completeDesc')}
        </p>
        <button className="btn" onClick={onComplete} style={{ marginTop: 24, width: '80%' }}>
          {t('retest.continue')}
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="screen-center">
        <div style={{ fontSize: 48 }}>⚠️</div>
        <h1>{t('retest.error')}</h1>
        <p className="muted" style={{ maxWidth: 320, textAlign: 'center' }}>
          {errorMessage}
        </p>
        <button className="btn" onClick={startRetest} style={{ marginTop: 24, width: '80%' }}>
          {t('retest.retry')}
        </button>
      </div>
    );
  }

  const session = sessionRef.current;

  switch (phase) {
    case 'reflex':
      return <ReflexScreen session={session} onComplete={onReflexComplete} onError={onError} />;
    case 'stroop':
      return <StroopScreen session={session} onComplete={onStroopComplete} onError={onError} />;
    case 'n_back':
      return <NBackScreen session={session} onComplete={onNBackComplete} onError={onError} />;
    default:
      return null;
  }
}
