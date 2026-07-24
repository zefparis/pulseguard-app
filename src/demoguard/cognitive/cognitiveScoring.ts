/**
 * DemoGuard Cognitive Battery — Global scoring & summary
 *
 * computeCognitiveSummary() aggregates all 6 module results into
 * a single summary with depth, consistency, anomaly, and human_likelihood.
 *
 * Scoring rules:
 * - completed_modules < 3 => quality failed or review
 * - reflex alone => depth_score max 0.35
 * - reflex + voice only => depth_score max 0.45
 * - >= 4 modules coherent => depth_score >= 0.70
 * - >= 5 modules coherent => depth_score >= 0.80
 * - too_fast_count high => anomaly_score increases
 * - timings too perfect => anomaly_score increases
 * - random answers => quality review/failed
 * - accuracy very low => human_likelihood low or medium
 * - human_likelihood high only if multiple modules coherent
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type {
  CognitiveSignals,
  CognitiveSummary,
  CognitiveQuality,
  HumanLikelihood,
} from './cognitiveTypes';

function isModuleCoherent(signal: { quality: CognitiveQuality } | null): boolean {
  return signal !== null && signal.quality === 'ok';
}

export function computeCognitiveSummary(signals: CognitiveSignals): CognitiveSummary {
  const modules = [signals.reflex, signals.stroop, signals.digit_span, signals.n_back, signals.trail_tap, signals.vocal_ran];
  const completedModules = modules.filter((m) => m !== null).length;
  const coherentModules = modules.filter(isModuleCoherent).length;

  // ── Depth score ──────────────────────────────────────────────
  let depthScore = 0;

  if (completedModules === 0) {
    depthScore = 0;
  } else if (completedModules === 1) {
    // reflex alone => max 0.35
    depthScore = signals.reflex ? Math.min(0.35, 0.30 + (signals.reflex.quality === 'ok' ? 0.05 : 0)) : 0.15;
  } else if (completedModules === 2) {
    // reflex + voice only => max 0.45
    depthScore = Math.min(0.45, 0.30 + coherentModules * 0.075);
  } else if (completedModules === 3) {
    depthScore = Math.min(0.60, 0.40 + coherentModules * 0.06);
  } else if (completedModules >= 4) {
    // >= 4 modules coherent => >= 0.70
    depthScore = Math.min(0.85, 0.55 + coherentModules * 0.06);
  }

  if (coherentModules >= 5) {
    depthScore = Math.max(depthScore, 0.80);
  }

  // ── Anomaly score ────────────────────────────────────────────
  let anomalyScore = 0;

  // too_fast_count from reflex
  if (signals.reflex) {
    if (signals.reflex.too_fast_count >= 3) anomalyScore += 0.3;
    else if (signals.reflex.too_fast_count >= 1) anomalyScore += 0.15;

    // Robotic regularity (too perfect timings)
    if (signals.reflex.regularity_score < 0.10) anomalyScore += 0.25;
    else if (signals.reflex.regularity_score < 0.20) anomalyScore += 0.10;
  }

  // Random answers: low accuracy on multiple modules
  const lowAccuracyModules = [
    signals.stroop,
    signals.n_back,
    signals.digit_span,
  ].filter((m) => m !== null && m.accuracy < 0.4).length;

  if (lowAccuracyModules >= 2) anomalyScore += 0.3;
  else if (lowAccuracyModules >= 1) anomalyScore += 0.15;

  // High false positives on n_back
  if (signals.n_back && signals.n_back.false_positives >= 3) anomalyScore += 0.1;

  anomalyScore = Math.min(1, anomalyScore);

  // ── Consistency score ────────────────────────────────────────
  let consistencyScore = 0;

  if (completedModules > 0) {
    // Cross reaction variance, response times, accuracy, completion patterns
    const accuracyScores: number[] = [];
    if (signals.stroop) accuracyScores.push(signals.stroop.accuracy);
    if (signals.n_back) accuracyScores.push(signals.n_back.accuracy);
    if (signals.digit_span) accuracyScores.push(signals.digit_span.accuracy);

    const avgAccuracy = accuracyScores.length > 0
      ? accuracyScores.reduce((s, v) => s + v, 0) / accuracyScores.length
      : 0.5;

    const reflexConsistency = signals.reflex
      ? Math.min(1, 1 - signals.reflex.variance_ms / 10000)
      : 0.5;

    const completionRatio = completedModules / 6;

    consistencyScore = (avgAccuracy * 0.4 + reflexConsistency * 0.3 + completionRatio * 0.3);
    consistencyScore = Math.min(1, Math.max(0, consistencyScore));
  }

  // ── Quality ──────────────────────────────────────────────────
  let quality: CognitiveQuality = 'ok';
  if (completedModules < 3) {
    quality = completedModules === 0 ? 'failed' : 'review';
  } else if (anomalyScore >= 0.5 || coherentModules < 2) {
    quality = 'review';
  } else if (anomalyScore >= 0.7) {
    quality = 'failed';
  }

  // ── Human likelihood ─────────────────────────────────────────
  let humanLikelihood: HumanLikelihood = 'low';

  if (coherentModules >= 4 && anomalyScore < 0.3 && avgModuleAccuracy(signals) >= 0.6) {
    humanLikelihood = 'high';
  } else if (coherentModules >= 2 && anomalyScore < 0.5 && avgModuleAccuracy(signals) >= 0.4) {
    humanLikelihood = 'medium';
  }

  return {
    completed_modules: completedModules,
    total_modules: 6,
    depth_score: Math.round(depthScore * 100) / 100,
    consistency_score: Math.round(consistencyScore * 100) / 100,
    anomaly_score: Math.round(anomalyScore * 100) / 100,
    human_likelihood: humanLikelihood,
    quality,
  };
}

function avgModuleAccuracy(signals: CognitiveSignals): number {
  const accuracies: number[] = [];
  if (signals.stroop) accuracies.push(signals.stroop.accuracy);
  if (signals.n_back) accuracies.push(signals.n_back.accuracy);
  if (signals.digit_span) accuracies.push(signals.digit_span.accuracy);
  if (accuracies.length === 0) return 0.5;
  return accuracies.reduce((s, v) => s + v, 0) / accuracies.length;
}
