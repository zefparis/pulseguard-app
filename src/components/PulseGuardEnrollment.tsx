/**
 * PulseGuard — Cognitive Enrollment Orchestrator
 *
 * Runs the 6-test cognitive battery (reflex → stroop → digit span →
 * n-back → trail tap → vocal RAN) with behavior recording, computes
 * the cognitive summary, and submits the enrollment payload to the
 * backend. On success, transitions to periodic monitoring.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useState, useRef, useCallback } from 'react';
import { BehaviorSession } from '../demoguard/behavior/behaviorSession';
import { computeCognitiveSummary } from '../demoguard/cognitive/cognitiveScoring';
import type {
  CognitiveSignals,
  CognitiveQuality,
  ReflexSignal,
  StroopSignal,
  DigitSpanSignal,
  NBackSignal,
  TrailTapSignal,
  VocalRanSignal,
} from '../demoguard/cognitive/cognitiveTypes';
import { ReflexScreen } from '../screens/ReflexScreen';
import { StroopScreen } from '../screens/StroopScreen';
import { DigitSpanScreen } from '../screens/DigitSpanScreen';
import { NBackScreen } from '../screens/NBackScreen';
import { TrailTapScreen } from '../screens/TrailTapScreen';
import { VoiceScreen } from '../screens/VoiceScreen';
import { submitPulseGuardEnrollment, submitPulseGuardTestProgress, type PulseGuardEnrollmentPayload, type PulseGuardApiError, type PulseGuardTestProgressPayload } from '../pulseguard/api';
import { PULSEGUARD_SOURCE } from '../pulseguard/constants';
import { useI18n } from '../i18n/I18nContext';
import type { DemoGuardVoiceSignal, VoiceDiagnosticsSafe } from '../demoguard/types';

// ─── Per-test qualitative summaries (no raw data, safe for SSE) ───────

const TEST_ORDER = ['reflex', 'stroop', 'digit_span', 'n_back', 'trail_tap', 'vocal_ran'] as const;
const TOTAL_TESTS = TEST_ORDER.length;

function summarizeReflex(s: ReflexSignal): string {
  if (s.avg_ms < 250) return 'fast_reactions';
  if (s.avg_ms <= 400) return 'normal_reactions';
  return 'slow_reactions';
}

function summarizeStroop(s: StroopSignal): string {
  if (s.accuracy > 0.8) return 'good_concentration';
  if (s.accuracy >= 0.5) return 'average_concentration';
  return 'concentration_difficulties';
}

function summarizeDigitSpan(s: DigitSpanSignal): string {
  if (s.max_span >= 7) return 'good_memory';
  if (s.max_span >= 5) return 'average_memory';
  return 'memory_difficulties';
}

function summarizeNBack(s: NBackSignal): string {
  if (s.accuracy > 0.8) return 'good_attention';
  if (s.accuracy >= 0.5) return 'average_attention';
  return 'attention_difficulties';
}

function summarizeTrailTap(s: TrailTapSignal): string {
  if (s.completion_ms < 15000) return 'fluid_execution';
  if (s.completion_ms <= 25000) return 'average_execution';
  return 'slow_execution';
}

function summarizeVocalRan(s: VocalRanSignal): string {
  if (s.quality === 'ok') return 'clear_voice';
  if (s.quality === 'review') return 'voice_to_verify';
  return 'voice_issue';
}

function buildTestProgressPayload(
  testName: typeof TEST_ORDER[number],
  testIndex: number,
  quality: CognitiveQuality,
  qualitativeSummary: string,
  linkToken: string,
): PulseGuardTestProgressPayload {
  return {
    hcs_session_public_id: `pg_${linkToken.slice(-12)}`,
    link_token: linkToken,
    source: PULSEGUARD_SOURCE,
    test_name: testName,
    test_index: testIndex,
    total_tests: TOTAL_TESTS,
    quality,
    qualitative_summary: qualitativeSummary,
  };
}

function sendTestProgress(
  testName: typeof TEST_ORDER[number],
  testIndex: number,
  quality: CognitiveQuality,
  qualitativeSummary: string,
  linkToken: string,
): void {
  const payload = buildTestProgressPayload(testName, testIndex, quality, qualitativeSummary, linkToken);
  void submitPulseGuardTestProgress(payload).catch((err) => {
    console.warn(`[PULSEGUARD_ENROLLMENT] test progress failed for ${testName} (suppressed):`, err instanceof Error ? err.message : String(err));
  });
}

type EnrollmentPhase =
  | 'intro'
  | 'reflex'
  | 'stroop'
  | 'digit_span'
  | 'n_back'
  | 'trail_tap'
  | 'vocal_ran'
  | 'submitting'
  | 'done'
  | 'error';

interface Props {
  linkToken: string;
  onComplete: () => void;
}

export function PulseGuardEnrollment({ linkToken, onComplete }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<EnrollmentPhase>('intro');
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
  const voiceDiagnosticsRef = useRef<VoiceDiagnosticsSafe | null>(null);
  const voiceB64Ref = useRef<string | null>(null);
  const voiceMimetypeRef = useRef<string | null>(null);
  const voiceNonceRef = useRef<string | null>(null);
  const voiceChallengeIdRef = useRef<string | null>(null);

  const startEnrollment = () => {
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
    voiceDiagnosticsRef.current = null;
    voiceB64Ref.current = null;
    voiceMimetypeRef.current = null;
    voiceNonceRef.current = null;
    voiceChallengeIdRef.current = null;
    setPhase('reflex');
  };

  const submitEnrollment = useCallback(async () => {
    setPhase('submitting');
    setErrorMessage(null);

    const signals = signalsRef.current;
    const summary = computeCognitiveSummary(signals);
    signals.summary = summary;

    const behavior = sessionRef.current.getPayload();
    const touchDiagnosticsBehavior = sessionRef.current.getTouchDiagnostics();

    const payload: PulseGuardEnrollmentPayload = {
      hcs_session_public_id: `pg_${linkToken.slice(-12)}`,
      link_token: linkToken,
      source: PULSEGUARD_SOURCE,
      cognitive_signals: {
        reflex: signals.reflex,
        stroop: signals.stroop,
        digit_span: signals.digit_span,
        n_back: signals.n_back,
        trail_tap: signals.trail_tap,
        vocal_ran: signals.vocal_ran,
        summary,
      },
      behavior,
      touchDiagnosticsBehavior,
      voice_diagnostics: voiceDiagnosticsRef.current,
      sensitive: voiceB64Ref.current
        ? {
            voice_b64: voiceB64Ref.current,
            voice_mimetype: voiceMimetypeRef.current ?? undefined,
            voice_nonce: voiceNonceRef.current ?? undefined,
            voice_challenge_id: voiceChallengeIdRef.current ?? undefined,
          }
        : undefined,
    };

    try {
      await submitPulseGuardEnrollment(payload);
      setPhase('done');
    } catch (err) {
      const isApiError = (e: unknown): e is PulseGuardApiError =>
        e instanceof Error && e.name === 'PulseGuardApiError';
      const msg = isApiError(err) ? err.message : 'Enrollment submission failed';
      setErrorMessage(msg);
      setPhase('error');
    }
  }, [linkToken]);

  // ── Screen completion handlers ──

  const onReflexComplete = (signal: ReflexSignal) => {
    signalsRef.current.reflex = signal;
    sendTestProgress('reflex', 1, signal.quality, summarizeReflex(signal), linkToken);
    setPhase('stroop');
  };

  const onStroopComplete = (signal: StroopSignal) => {
    signalsRef.current.stroop = signal;
    sendTestProgress('stroop', 2, signal.quality, summarizeStroop(signal), linkToken);
    setPhase('digit_span');
  };

  const onDigitSpanComplete = (signal: DigitSpanSignal) => {
    signalsRef.current.digit_span = signal;
    sendTestProgress('digit_span', 3, signal.quality, summarizeDigitSpan(signal), linkToken);
    setPhase('n_back');
  };

  const onNBackComplete = (signal: NBackSignal) => {
    signalsRef.current.n_back = signal;
    sendTestProgress('n_back', 4, signal.quality, summarizeNBack(signal), linkToken);
    setPhase('trail_tap');
  };

  const onTrailTapComplete = (signal: TrailTapSignal) => {
    signalsRef.current.trail_tap = signal;
    sendTestProgress('trail_tap', 5, signal.quality, summarizeTrailTap(signal), linkToken);
    setPhase('vocal_ran');
  };

  const onVocalRanComplete = (
    _voice: DemoGuardVoiceSignal,
    diagnostic: VoiceDiagnosticsSafe | null,
    voiceB64: string | null,
    vocalRan: VocalRanSignal,
    voiceMimetype: string | null,
    voiceNonce: string | null,
    voiceChallengeId: string | null,
  ) => {
    signalsRef.current.vocal_ran = vocalRan;
    sendTestProgress('vocal_ran', 6, vocalRan.quality, summarizeVocalRan(vocalRan), linkToken);
    voiceDiagnosticsRef.current = diagnostic;
    voiceB64Ref.current = voiceB64;
    voiceMimetypeRef.current = voiceMimetype;
    voiceNonceRef.current = voiceNonce;
    voiceChallengeIdRef.current = voiceChallengeId;
    submitEnrollment();
  };

  const onError = (reason: string) => {
    setErrorMessage(reason);
    setPhase('error');
  };

  // ── Render ──

  if (phase === 'intro') {
    return (
      <div className="screen-center">
        <div style={{ fontSize: 48 }}>🧠</div>
        <h1>{t('enrollment.title')}</h1>
        <p className="muted" style={{ maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>
          {t('enrollment.intro')}
        </p>
        <button className="btn" onClick={startEnrollment} style={{ marginTop: 24, width: '80%' }}>
          {t('enrollment.start')}
        </button>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="screen-center">
        <div className="spinner" />
        <p className="muted">{t('enrollment.submitting')}</p>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="screen-center">
        <div style={{ fontSize: 48 }}>✅</div>
        <h1>{t('enrollment.complete')}</h1>
        <p className="muted" style={{ maxWidth: 320, textAlign: 'center' }}>
          {t('enrollment.completeDesc')}
        </p>
        <button className="btn" onClick={onComplete} style={{ marginTop: 24, width: '80%' }}>
          {t('enrollment.continue')}
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="screen-center">
        <div style={{ fontSize: 48 }}>⚠️</div>
        <h1>{t('enrollment.error')}</h1>
        <p className="muted" style={{ maxWidth: 320, textAlign: 'center' }}>
          {errorMessage}
        </p>
        <button className="btn" onClick={startEnrollment} style={{ marginTop: 24, width: '80%' }}>
          {t('enrollment.retry')}
        </button>
      </div>
    );
  }

  // ── Cognitive test screens ──

  const session = sessionRef.current;

  switch (phase) {
    case 'reflex':
      return <ReflexScreen session={session} onComplete={onReflexComplete} onError={onError} />;
    case 'stroop':
      return <StroopScreen session={session} onComplete={onStroopComplete} onError={onError} />;
    case 'digit_span':
      return <DigitSpanScreen session={session} onComplete={onDigitSpanComplete} onError={onError} />;
    case 'n_back':
      return <NBackScreen session={session} onComplete={onNBackComplete} onError={onError} />;
    case 'trail_tap':
      return <TrailTapScreen session={session} onComplete={onTrailTapComplete} onError={onError} />;
    case 'vocal_ran':
      return <VoiceScreen sessionPublicId={`pg_${linkToken.slice(-12)}`} session={session} onComplete={onVocalRanComplete} onError={onError} />;
    default:
      return null;
  }
}
