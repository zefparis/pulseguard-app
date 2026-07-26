/**
 * DemoGuard — Type definitions
 *
 * DemoGuard is an isolated mobile collector module for HCS-U7 / Hybrid Vector demos.
 * It does NOT depend on PayGuard identity fields.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { CognitiveSignals } from './cognitive/cognitiveTypes';
import type { BehaviorPayload, BehaviorSummary, TouchDiagnosticsBehaviorSafe } from './behavior/behaviorTypes';

// ─── Device context ────────────────────────────────────────────────

export interface DemoGuardDeviceContext {
  platform: string;
  osVersion: string;
  model: string | null;
  manufacturer: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  pixelRatio: number | null;
  language: string | null;
  timezone: string | null;
  online: boolean;
}

// ─── Permissions ───────────────────────────────────────────────────

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

export interface DemoGuardPermissions {
  camera: PermissionStatus;
  microphone: PermissionStatus;
  notifications: PermissionStatus;
  location: PermissionStatus;
  motion: PermissionStatus;
  orientation: PermissionStatus;
}

// ─── Signal quality grade ──────────────────────────────────────────

export type SignalQuality = 'ok' | 'low' | 'missing' | 'unsupported';

// ─── Safe signal metadata (for UI and safe payload) ────────────────

export interface DemoGuardSelfieSignal {
  captured: boolean;
  quality: SignalQuality;
  width?: number;
  height?: number;
}

export interface DemoGuardVoiceSignal {
  recorded: boolean;
  duration_ms?: number;
  challenge_id?: string;
  quality: SignalQuality;
  mfcc_available?: boolean;
}

export type DemoGuardVocalStatus = 'passed' | 'review' | 'failed' | 'not_checked';

export type DemoGuardVocalReasonSafe =
  | 'voice_checked'
  | 'voice_checked_limited'
  | 'voice_missing'
  | 'voice_low_quality'
  | 'voice_replay_suspected'
  | 'hcs_vocal_unavailable'
  | 'hcs_vocal_auth_failed'
  | 'hcs_vocal_endpoint_unavailable'
  | 'audio_missing'
  | 'audio_context_suspended'
  | 'audio_interrupted'
  | 'audio_too_silent'
  | 'audio_too_short'
  | 'audio_decode_failed'
  | 'voiced_duration_timeout'
  | 'not_attempted';

export type DemoGuardAudioSizeBucket = 'none' | 'small' | 'medium' | 'large';

export type DemoGuardAnalysisMode = 'full_audio' | 'metadata_only' | 'skipped' | 'failed';
export type DemoGuardAudioPipelineStatus = 'captured' | 'missing' | 'too_short' | 'too_silent' | 'decode_failed' | 'permission_denied' | 'unsupported' | 'context_suspended' | 'interrupted' | 'voiced_duration_timeout';

export interface DemoGuardVoiceDiagnostic {
  microphonePermission: 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';
  audioCaptured: boolean;
  durationMs: number | null;
  audioSizeBucket: DemoGuardAudioSizeBucket;
  payloadPrepared: boolean;
  relayAttempted: boolean;
  relayAccepted: boolean;
  analyzed: boolean;
  vocalStatus: DemoGuardVocalStatus;
  confidenceLevel: 'high' | 'medium' | 'low' | null;
  reasonSafe: DemoGuardVocalReasonSafe;
  latencyMs: number | null;
  analysisMode: DemoGuardAnalysisMode;
  audioPipelineStatus: DemoGuardAudioPipelineStatus;
  recordingSupported: boolean;
  recordingStarted: boolean;
  recordingStopped: boolean;
  mimeType: string | null;
  recorderState: 'inactive' | 'recording' | 'paused' | 'unknown' | null;
  chunksCount: number | null;
}

// ─── Device signal metadata ───────────────────────────────────────

export interface DemoGuardMotionSignal {
  supported: boolean;
  permission: PermissionStatus;
  sample_count: number;
  variance?: number;
  quality: SignalQuality;
}

export interface DemoGuardOrientationSignal {
  supported: boolean;
  permission: PermissionStatus;
  sample_count: number;
  changes: number;
  quality: SignalQuality;
}

export interface DemoGuardTouchSignal {
  touch_count: number;
  pointer_type?: string;
  pressure_supported: boolean;
  pressure_avg?: number;
  touch_duration_ms?: number;
  move_distance?: number;
  multi_touch_detected: boolean;
  quality: SignalQuality;
}

export interface DemoGuardVisibilitySignal {
  blur_count: number;
  focus_count: number;
  visibility_hidden_count: number;
  hidden_duration_ms: number;
  page_focus_lost: boolean;
  quality: SignalQuality;
}

export interface DemoGuardNetworkSignal {
  online: boolean;
  effective_type?: string;
  rtt?: number;
  downlink?: number;
  api_latency_ms?: number;
  quality: SignalQuality;
}

// ─── Signals aggregate ─────────────────────────────────────────────

export interface DemoGuardSignals {
  selfie: DemoGuardSelfieSignal | null | undefined;
  /** @deprecated V1 vestige — never populated. Replaced by cognitive.reflex (ReflexSignal). See REACTION_SIGNAL_AUDIT_01.md */
  reaction?: undefined;
  voice: DemoGuardVoiceSignal | null | undefined;
  motion: DemoGuardMotionSignal | null | undefined;
  orientation: DemoGuardOrientationSignal | null | undefined;
  touch: DemoGuardTouchSignal | null | undefined;
  visibility: DemoGuardVisibilitySignal | null | undefined;
  network: DemoGuardNetworkSignal | null | undefined;
  cognitive?: CognitiveSignals | null;
  behavior?: BehaviorPayload | null;
  voiceDiagnostics?: VoiceDiagnosticsSafe;
  touchDiagnostics?: TouchDiagnosticsSafe;
  touchDiagnosticsBehavior?: TouchDiagnosticsBehaviorSafe;
}

