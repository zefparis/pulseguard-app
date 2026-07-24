/**
 * DemoGuard Cognitive Battery — N-Back 1-back challenge
 *
 * Displays a sequence of letters. User indicates if the current
 * item matches the previous one. 8 trials, ~30% target ratio.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { NBackSignal, CognitiveQuality } from './cognitiveTypes';

export const NBACK_TRIALS = 8;
export const NBACK_PRACTICE_TRIALS = 2;
export const NBACK_TARGET_RATIO = 0.3;
export const NBACK_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type NBackLetter = (typeof NBACK_LETTERS)[number];

export interface NBackTrialConfig {
  letter: NBackLetter;
  isTarget: boolean;
  isPractice?: boolean;
}

export interface NBackTrialResult {
  config: NBackTrialConfig;
  userSaidMatch: boolean;
  response_ms: number;
  isHit: boolean;
  isFalsePositive: boolean;
  isMiss: boolean;
  isCorrectRejection: boolean;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateNBackTrials(count: number = NBACK_TRIALS): NBackTrialConfig[] {
  const trials: NBackTrialConfig[] = [];
  const targetCount = Math.round(count * NBACK_TARGET_RATIO);
  let targetsPlaced = 0;

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      // First trial can never be a target (no previous)
      trials.push({
        letter: pickRandom(NBACK_LETTERS),
        isTarget: false,
      });
      continue;
    }

    const remaining = count - i;
    const targetsRemaining = targetCount - targetsPlaced;

    if (targetsRemaining > 0 && (targetsRemaining >= remaining || Math.random() < NBACK_TARGET_RATIO)) {
      // Target: same letter as previous
      trials.push({
        letter: trials[i - 1].letter,
        isTarget: true,
      });
      targetsPlaced++;
    } else {
      // Non-target: different letter from previous
      const prevLetter = trials[i - 1].letter;
      const otherLetters = NBACK_LETTERS.filter((l) => l !== prevLetter);
      trials.push({
        letter: pickRandom(otherLetters),
        isTarget: false,
      });
    }
  }

  return trials;
}

export function generateNBackPracticeTrials(): NBackTrialConfig[] {
  return [
    { letter: 'C', isTarget: false, isPractice: true },
    { letter: 'C', isTarget: true, isPractice: true },
  ];
}

export function evaluateNBackTrial(
  config: NBackTrialConfig,
  userSaidMatch: boolean,
  responseMs: number,
): NBackTrialResult {
  const isHit = config.isTarget && userSaidMatch;
  const isFalsePositive = !config.isTarget && userSaidMatch;
  const isMiss = config.isTarget && !userSaidMatch;
  const isCorrectRejection = !config.isTarget && !userSaidMatch;

  return {
    config,
    userSaidMatch,
    response_ms: Math.round(responseMs),
    isHit,
    isFalsePositive,
    isMiss,
    isCorrectRejection,
  };
}

export function computeNBackResult(results: NBackTrialResult[]): NBackSignal {
  const scoredResults = results.filter((r) => !r.config.isPractice);
  if (scoredResults.length === 0) {
    return {
      trials: 0,
      targets: 0,
      hits: 0,
      false_positives: 0,
      misses: 0,
      accuracy: 0,
      avg_response_ms: 0,
      quality: 'missing',
    };
  }

  const targets = scoredResults.filter((r) => r.config.isTarget);
  const hits = scoredResults.filter((r) => r.isHit).length;
  const falsePositives = scoredResults.filter((r) => r.isFalsePositive).length;
  const misses = scoredResults.filter((r) => r.isMiss).length;
  const correctRejections = scoredResults.filter((r) => r.isCorrectRejection).length;

  const accuracy = (hits + correctRejections) / scoredResults.length;
  const avgResponse = scoredResults.reduce((s, r) => s + r.response_ms, 0) / scoredResults.length;

  let quality: CognitiveQuality = 'ok';
  if (accuracy < 0.4) {
    quality = 'failed';
  } else if (accuracy < 0.6 || falsePositives >= 3) {
    quality = 'review';
  }

  return {
    trials: scoredResults.length,
    targets: targets.length,
    hits,
    false_positives: falsePositives,
    misses,
    accuracy: Math.round(accuracy * 100) / 100,
    avg_response_ms: Math.round(avgResponse),
    quality,
  };
}
