/**
 * PulseGuard Behavior Summary — Passive monitoring behavior aggregation
 *
 * Builds a behavior summary from the native touch and motion collector
 * outputs, compatible with the server-side `mapPulseGuardToHumanStateInput`
 * contract in hybrid-vector-api/src/routes/pulseguard.ts.
 *
 * ─── CONTEXT ─────────────────────────────────────────────────────
 * DemoGuard's `computeBehaviorSummary` (demoguard-app) aggregates
 * per-task touch behavior during named cognitive tests (stroop, nback,
 * etc.). PulseGuard has NO named tasks — it collects a passive stream
 * of touch and motion signals during a work session. This function is
 * a separate, purpose-built aggregation for that passive context.
 *
 * ─── HEURISTICS ──────────────────────────────────────────────────
 * The formulas below are a first reasonable draft based on the signals
 * currently available from touchCollector and motionCollector. They are
 * NOT a reproduction of DemoGuard's model (different context: active
 * named tasks vs passive continuous monitoring).
 *
 * ─── NULL FIELDS ─────────────────────────────────────────────────
 * The following fields are left `null` because the current collectors
 * do not expose data fine-grained enough to populate them honestly:
 *   - tasksObserved: PulseGuard has no named cognitive tasks
 *   - totalInteractions: no equivalent to DemoGuard's task interaction count
 *   - avgRhythmMs: no inter-task rhythm data
 *   - rhythmVariance: no rhythm data
 *   - hesitationTotal: no hesitation tracking in passive monitoring
 *   - correctionTotal: no correction tracking in passive monitoring
 * These could be enriched in future iterations if collectors expose
 * finer-grained data (e.g., individual touch timestamps for rhythm
 * analysis).
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { DemoGuardSignals } from '../demoguard/types';

// ─── Output type ───────────────────────────────────────────────────

/**
 * Behavior summary compatible with what `mapPulseGuardToHumanStateInput`
 * expects under `signals.behavior.summary`.
 *
 * Fields are nullable to honestly represent missing data, matching the
 * server-side loose type cast (all fields are optional with `?? null`).
 */