// ─── Quality ───────────────────────────────────────────────────────

export interface DemoGuardQuality {
  signal_completeness: number;
  device_ready: boolean;
  permissions_ready: boolean;
  overall_ready: boolean;
  critical_missing: string[];
  missing_optional: string[];
}

// ─── Sensitive payload (only sent to proxy, never in UI/logs) ──────

export interface DemoGuardSensitive {
  selfie_b64?: string;
  voice_b64?: string;
  voice_mimetype?: string;
  mfcc_summary?: number[];
  voice_nonce?: string;
  voice_challenge_id?: string;
}

export const VOICE_KEY = 'voice_b64' as const;

// ─── Safe diagnostics contracts (P10-FINAL) ───────────────────────

export interface VoiceDiagnosticsSafe {
  status: 'passed' | 'review' | 'failed' | 'not_checked';
  reasonSafe: string;
  analysisMode: 'full_audio' | 'metadata_only' | 'skipped' | 'failed';
  audioCaptured: boolean;
  payloadPrepared: boolean;
  relayAttempted: boolean;
  relayAccepted: boolean;
  hcsAnalyzed: boolean;
  featuresExtracted: boolean;
  livenessStatus: 'present' | 'review' | 'absent' | 'unknown';
  confidence: number | null;
  latencyMs: number | null;
}

export interface TouchDiagnosticsSafe {
  status: 'ok' | 'review' | 'missing' | 'unsupported';
  supported: boolean;
  interactionCount: number;
  touchStartCount?: number;
  pointerTouchCount?: number;
  quality: 'ok' | 'review' | 'missing' | 'unsupported';
  reasonSafe: string;
}

// ─── Payload ───────────────────────────────────────────────────────

export interface DemoGuardPayload {
  hcs_session_public_id: string;
  source: 'demoguard_mobile';
  demo_guard: {
    version: string;
    started_at: string;
    completed_at: string;
    device: DemoGuardDeviceContext;
    permissions: DemoGuardPermissions;
    signals: DemoGuardSignals;
    quality: DemoGuardQuality;
    test_scope?: string;
  };
  sensitive?: DemoGuardSensitive;
}

// ─── Safe response (filtered, no PII) ──────────────────────────────

export interface DemoGuardHybridFusion {
  triggered: boolean;
  globalDecision?: string;
  trustLevel?: string;
  cognitiveStatus?: 'passed' | 'review' | 'failed';
  vocalStatus?: 'passed' | 'review' | 'failed';
  monitoringRecorded?: boolean;
  monitoringStatus?: 'recorded' | 'pending' | 'failed';
  vocalDiagnostic?: DemoGuardVoiceDiagnostic;
  voiceDiagnostics?: VoiceDiagnosticsSafe;
  touchDiagnostics?: TouchDiagnosticsSafe;
  behaviorStatus?: 'ok' | 'review' | 'failed' | 'missing';
  behaviorSummary?: BehaviorSummary;
  touchDiagnosticsBehavior?: TouchDiagnosticsBehaviorSafe;
}

export interface DemoGuardSafeResponse {
  ok: boolean;
  source: 'demoguard_mobile';
  status: 'submitted' | 'review' | 'failed';
  received?: boolean;
  quality_score?: number;
  ready?: boolean;
  message?: string;
  traceId?: string;
  hybridFusion?: DemoGuardHybridFusion;
}
