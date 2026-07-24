/**
 * VAD Thresholds — P10-FINAL reference calibration
 *
 * Single source of truth for VAD energy threshold and voiced-duration
 * requirements in pulseguard-app. Values are read from environment variables
 * with P10-FINAL calibration defaults as fallback.
 *
 * ─── REMOTE CONFIG ─────────────────────────────────────────────────
 * VAD_ENERGY_THRESHOLD and MIN_VOICED_DURATION_MS are `let` so they can be
 * updated at runtime from the hybrid-vector-api proxy endpoint via
 * applyRemoteVadConfig(). The browser fetches /api/vad-config (server-side
 * proxy) — never touches Supabase directly. Falls back to hardcoded defaults.
 *
 * ─── CROSS-REPO SYNCHRONIZATION ───────────────────────────────────
 * These values MUST stay numerically identical across:
 *   - pulseguard-app/src/lib/vad-thresholds.ts      (client-side VAD)
 *   - demoguard-app/src/lib/vad-thresholds.ts      (client-side VAD)
 *   - hybrid-vector-api/src/services/vocalQuickGate/vad-thresholds.ts  (relay gate)
 *   - hcs-u7-backend/src/voice/vad-thresholds.ts   (authoritative analysis)
 *
 * Each repo has its own independent copy (no cross-repo runtime import).
 * A change to any value here must be mirrored in the other repos
 * as part of a deliberate recalibration rollout.
 *
 * Reference: P10-FINAL calibration (commit f50af42, Feb 2026).
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { fetchRemoteVadConfig, getCachedVadThresholds } from './remote-vad-config';

function readNumberEnv(name: string, fallback: number): number {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Energy threshold for voiced frame detection — RELATIVE threshold.
 *
 * This is NOT an absolute energy level. Frames are classified as voiced when
 * their energy divided by the running maxEnergy (live VAD) or the global
 * maxEnergy (post-encode VAD, backend extractVoiceSegments) exceeds this value.
 * In other words, a frame is voiced if its energy is at least 1.5% of the
 * peak energy observed in the recording.
 *
 * This relative semantics ensures that quiet mobile speech (low mic gain,
 * distant microphone) is still detected as voiced, because the normalization
 * by maxEnergy makes the threshold independent of absolute recording level.
 *
 * P10-FINAL: lowered from 0.02 to 0.015 to detect quiet mobile speech
 * (distant mic, low gain).
 */
export let VAD_ENERGY_THRESHOLD = readNumberEnv('VAD_ENERGY_THRESHOLD', 0.015);

/**
 * Minimum cumulative voiced duration (ms) required for a valid recording.
 * The client VAD stops recording once this threshold is reached.
 *
 * P10-FINAL: 3000ms — aligned with HCS backend MIN_VOICED_DURATION_MS.
 */
export let MIN_VOICED_DURATION_MS = readNumberEnv('MIN_VOICED_DURATION_MS', 3000);

/**
 * Maximum recording duration (ms) safety cap.
 * If voiced duration threshold is not met by this time, recording stops
 * and a voiced_duration_timeout error is returned (fail-closed).
 *
 * Client-only constant — not shared with backend or relay.
 */
export const MAX_RECORDING_MS = readNumberEnv('MAX_RECORDING_MS', 12000);

/**
 * Maximum gap (ms) between two voiced segments to merge them into one.
 *
 * Used by extractVoiceSegments in hybrid-vector-api and hcs-u7-backend.
 * The client-side VAD (vadRecorder.ts) doesn't use segment-based filtering,
 * but this constant must stay synchronized across repos for calibration.
 *
 * See hybrid-vector-api/src/services/vocalQuickGate/vad-thresholds.ts for
 * full documentation.
 */
export const VOICE_SEGMENT_MERGE_GAP_MS = readNumberEnv('VOICE_SEGMENT_MERGE_GAP_MS', 300);

// ─── Remote config live override ───────────────────────────────────
//
// applyRemoteVadConfig() fetches from the hybrid-vector-api proxy endpoint
// /api/vad-config and updates the `let` variables above. The browser never
// touches Supabase directly — only via the server-side proxy.
//
// Called on module load (async, non-blocking) and every 60s via setInterval.

export function applyRemoteVadConfig(): void {
  const cfg = getCachedVadThresholds();
  VAD_ENERGY_THRESHOLD = cfg.VAD_ENERGY_THRESHOLD;
  MIN_VOICED_DURATION_MS = cfg.MIN_VOICED_DURATION_MS;
}

// Trigger initial async fetch (non-blocking — uses cached/default values immediately)
fetchRemoteVadConfig().then(() => applyRemoteVadConfig()).catch(() => {});

// Refresh every 60s
setInterval(() => {
  fetchRemoteVadConfig().then(() => applyRemoteVadConfig()).catch(() => {});
}, 60_000);
