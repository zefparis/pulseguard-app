/**
 * DemoGuard — Behavior scoring
 *
 * Computes TaskTouchBehavior from raw interaction records and
 * BehaviorSummary from all task behaviors.
 *
 * No raw data stored — only safe aggregates.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type {
  CognitiveTaskName,
  TaskTouchBehavior,
  BehaviorSummary,
  BehaviorQuality,
} from './behaviorTypes';

interface InteractionRecord {
  task: CognitiveTaskName;
  timestamp: number;
  pressure: number | null;
  isCorrection: boolean;
  isWrongTap: boolean;
  pathSegmentDistance: number | null;
  optimalSegmentDistance: number | null;
}

const HESITATION_THRESHOLD_MS = 1500;

// Task-specific max hesitation counts for 'ok' quality.
// The old single thresholds (review >= 3, failed >= 5) were calibrated for motor tasks
// but too strict for cognitive tasks where thinking time creates natural pauses > 1500ms.
// See BEHAVIOR_HESITATION_DIAG_01.md — payguard retains the old global thresholds (legacy).
const HESITATION_THRESHOLDS_PER_TASK: Record<CognitiveTaskName, number> = {
  reflex: 1,       // Fast motor reaction — 0-1 hesitation normal
  stroop: 2,       // Cognitive conflict — 1-2 hesitations normal
  digit_span: 4,   // Memory recall — 2-4 hesitations normal (recall pauses)
  n_back: 3,       // Working memory — 1-3 hesitations normal
  trail_tap: 1,    // Spatial motor — 0-1 hesitation
  vocal_ran: 2,    // Vocal response — 1-2 hesitations
};

// Task-specific variance thresholds for inter-action intervals (ms²).
// The old single threshold of 500_000 (σ ≈ 707ms) was calibrated for motor tasks
// but too strict for cognitive tasks where thinking time creates natural variance.
// See BEHAVIOR_VARIANCE_FIX_01.md — payguard retains the old 500_000 threshold (legacy).
const VARIANCE_THRESHOLDS: Record<CognitiveTaskName, number> = {
  reflex: 100_000,       // Fast motor reaction — strict, σ ≈ 316ms
  stroop: 2_000_000,     // Cognitive conflict — permissive, σ ≈ 1414ms
  digit_span: 3_000_000, // Memory recall — very permissive, σ ≈ 1732ms
  n_back: 1_500_000,     // Working memory — permissive, σ ≈ 1225ms
  trail_tap: 1_000_000,  // Spatial motor — moderate, σ ≈ 1000ms
  vocal_ran: 2_000_000,  // Vocal response — permissive, σ ≈ 1414ms
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
}

export function computeTaskBehavior(
  task: CognitiveTaskName,
  records: InteractionRecord[],
): TaskTouchBehavior {
  const interactionCount = records.length;
  const timestamps = records.map((r) => r.timestamp);

  // Inter-action intervals
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }

  const avgInterActionMs = intervals.length > 0 ? Math.round(mean(intervals)) : null;
  const varianceInterActionMs = intervals.length > 1 ? Math.round(variance(intervals)) : null;

  // Hesitation: gaps > threshold
  let hesitationCount = 0;
  for (const interval of intervals) {
    if (interval > HESITATION_THRESHOLD_MS) hesitationCount++;
  }

  // Corrections
  const correctionCount = records.filter((r) => r.isCorrection).length;

  // Wrong taps
  const wrongTapCount = records.filter((r) => r.isWrongTap).length;

  // Pressure
  const pressureRecords = records.filter((r) => r.pressure !== null && r.pressure > 0);
  const pressureAvailable = pressureRecords.length > 0;
  const avgPressure = pressureAvailable
    ? Math.round(mean(pressureRecords.map((r) => r.pressure!)) * 1000) / 1000
    : null;

  // Path efficiency (trail_tap specific)
  let pathEfficiency: number | null = null;
  const pathRecords = records.filter(
    (r) => r.pathSegmentDistance !== null && r.optimalSegmentDistance !== null,
  );
  if (pathRecords.length > 0) {
    const totalActual = pathRecords.reduce((s, r) => s + (r.pathSegmentDistance ?? 0), 0);
    const totalOptimal = pathRecords.reduce((s, r) => s + (r.optimalSegmentDistance ?? 0), 0);
    if (totalActual > 0) {
      pathEfficiency = Math.min(1, totalOptimal / totalActual);
      pathEfficiency = Math.round(pathEfficiency * 100) / 100;
    }
  }

  // Behavior quality — hesitation thresholds are task-specific (BEHAVIOR-HESITATION-FIX-01)
  const hesitOkThreshold = HESITATION_THRESHOLDS_PER_TASK[task];
  const hesitFailedThreshold = Math.max(4, hesitOkThreshold * 2);
  let behaviorQuality: BehaviorQuality = 'ok';
  if (interactionCount === 0) {
    behaviorQuality = 'missing';
  } else if (wrongTapCount >= 4 || hesitationCount >= hesitFailedThreshold) {
    behaviorQuality = 'failed';
  } else if (wrongTapCount >= 2 || hesitationCount > hesitOkThreshold || (varianceInterActionMs !== null && varianceInterActionMs > VARIANCE_THRESHOLDS[task])) {
    behaviorQuality = 'review';
  }

  return {
    task,
    interactionCount,
    avgInterActionMs,
    varianceInterActionMs,
    hesitationCount,
    correctionCount,
    wrongTapCount: task === 'trail_tap' ? wrongTapCount : undefined,
    pressureAvailable,
    avgPressure,
    pathEfficiency: task === 'trail_tap' ? pathEfficiency : undefined,
    behaviorQuality,
  };
}

export function computeBehaviorSummary(
  taskBehaviors: Partial<Record<CognitiveTaskName, TaskTouchBehavior>>,
): BehaviorSummary {
  const behaviors = Object.values(taskBehaviors).filter((b): b is TaskTouchBehavior => b !== null);
  const tasksObserved = behaviors.length;
  const totalInteractions = behaviors.reduce((s, b) => s + b.interactionCount, 0);
  const hesitationTotal = behaviors.reduce((s, b) => s + b.hesitationCount, 0);
  const correctionTotal = behaviors.reduce((s, b) => s + b.correctionCount, 0);

  // Rhythm: average of per-task avgInterActionMs
  const rhythmValues = behaviors
    .map((b) => b.avgInterActionMs)
    .filter((v): v is number => v !== null);
  const avgRhythmMs = rhythmValues.length > 0 ? Math.round(mean(rhythmValues)) : null;

  // Rhythm variance: average of per-task varianceInterActionMs
  const rhythmVarianceValues = behaviors
    .map((b) => b.varianceInterActionMs)
    .filter((v): v is number => v !== null);
  const rhythmVariance = rhythmVarianceValues.length > 0 ? Math.round(mean(rhythmVarianceValues)) : null;

  // Consistency score: based on rhythm regularity and low corrections
  // hesitationPenalty is now per-task (BEHAVIOR-QUALITY-FIX-01): each task's hesitationCount
  // is compared to 2× its HESITATION_THRESHOLDS_PER_TASK value, producing a continuous ratio
  // (0 = no hesitation, 1 = at 2× threshold). The average across tasks gives a per-task
  // penalty that is coherent with the per-task behaviorQuality and VARIANCE_THRESHOLDS.
  // The old global `hesitationTotal / 10` penalized all tasks equally for a high total,
  // even if most tasks were within their individual thresholds.
  let consistencyScore = 0;
  if (tasksObserved > 0) {
    const okTasks = behaviors.filter((b) => b.behaviorQuality === 'ok').length;
    const okRatio = okTasks / tasksObserved;
    const correctionPenalty = Math.min(1, correctionTotal / 10);
    const perTaskHesitationPenalties = behaviors.map((b) => {
      const threshold = HESITATION_THRESHOLDS_PER_TASK[b.task];
      return Math.min(1, b.hesitationCount / (threshold * 2));
    });
    const hesitationPenalty = perTaskHesitationPenalties.reduce((s, p) => s + p, 0) / tasksObserved;
    consistencyScore = Math.max(0, Math.min(1, okRatio * 0.5 + (1 - correctionPenalty) * 0.25 + (1 - hesitationPenalty) * 0.25));
    consistencyScore = Math.round(consistencyScore * 100) / 100;
  }

  // Motor confidence: based on interaction count and pressure availability
  let motorConfidence = 0;
  if (totalInteractions > 0) {
    const interactionFactor = Math.min(1, totalInteractions / 20);
    const taskFactor = Math.min(1, tasksObserved / 6);
    const pressureFactor = behaviors.some((b) => b.pressureAvailable) ? 0.1 : 0;
    motorConfidence = Math.min(1, interactionFactor * 0.4 + taskFactor * 0.5 + pressureFactor);
    motorConfidence = Math.round(motorConfidence * 100) / 100;
  }

  // Behavior likelihood
  let behaviorLikelihood: 'high' | 'medium' | 'low' = 'low';
  if (tasksObserved >= 4 && consistencyScore >= 0.7 && totalInteractions >= 15) {
    behaviorLikelihood = 'high';
  } else if (tasksObserved >= 2 && consistencyScore >= 0.4 && totalInteractions >= 5) {
    behaviorLikelihood = 'medium';
  }

  // Overall quality
  // NOTE: This 'quality' field is what the admin E2E Trace displays as "Behavior quality".
  // It is computed here (demoguard-app) and can diverge from 'behaviorStatus' computed
  // in hybrid-vector-api/demoguardFusionTrigger.ts:computeBehaviorStatus() which uses
  // motorConfidence + tasksObserved only (no consistencyScore). See BEHAVIOR_VARIANCE_FIX_01.md.
  //
  // Hesitation is now evaluated per-task via behaviorQuality (task-specific thresholds),
  // not via a global hesitationTotal hard cutoff. The old `hesitationTotal <= 3` was
  // impossible to meet across 5 heterogeneous cognitive tasks (see BEHAVIOR_HESITATION_DIAG_01.md).
  // Per-task hesitation is reflected in okRatio → consistencyScore, which gates quality='ok'.
  let quality: 'ok' | 'review' | 'failed' = 'failed';
  if (tasksObserved === 0) {
    quality = 'failed';
  } else if (tasksObserved >= 4 && consistencyScore >= 0.5) {
    quality = 'ok';
  } else if (tasksObserved >= 2) {
    quality = 'review';
  }

  return {
    tasksObserved,
    totalInteractions,
    avgRhythmMs,
    rhythmVariance,
    hesitationTotal,
    correctionTotal,
    consistencyScore,
    motorConfidence,
    behaviorLikelihood,
    quality,
  };
}