export interface PulseGuardBehaviorSummary {
  behaviorLikelihood: 'high' | 'medium' | 'low' | null;
  motorConfidence: number | null;
  tasksObserved: number | null;
  totalInteractions: number | null;
  avgRhythmMs: number | null;
  rhythmVariance: number | null;
  hesitationTotal: number | null;
  correctionTotal: number | null;
  consistencyScore: number | null;
  quality: 'ok' | 'review' | 'failed' | 'missing';
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Check if a signal quality indicates the collector produced usable data.
 * 'ok' and 'low' mean data was collected; 'missing' and 'unsupported' mean no data.
 */
function hasUsableData(quality: string | undefined): boolean {
  return quality === 'ok' || quality === 'low';
}

/**
 * Check if a signal quality indicates good-quality data.
 */
function isGoodQuality(quality: string | undefined): boolean {
  return quality === 'ok';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ─── Core function ─────────────────────────────────────────────────

/**
 * Compute a PulseGuard behavior summary from touch and motion collector
 * outputs.
 *
 * @param signals - The partial DemoGuardSignals returned by `csStop()`.
 *                  Only `signals.touch` and `signals.motion` are used.
 * @returns A behavior summary compatible with the server-side mapping.
 */
export function computePulseGuardBehaviorSummary(
  signals: Partial<DemoGuardSignals>,
): PulseGuardBehaviorSummary {
  const touch = signals.touch;
  const motion = signals.motion;

  const touchUsable = touch ? hasUsableData(touch.quality) : false;
  const motionUsable = motion ? hasUsableData(motion.quality) : false;

  // ── Quality (drives behaviorStatus → hasBehavior on the server) ──
  //
  // 'missing' when neither collector produced usable data — this keeps
  // hasBehavior = false on the server, preserving the insufficient_data
  // path for genuinely empty checks.
  // 'ok' when at least one collector has good quality.
  // 'review' when at least one has usable but degraded data (quality='low').
  let quality: PulseGuardBehaviorSummary['quality'];

  if (!touchUsable && !motionUsable) {
    quality = 'missing';
  } else if (
    (touch && isGoodQuality(touch.quality)) ||
    (motion && isGoodQuality(motion.quality))
  ) {
    quality = 'ok';
  } else {
    quality = 'review';
  }

  // ── behaviorLikelihood ──
  //
  // Derived from the quality of both collectors:
  // - Both good → 'high' (strong behavioral signal)
  // - One good, one degraded → 'medium'
  // - Both degraded (but not missing) → 'low'
  // - Both missing → null (no behavioral signal at all)
  let behaviorLikelihood: PulseGuardBehaviorSummary['behaviorLikelihood'];

  if (quality === 'missing') {
    behaviorLikelihood = null;
  } else {
    const touchGood = touch ? isGoodQuality(touch.quality) : false;
    const motionGood = motion ? isGoodQuality(motion.quality) : false;
    if (touchGood && motionGood) {
      behaviorLikelihood = 'high';
    } else if (touchGood || motionGood) {
      behaviorLikelihood = 'medium';
    } else {
      behaviorLikelihood = 'low';
    }
  }

  // ── motorConfidence (0-1) ──
  //
  // Derived from motion.variance and touch signals.
  //
  // motion.variance is the variance of acceleration magnitudes (including
  // gravity, so mean ≈ 9.8 m/s²). Interpretation:
  //   - variance < 0.01: phone is completely still (on a desk, no one
  //     holding it) → low motor confidence (0.20)
  //   - 0.01 ≤ variance < 10: normal human holding micro-movements
  //     → good motor confidence (0.65)
  //   - variance ≥ 10: excessive/erratic movement → moderate (0.45)
  //
  // Touch adjustments (applied after base):
  //   - touch_count > 0: +0.10 (active interaction confirms human presence)
  //   - pressure_supported: +0.05 (richer touch signal)
  //   - touch.quality === 'missing': -0.10 (no touch corroborates motion)
  //
  // Final value clamped to [0, 1].
  let motorConfidence: number | null;

  if (quality === 'missing') {
    motorConfidence = null;
  } else {
    const motionVariance = motion?.variance;

    if (motionVariance === undefined || motionVariance === null) {
      // No variance data — use a conservative baseline
      motorConfidence = 0.35;
    } else if (motionVariance < 0.01) {
      // Phone completely still — person likely not holding it
      motorConfidence = 0.20;
    } else if (motionVariance < 10) {
      // Normal human holding micro-movements
      motorConfidence = 0.65;
    } else {
      // Excessive movement — erratic
      motorConfidence = 0.45;
    }

    // Touch adjustments
    if (touch) {
      if (touch.touch_count > 0) motorConfidence += 0.10;
      if (touch.pressure_supported) motorConfidence += 0.05;
      if (touch.quality === 'missing' || touch.quality === 'unsupported') {
        motorConfidence -= 0.10;
      }
    }

    // Motion quality degradation
    if (motion && motion.quality === 'low') {
      motorConfidence -= 0.10;
    }

    motorConfidence = clamp01(motorConfidence);
  }

  // ── consistencyScore (0-1) ──
  //
  // Derived from motion variance stability and touch quality.
  //
  //   - Normal variance range (0.01-10): base 0.70 (stable holding)
  //   - Very low variance (< 0.01): base 0.30 (phone not held — inconsistent
  //     with active work)
  //   - Very high variance (≥ 10): base 0.40 (erratic movement)
  //   - No variance data: null (can't assess consistency)
  //
  // Touch adjustments:
  //   - touch.quality === 'ok': +0.10 (capped at 0.85)
  //   - touch.quality === 'missing': -0.10 (min 0.20)
  //
  // When quality is 'missing' overall, consistencyScore is null.
  let consistencyScore: number | null;

  if (quality === 'missing') {
    consistencyScore = null;
  } else {
    const motionVariance = motion?.variance;

    if (motionVariance === undefined || motionVariance === null) {
      consistencyScore = null;
    } else if (motionVariance < 0.01) {
      consistencyScore = 0.30;
    } else if (motionVariance < 10) {
      consistencyScore = 0.70;
    } else {
      consistencyScore = 0.40;
    }

    if (consistencyScore !== null && touch) {
      if (isGoodQuality(touch.quality)) {
        consistencyScore = Math.min(0.85, consistencyScore + 0.10);
      } else if (touch.quality === 'missing' || touch.quality === 'unsupported') {
        consistencyScore = Math.max(0.20, consistencyScore - 0.10);
      }
    }
  }

  // ── Fields left null (no honest data source) ──
  //
  // tasksObserved: PulseGuard has no named cognitive tasks.
  // totalInteractions: no equivalent to DemoGuard's per-task interaction count.
  // avgRhythmMs: no inter-task rhythm — would need individual touch timestamps
  //   (not exposed by the current touchCollector aggregate).
  // rhythmVariance: same — no rhythm data available.
  // hesitationTotal: no hesitation tracking in passive monitoring.
  // correctionTotal: no correction tracking in passive monitoring.
  //
  // These are NOT oversights — they are honest nulls. The server's
  // computeHumanState only uses motorConfidence, rhythmVariance,
  // correctionTotal, consistencyScore, avgRhythmMs, and hesitationTotal
  // for motor instability and stress scoring. With rhythmVariance,
  // correctionTotal, avgRhythmMs, and hesitationTotal all null, those
  // specific sub-scores are skipped (the `!== null` guards in
  // computeHumanState handle this). motorConfidence and consistencyScore
  // remain active, which is the honest subset we can evaluate.
  const tasksObserved = null;
  const totalInteractions = null;
  const avgRhythmMs = null;
  const rhythmVariance = null;
  const hesitationTotal = null;
  const correctionTotal = null;

  return {
    behaviorLikelihood,
    motorConfidence,
    tasksObserved,
    totalInteractions,
    avgRhythmMs,
    rhythmVariance,
    hesitationTotal,
    correctionTotal,
    consistencyScore,
    quality,
  };
}
