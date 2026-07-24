/**
 * DemoGuard Cognitive Battery — Reflex multi-round challenge
 *
 * 5 rounds minimum, random delay 700ms–2200ms.
 * Measures avg, median, variance, min, max, too_fast, too_slow, regularity.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { ReflexSignal, CognitiveQuality } from './cognitiveTypes';

export const REFLEX_ROUNDS = 5;
export const REFLEX_TOO_FAST_MS = 120;
export const REFLEX_TOO_SLOW_MS = 1800;
export const REFLEX_MIN_DELAY = 700;
export const REFLEX_MAX_DELAY = 2200;

export interface ReflexRoundResult {
  ms: number;
  too_fast: boolean;
  too_slow: boolean;
}

export function getRandomReflexDelay(): number {
  return REFLEX_MIN_DELAY + Math.random() * (REFLEX_MAX_DELAY - REFLEX_MIN_DELAY);
}

export function evaluateReflexRound(ms: number): ReflexRoundResult {
  return {
    ms: Math.round(ms),
    too_fast: ms < REFLEX_TOO_FAST_MS,
    too_slow: ms > REFLEX_TOO_SLOW_MS,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
}

/**
 * Compute regularity score: 0 = perfectly robotic (zero variance), 1 = natural.
 * CV (coefficient of variation) < 0.05 is suspiciously regular.
 */
function computeRegularity(reactionTimes: number[]): number {
  if (reactionTimes.length < 2) return 0.5;
  const avg = reactionTimes.reduce((s, v) => s + v, 0) / reactionTimes.length;
  if (avg === 0) return 0.5;
  const stdDev = Math.sqrt(variance(reactionTimes));
  const cv = stdDev / avg;
  // cv=0 → regularity=0 (robotic), cv>=0.3 → regularity=1 (natural)
  return Math.min(1, cv / 0.3);
}

export function computeReflexResult(rounds: ReflexRoundResult[]): ReflexSignal {
  if (rounds.length === 0) {
    return {
      rounds: 0,
      avg_ms: 0,
      median_ms: 0,
      variance_ms: 0,
      min_ms: 0,
      max_ms: 0,
      too_fast_count: 0,
      too_slow_count: 0,
      regularity_score: 0,
      quality: 'missing',
    };
  }

  const validRounds = rounds.filter((r) => !r.too_fast && !r.too_slow);
  const allTimes = rounds.map((r) => r.ms);
  const validTimes = validRounds.map((r) => r.ms);
  const tooFastCount = rounds.filter((r) => r.too_fast).length;
  const tooSlowCount = rounds.filter((r) => r.too_slow).length;

  if (validTimes.length === 0) {
    return {
      rounds: rounds.length,
      avg_ms: 0,
      median_ms: 0,
      variance_ms: 0,
      min_ms: Math.min(...allTimes),
      max_ms: Math.max(...allTimes),
      too_fast_count: tooFastCount,
      too_slow_count: tooSlowCount,
      regularity_score: 0,
      quality: 'failed',
    };
  }

  const avg = validTimes.reduce((s, v) => s + v, 0) / validTimes.length;
  const med = median(validTimes);
  const varr = variance(validTimes);
  const reg = computeRegularity(validTimes);

  let quality: CognitiveQuality = 'ok';
  if (tooFastCount >= 3 || tooSlowCount >= 3) {
    quality = 'failed';
  } else if (tooFastCount >= 1 || tooSlowCount >= 2 || reg < 0.15) {
    quality = 'review';
  }

  return {
    rounds: rounds.length,
    avg_ms: Math.round(avg),
    median_ms: Math.round(med),
    variance_ms: Math.round(varr),
    min_ms: Math.min(...validTimes),
    max_ms: Math.max(...validTimes),
    too_fast_count: tooFastCount,
    too_slow_count: tooSlowCount,
    regularity_score: Math.round(reg * 100) / 100,
    quality,
  };
}
