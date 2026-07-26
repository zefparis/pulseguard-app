/**
 * PulseGuard — VoiceScreen (voice recording with vocal RAN challenge)
 *
 * Uses real VAD (Voice Activity Detection) recording infrastructure from
 * lib/vadRecorder.ts, identical to DemoGuard's VoiceScreen.
 * 2-phase flow: warm-up (mic calibration) → RAN challenge capture.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useEffect, useState, useRef } from 'react';
import { recordVoiceChallenge, MIN_VOICED_DURATION_MS, MAX_RECORDING_MS } from '../demoguard/collectors/audioCollector';
import { generateVocalRanChallenge, computeVocalRanResult } from '../demoguard/cognitive/vocalRanChallenge';
import { requestVoiceChallenge } from '../pulseguard/api';
import type { VocalRanSignal } from '../demoguard/cognitive/cognitiveTypes';
import type { DemoGuardVoiceSignal, VoiceDiagnosticsSafe } from '../demoguard/types';
import { recordTaskStart } from '../demoguard/behavior/taskBehaviorRecorder';
import type { BehaviorSession } from '../demoguard/behavior/behaviorSession';
import { PhaseHeader } from '../components/PhaseHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { VadDebugOverlay } from '../components/VadDebugOverlay';
import { useI18n } from '../i18n/I18nContext';

interface Props {
  sessionPublicId: string;
  session: BehaviorSession;
  onComplete: (
    voice: DemoGuardVoiceSignal,
    diagnostic: VoiceDiagnosticsSafe | null,
    voiceB64: string | null,
    vocalRan: VocalRanSignal,
    voiceMimetype: string | null,
    voiceNonce: string | null,
    voiceChallengeId: string | null,
  ) => void;
  onError: (reason: string) => void;
}

type RecordingState = 'idle' | 'warming_up' | 'recording' | 'processing' | 'done';

export function VoiceScreen({ sessionPublicId, session, onComplete, onError }: Props) {
  const { t } = useI18n();
  const [voiceNonce, setVoiceNonce] = useState<string | null>(null);
  const [serverChallengeId, setServerChallengeId] = useState<string | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(true);
  const [challenge] = useState(() => generateVocalRanChallenge());
  const digits = challenge.sequence.join(', ');
  const carrierPhrase = t('voice.carrierPhrase', { digits });
  const [state, setState] = useState<RecordingState>('idle');
  const [interruptMsg, setInterruptMsg] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const retryRef = useRef<boolean>(false);

  useEffect(() => {
    recordTaskStart(session, 'vocal_ran');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await requestVoiceChallenge(sessionPublicId);
        if (cancelled) return;
        if (result.success && result.nonce && result.challenge_id) {
          setVoiceNonce(result.nonce);
          setServerChallengeId(result.challenge_id);
        }
      } catch {
        // Nonce request failed — fall back to local challenge_id (compat mode)
      } finally {
        if (!cancelled) setChallengeLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionPublicId]);

  const handleRecord = async () => {
    setState('warming_up');
    setInterruptMsg(null);
    try {
      const result = await recordVoiceChallenge(
        serverChallengeId || challenge.challenge_id,
        (_referenceMaxEnergy) => {
          // Phase 1 → Phase 2 transition: warm-up complete, real recording starts.
          // Set startTimeRef here (not before warm-up) so RAN duration metric
          // excludes warm-up time.
          startTimeRef.current = performance.now();
          setState('recording');
        },
      );

      // ── VAD timeout: not enough voiced audio within MAX_RECORDING_MS
      if (result.error?.kind === 'voiced-duration-timeout') {
        onError(t('voice.voicedDurationTimeout'));
        setState('idle');
        return;
      }

      // ── T5: Handle audio interruption (mobile context suspension, visibility change, etc.)
      if (result.error?.kind === 'audio-interrupted') {
        if (!retryRef.current) {
          retryRef.current = true;
          setInterruptMsg(t('voice.interrupted'));
          setState('idle');
          return;
        }
        // Already retried once — fall through to error
        retryRef.current = false;
        onError(t('voice.interruptedFinal'));
        setState('idle');
        return;
      }

      retryRef.current = false;
      const durationMs = performance.now() - startTimeRef.current;
      const vocalRan = computeVocalRanResult(challenge, durationMs, result.safe.recorded);

      const diagnostic: VoiceDiagnosticsSafe | null = result.safe.recorded
        ? {
            status: 'not_checked',
            reasonSafe: 'voice_checked',
            analysisMode: result.diagnostic.analysisMode,
            audioCaptured: result.diagnostic.audioCaptured,
            payloadPrepared: result.diagnostic.payloadPrepared,
            relayAttempted: false,
            relayAccepted: false,
            hcsAnalyzed: false,
            featuresExtracted: false,
            livenessStatus: 'unknown',
            confidence: null,
            latencyMs: null,
          }
        : null;

      if (result.error && !result.safe.recorded) {
        onError(result.error.kind === 'other' ? result.error.message : 'Voice recording failed');
        setState('idle');
        return;
      }

      onComplete(result.safe, diagnostic, result.sensitive?.voice_b64 ?? null, vocalRan, result.sensitive?.voice_mimetype ?? null, voiceNonce, serverChallengeId);
      setState('done');
    } catch (err) {
      retryRef.current = false;
      onError(err instanceof Error ? err.message : 'Voice recording failed');
      setState('idle');
    }
  };

  return (
    <div className="screen">
      <PhaseHeader title={t('voice.title')} progress="6/6" progressPct={100} />
      <ErrorBoundary onRetry={() => setState('idle')}>
        <div className="voice-visual">
          <div className={`voice-pulse ${state === 'recording' ? 'recording' : ''} ${state === 'warming_up' ? 'warming-up' : ''}`} />
          {state === 'idle' && (
            <>
              {interruptMsg && (
                <p style={{ color: '#e67e22', fontWeight: 600, marginBottom: 12 }}>{interruptMsg}</p>
              )}
              <p>{t('voice.warmupPrompt')}</p>
              <p style={{ fontSize: 24, fontWeight: 700 }}>{t('voice.warmupPhrase')}</p>
              <p className="muted" style={{ marginTop: 8 }}>{t('voice.warmupThen')}</p>
              <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.6 }}>{carrierPhrase}</p>
              <p className="muted">{t('voice.durationTarget', { min: MIN_VOICED_DURATION_MS / 1000, max: MAX_RECORDING_MS / 1000 })}</p>
              <button className="btn" onClick={handleRecord} disabled={challengeLoading}>{challengeLoading ? '...' : t('voice.record')}</button>
            </>
          )}
          {state === 'warming_up' && (
            <>
              <p style={{ fontSize: 20, fontWeight: 600 }}>{t('voice.warmupInProgress')}</p>
              <p style={{ fontSize: 24, fontWeight: 700 }}>{t('voice.warmupPhrase')}</p>
              <p className="muted">{t('voice.warmupHint')}</p>
            </>
          )}
          {state === 'recording' && (
            <>
              <p style={{ fontSize: 20, fontWeight: 600 }}>{t('voice.recording')}</p>
              <p style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.5 }}>{carrierPhrase}</p>
            </>
          )}
          {state === 'processing' && <p className="muted">{t('voice.processing')}</p>}
          {state === 'done' && <p>{t('voice.done')}</p>}
        </div>
      </ErrorBoundary>
      <VadDebugOverlay />
    </div>
  );
}
