/**
 * Device Motion State — Purely informative phone-carried detection
 *
 * Derives a simple categorical label from motion collector output to
 * indicate whether the phone appears to be CARRIED by a person (natural
 * micro-movements) or STATIONARY (likely placed on a desk, not worn).
 *
 * ─── CRITICAL DESIGN CONSTRAINT ────────────────────────────────────
 * This signal is COMPLETELY SEPARATE from the scoring pipeline.
 * It must NEVER be merged into `motorConfidence`, never transmitted to
 * `computeHumanState` / `HumanStateInput`, and never influence alerts
 * or deviation thresholds. It exists solely as an informational badge
 * for managers and as raw data for future Brain ML models to learn
 * from independently — never as a pre-digested conclusion fed into
 * the current rule-based engine.
 * ────────────────────────────────────────────────────────────────────
 *
 * Thresholds (reused from behaviorSummary.ts motion variance documentation):
 *   - variance < 0.01  → 'stationary' (phone completely still)
 *   - variance >= 0.01 → 'carried'     (normal human holding micro-movements)
 *   - sample_count < 5 → 'unknown'     (insufficient data for significance)
 *   - variance absent  → 'unknown'     (motion not supported / permission denied)
 *
 * The variance < 0.01 threshold is the same one documented in
 * behaviorSummary.ts line 151 for "phone is completely still". We
 * reuse it here for consistency, but the OUTPUT is a separate field
 * (`device_motion_state`), not `motorConfidence`.
 *
 * Minimum sample_count of 5 ensures we don't classify based on 1-2
 * accelerometer readings that could be noise artifacts. With a 30s
 * capture window at ~60Hz, a carried phone typically produces
 * 1000+ samples; a stationary phone still produces 30+ from gravity
 * alone. 5 is a conservative floor that rejects only genuinely
 * broken/empty collections.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { DemoGuardMotionSignal } from '../demoguard/types';

export type DeviceMotionState = 'stationary' | 'carried' | 'unknown';

const STATIONARY_VARIANCE_THRESHOLD = 0.01;
const MIN_SAMPLE_COUNT = 5;

/**
 * Compute the device motion state from motion collector output.
 *
 * @param motion - The motion signal from `csStop()`. May be undefined if
 *                 motion is not supported or permission was denied.
 * @returns 'stationary' | 'carried' | 'unknown'
 *
 * NOTE: This function is intentionally pure and does NOT reference
 * motorConfidence, behaviorSummary, or any scoring-related field.
 * It reads only raw motion collector metrics (variance, sample_count).
 */
export function computeDeviceMotionState(
  motion: Partial<DemoGuardMotionSignal> | undefined,
): DeviceMotionState {
  if (!motion) {
    return 'unknown';
  }

  const variance = motion.variance;
  const sampleCount = motion.sample_count ?? 0;

  if (variance === undefined || variance === null) {
    return 'unknown';
  }

  if (sampleCount < MIN_SAMPLE_COUNT) {
    return 'unknown';
  }

  return variance < STATIONARY_VARIANCE_THRESHOLD ? 'stationary' : 'carried';
}
