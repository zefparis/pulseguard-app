/**
 * DemoGuard — Audio collector
 *
 * Reuses technical utilities from lib/audio.ts (pure DSP functions, no PayGuard coupling).
 * Records voice, computes MFCC summary, returns safe metadata + sensitive data for proxy.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { blobToBase64, computeBlobRmsAndDuration } from '../../lib/audio';
import { recordAudioWithVad, warmupAndRecordAudioWithVad, MIN_VOICED_DURATION_MS, MAX_RECORDING_MS } from '../../lib/vadRecorder';
import type { DemoGuardVoiceSignal, DemoGuardVoiceDiagnostic } from '../types';

function computeAudioSizeBucket(byteLength: number): DemoGuardVoiceDiagnostic['audioSizeBucket'] {
  if (byteLength === 0) return 'none';
  if (byteLength < 2048) return 'small';
  if (byteLength < 16384) return 'medium';
  return 'large';
}

export const VOICE_DURATION_MS = 7000; // Deprecated — kept for backward compat, use MIN_VOICED_DURATION_MS
export { MIN_VOICED_DURATION_MS, MAX_RECORDING_MS };

export type AudioCollectorError =
  | { kind: 'permission-denied' }
  | { kind: 'unavailable' }
  | { kind: 'audio-context-suspended' }
  | { kind: 'audio-interrupted'; reason: string }
  | { kind: 'voiced-duration-timeout' }
  | { kind: 'other'; message: string };

export interface AudioCollectorResult {
  safe: DemoGuardVoiceSignal;
  sensitive: { voice_b64: string; voice_mimetype?: string } | null;
  error: AudioCollectorError | null;
  diagnostic: DemoGuardVoiceDiagnostic;
}

export function generateChallengeId(): string {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `dg_voice_${code}`;
}

export async function requestMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export async function recordVoiceChallenge(
  challengeId: string = generateChallengeId(),
  onWarmupComplete?: (referenceMaxEnergy: number) => void,
): Promise<AudioCollectorResult> {
  try {
    // When onWarmupComplete is provided, use the 2-phase warm-up + recording flow.
    // Phase 1: mic initialization + reference maxEnergy calibration (NOT recorded).
    // Phase 2: RAN challenge capture with session-calibrated VAD threshold.
    // When absent, uses the standard single-phase recording (zero regression for existing callers).
    const recording = onWarmupComplete
      ? await warmupAndRecordAudioWithVad({ onWarmupComplete })
      : await recordAudioWithVad();

    // ── T5: Check if recording was interrupted (mobile track ended, visibility change, etc.)
    if (recording.interrupted) {
      return {
        safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
        sensitive: null,
        error: { kind: 'audio-interrupted', reason: recording.interruptReason ?? 'unknown' },
        diagnostic: {
          microphonePermission: 'granted',
          audioCaptured: false,
          durationMs: null,
          audioSizeBucket: 'none',
          payloadPrepared: false,
          relayAttempted: false,
          relayAccepted: false,
          analyzed: false,
          vocalStatus: 'not_checked',
          confidenceLevel: null,
          reasonSafe: 'audio_interrupted',
          latencyMs: null,
          analysisMode: 'skipped',
          audioPipelineStatus: 'interrupted',
          recordingSupported: true,
          recordingStarted: true,
          recordingStopped: true,
          mimeType: recording.mimeType || null,
          recorderState: recording.debug.recorderStateAtStop as 'inactive' | 'recording' | 'paused' | 'unknown',
          chunksCount: recording.chunksCount,
        },
      };
    }

    // ── VAD timeout: MAX_RECORDING_MS reached without enough voiced audio
    if (recording.timeout) {
      return {
        safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
        sensitive: null,
        error: { kind: 'voiced-duration-timeout' },
        diagnostic: {
          microphonePermission: 'granted',
          audioCaptured: false,
          durationMs: recording.totalDurationMs,
          audioSizeBucket: 'none',
          payloadPrepared: false,
          relayAttempted: false,
          relayAccepted: false,
          analyzed: false,
          vocalStatus: 'not_checked',
          confidenceLevel: null,
          reasonSafe: 'voiced_duration_timeout',
          latencyMs: null,
          analysisMode: 'skipped',
          audioPipelineStatus: 'voiced_duration_timeout',
          recordingSupported: true,
          recordingStarted: true,
          recordingStopped: true,
          mimeType: recording.mimeType || null,
          recorderState: recording.debug.recorderStateAtStop as 'inactive' | 'recording' | 'paused' | 'unknown',
          chunksCount: recording.chunksCount,
        },
      };
    }

    if (!recording.blob || recording.blob.size === 0) {
      return {
        safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
        sensitive: null,
        error: {
          kind: 'other',
          message:
            `No audio blob captured [chunks=${recording.chunksCount}, ` +
            `state=${recording.debug.recorderStateAtStop}, ` +
            `trackMuted=${recording.debug.trackMuted}, ` +
            `trackReadyState=${recording.debug.trackReadyState}, ` +
            `mimeType=${recording.debug.pickedMimeType || '(default)'}]`,
        },
        diagnostic: {
          microphonePermission: 'granted',
          audioCaptured: false,
          durationMs: null,
          audioSizeBucket: 'none',
          payloadPrepared: false,
          relayAttempted: false,
          relayAccepted: false,
          analyzed: false,
          vocalStatus: 'not_checked',
          confidenceLevel: null,
          reasonSafe: 'audio_missing',
          latencyMs: null,
          analysisMode: 'skipped',
          audioPipelineStatus: 'missing',
          recordingSupported: true,
          recordingStarted: true,
          recordingStopped: true,
          mimeType: recording.mimeType || null,
          recorderState: recording.debug.recorderStateAtStop as 'inactive' | 'recording' | 'paused' | 'unknown',
          chunksCount: recording.chunksCount,
        },
      };
    }

    // AUDIO-GUARD: decode blob via AudioContext.decodeAudioData, compute RMS + duration
    // Block submission if RMS < threshold (silence) or duration < 2s
    const guardResult = await computeBlobRmsAndDuration(recording.blob);
    console.log(JSON.stringify({
      event: '[AUDIO-GUARD]',
      rms: guardResult.rms.toFixed(6),
      durationMs: guardResult.durationMs,
      mimeType: recording.mimeType,
      blobSize: recording.blob.size,
      ok: guardResult.ok,
    }));

    if (!guardResult.ok) {
      const reason = guardResult.durationMs < 2000 ? 'audio_too_short' : 'audio_too_silent';
      return {
        safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
        sensitive: null,
        error: { kind: 'other', message: `Enregistrement inaudible (${reason}), réessayez` },
        diagnostic: {
          microphonePermission: 'granted',
          audioCaptured: true,
          durationMs: guardResult.durationMs,
          audioSizeBucket: computeAudioSizeBucket(recording.blob.size),
          payloadPrepared: false,
          relayAttempted: false,
          relayAccepted: false,
          analyzed: false,
          vocalStatus: 'not_checked',
          confidenceLevel: null,
          reasonSafe: reason,
          latencyMs: null,
          analysisMode: 'skipped',
          audioPipelineStatus: reason === 'audio_too_short' ? 'too_short' : 'too_silent',
          recordingSupported: true,
          recordingStarted: true,
          recordingStopped: true,
          mimeType: recording.mimeType,
          recorderState: recording.debug.recorderStateAtStop as 'inactive' | 'recording' | 'paused' | 'unknown',
          chunksCount: recording.chunksCount,
        },
      };
    }

    // Convert blob to base64 for payload
    const voiceB64 = await blobToBase64(recording.blob);
    const audioByteLength = recording.blob.size;
    const durationMsActual = guardResult.durationMs;
    const quality: 'ok' | 'low' = durationMsActual > 2000 ? 'ok' : 'low';

    return {
      safe: {
        recorded: true,
        duration_ms: durationMsActual,
        challenge_id: challengeId,
        quality,
      },
      sensitive: {
        voice_b64: voiceB64,
        voice_mimetype: recording.mimeType,
      },
      error: null,
      diagnostic: {
        microphonePermission: 'granted',
        audioCaptured: true,
        durationMs: durationMsActual,
        audioSizeBucket: computeAudioSizeBucket(audioByteLength),
        payloadPrepared: true,
        relayAttempted: false,
        relayAccepted: false,
        analyzed: false,
        vocalStatus: 'not_checked',
        confidenceLevel: null,
        reasonSafe: 'not_attempted',
        latencyMs: null,
        analysisMode: durationMsActual > 2000 ? 'full_audio' : 'metadata_only',
        audioPipelineStatus: durationMsActual > 2000 ? 'captured' : 'too_short',
        recordingSupported: true,
        recordingStarted: true,
        recordingStopped: true,
        mimeType: recording.mimeType,
        recorderState: recording.debug.recorderStateAtStop as 'inactive' | 'recording' | 'paused' | 'unknown',
        chunksCount: recording.chunksCount,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'audio_decode_failed') {
      return {
        safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
        sensitive: null,
        error: { kind: 'other', message: 'Format audio non décodable, réessayez' },
        diagnostic: {
          microphonePermission: 'granted',
          audioCaptured: true,
          durationMs: null,
          audioSizeBucket: 'none',
          payloadPrepared: false,
          relayAttempted: false,
          relayAccepted: false,
          analyzed: false,
          vocalStatus: 'not_checked',
          confidenceLevel: null,
          reasonSafe: 'audio_decode_failed',
          latencyMs: null,
          analysisMode: 'skipped',
          audioPipelineStatus: 'decode_failed',
          recordingSupported: true,
          recordingStarted: true,
          recordingStopped: true,
          mimeType: null,
          recorderState: 'inactive',
          chunksCount: null,
        },
      };
    }
    if (err instanceof Error && err.message === 'audio_context_suspended') {
      return {
        safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
        sensitive: null,
        error: { kind: 'audio-context-suspended' },
        diagnostic: {
          microphonePermission: 'granted',
          audioCaptured: false,
          durationMs: null,
          audioSizeBucket: 'none',
          payloadPrepared: false,
          relayAttempted: false,
          relayAccepted: false,
          analyzed: false,
          vocalStatus: 'not_checked',
          confidenceLevel: null,
          reasonSafe: 'audio_context_suspended',
          latencyMs: null,
          analysisMode: 'skipped',
          audioPipelineStatus: 'context_suspended',
          recordingSupported: true,
          recordingStarted: true,
          recordingStopped: true,
          mimeType: null,
          recorderState: null,
          chunksCount: null,
        },
      };
    }
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        return {
          safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
          sensitive: null,
          error: { kind: 'permission-denied' },
          diagnostic: {
            microphonePermission: 'denied',
            audioCaptured: false,
            durationMs: null,
            audioSizeBucket: 'none',
            payloadPrepared: false,
            relayAttempted: false,
            relayAccepted: false,
            analyzed: false,
            vocalStatus: 'not_checked',
            confidenceLevel: null,
            reasonSafe: 'voice_missing',
            latencyMs: null,
            analysisMode: 'skipped',
            audioPipelineStatus: 'permission_denied',
            recordingSupported: false,
            recordingStarted: false,
            recordingStopped: false,
            mimeType: null,
            recorderState: null,
            chunksCount: null,
          },
        };
      }
      return {
        safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
        sensitive: null,
        error: { kind: 'unavailable' },
        diagnostic: {
          microphonePermission: 'unknown',
          audioCaptured: false,
          durationMs: null,
          audioSizeBucket: 'none',
          payloadPrepared: false,
          relayAttempted: false,
          relayAccepted: false,
          analyzed: false,
          vocalStatus: 'not_checked',
          confidenceLevel: null,
          reasonSafe: 'voice_missing',
          latencyMs: null,
          analysisMode: 'skipped',
          audioPipelineStatus: 'unsupported',
          recordingSupported: false,
          recordingStarted: false,
          recordingStopped: false,
          mimeType: null,
          recorderState: null,
          chunksCount: null,
        },
      };
    }
    return {
      safe: { recorded: false, quality: 'missing', challenge_id: challengeId },
      sensitive: null,
      error: { kind: 'other', message: err instanceof Error ? err.message : 'Audio capture failed' },
      diagnostic: {
        microphonePermission: 'unknown',
        audioCaptured: false,
        durationMs: null,
        audioSizeBucket: 'none',
        payloadPrepared: false,
        relayAttempted: false,
        relayAccepted: false,
        analyzed: false,
        vocalStatus: 'not_checked',
        confidenceLevel: null,
        reasonSafe: 'voice_missing',
        latencyMs: null,
        analysisMode: 'failed',
        audioPipelineStatus: 'missing',
        recordingSupported: false,
        recordingStarted: false,
        recordingStopped: false,
        mimeType: null,
        recorderState: null,
        chunksCount: null,
      },
    };
  }
}
