/**
 * DemoGuard Cognitive Battery — Stroop color-word conflict challenge
 *
 * Displays color words in conflicting colors. User must select the
 * displayed color, not the word. Minimum 6 trials, at least 3 conflict.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { StroopSignal, CognitiveQuality } from './cognitiveTypes';

export const STROOP_TRIALS = 6;
export const STROOP_PRACTICE_TRIALS = 2;
export const STROOP_MIN_CONFLICT = 3;

export const STROOP_COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export type StroopColor = (typeof STROOP_COLORS)[number];

export const STROOP_COLOR_WORDS: Record<string, Record<StroopColor, string>> = {
  fr: { red: 'ROUGE', blue: 'BLEU', green: 'VERT', yellow: 'JAUNE' },
  en: { red: 'RED', blue: 'BLUE', green: 'GREEN', yellow: 'YELLOW' },
};

export function stroopColorWord(color: StroopColor, locale: string): string {
  const dict = STROOP_COLOR_WORDS[locale] ?? STROOP_COLOR_WORDS.fr;
  return dict[color];
}

export interface StroopTrialConfig {
  word: StroopColor;
  displayColor: StroopColor;
  isConflict: boolean;
  isPractice?: boolean;
}

export interface StroopTrialResult {
  config: StroopTrialConfig;
  selected: StroopColor;
  correct: boolean;
  response_ms: number;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateStroopTrials(count: number = STROOP_TRIALS): StroopTrialConfig[] {
  const trials: StroopTrialConfig[] = [];
  let conflictCount = 0;

  for (let i = 0; i < count; i++) {
    const word = pickRandom(STROOP_COLORS);
    let displayColor: StroopColor;

    // Ensure at least 3 conflict trials
    if (conflictCount < STROOP_MIN_CONFLICT && (i >= count - STROOP_MIN_CONFLICT + conflictCount || Math.random() < 0.5)) {
      displayColor = pickRandom(STROOP_COLORS.filter((c) => c !== word));
      conflictCount++;
    } else {
      // Non-conflict or remaining
      if (Math.random() < 0.4) {
        displayColor = word;
      } else {
        displayColor = pickRandom(STROOP_COLORS.filter((c) => c !== word));
        conflictCount++;
      }
    }

    trials.push({
      word,
      displayColor,
      isConflict: word !== displayColor,
    });
  }

  // Guarantee minimum conflict trials
  if (conflictCount < STROOP_MIN_CONFLICT) {
    for (let i = 0; i < trials.length && conflictCount < STROOP_MIN_CONFLICT; i++) {
      if (!trials[i].isConflict) {
        trials[i] = {
          ...trials[i],
          displayColor: pickRandom(STROOP_COLORS.filter((c) => c !== trials[i].word)),
          isConflict: true,
        };
        conflictCount++;
      }
    }
  }

  return trials;
}

export function generateStroopPracticeTrials(): StroopTrialConfig[] {
  return [
    { word: 'red', displayColor: 'blue', isConflict: true, isPractice: true },
    { word: 'green', displayColor: 'red', isConflict: true, isPractice: true },
  ];
}

export function computeStroopResult(results: StroopTrialResult[]): StroopSignal {
  const scoredResults = results.filter((r) => !r.config.isPractice);
  if (scoredResults.length === 0) {
    return {
      trials: 0,
      conflict_trials: 0,
      accuracy: 0,
      avg_response_ms: 0,
      conflict_cost_ms: 0,
      error_count: 0,
      quality: 'missing',
    };
  }

  const correct = scoredResults.filter((r) => r.correct);
  const errors = scoredResults.filter((r) => !r.correct);
  const conflictTrials = scoredResults.filter((r) => r.config.isConflict);
  const nonConflictTrials = scoredResults.filter((r) => !r.config.isConflict);

  const accuracy = correct.length / scoredResults.length;
  const avgResponse = scoredResults.reduce((s, r) => s + r.response_ms, 0) / scoredResults.length;

  const conflictAvg = conflictTrials.length > 0
    ? conflictTrials.reduce((s, r) => s + r.response_ms, 0) / conflictTrials.length
    : 0;
  const nonConflictAvg = nonConflictTrials.length > 0
    ? nonConflictTrials.reduce((s, r) => s + r.response_ms, 0) / nonConflictTrials.length
    : 0;
  const conflictCost = Math.max(0, conflictAvg - nonConflictAvg);

  let quality: CognitiveQuality = 'ok';
  if (accuracy < 0.4) {
    quality = 'failed';
  } else if (accuracy < 0.6) {
    quality = 'review';
  }

  return {
    trials: scoredResults.length,
    conflict_trials: conflictTrials.length,
    accuracy: Math.round(accuracy * 100) / 100,
    avg_response_ms: Math.round(avgResponse),
    conflict_cost_ms: Math.round(conflictCost),
    error_count: errors.length,
    quality,
  };
}
