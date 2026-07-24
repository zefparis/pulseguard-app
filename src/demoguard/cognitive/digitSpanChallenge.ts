/**
 * DemoGuard Cognitive Battery — Digit Span challenge
 *
 * Displays sequences of digits (progressive length 3→5/6).
 * User must retype the sequence. Measures max_span, accuracy, positional_errors.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { DigitSpanSignal, CognitiveQuality } from './cognitiveTypes';

export const DIGIT_SPAN_TRIALS = 3;
export const DIGIT_SPAN_START_LENGTH = 3;
export const DIGIT_SPAN_MAX_LENGTH = 6;

export interface DigitSpanTrialConfig {
  sequence: number[];
  span: number;
}

export interface DigitSpanTrialResult {
  config: DigitSpanTrialConfig;
  userInput: number[];
  correct: boolean;
  positional_errors: number;
}

function generateDigits(length: number): number[] {
  const digits: number[] = [];
  for (let i = 0; i < length; i++) {
    digits.push(Math.floor(Math.random() * 10));
  }
  return digits;
}

export function generateDigitSpanTrials(
  count: number = DIGIT_SPAN_TRIALS,
  startLength: number = DIGIT_SPAN_START_LENGTH,
  maxLength: number = DIGIT_SPAN_MAX_LENGTH,
): DigitSpanTrialConfig[] {
  const trials: DigitSpanTrialConfig[] = [];
  for (let i = 0; i < count; i++) {
    const span = Math.min(startLength + i, maxLength);
    trials.push({
      sequence: generateDigits(span),
      span,
    });
  }
  return trials;
}

function countPositionalErrors(expected: number[], actual: number[]): number {
  const len = Math.max(expected.length, actual.length);
  let errors = 0;
  for (let i = 0; i < len; i++) {
    if (expected[i] !== actual[i]) errors++;
  }
  return errors;
}

export function computeDigitSpanResult(results: DigitSpanTrialResult[]): DigitSpanSignal {
  if (results.length === 0) {
    return {
      trials: 0,
      max_span: 0,
      accuracy: 0,
      positional_errors: 0,
      quality: 'missing',
    };
  }

  const correctTrials = results.filter((r) => r.correct);
  const maxSpan = correctTrials.length > 0
    ? Math.max(...correctTrials.map((r) => r.config.span))
    : 0;
  const accuracy = correctTrials.length / results.length;
  const totalPositionalErrors = results.reduce((s, r) => s + r.positional_errors, 0);

  let quality: CognitiveQuality = 'ok';
  if (accuracy === 0) {
    quality = 'failed';
  } else if (accuracy < 0.5 || maxSpan < 3) {
    quality = 'review';
  }

  return {
    trials: results.length,
    max_span: maxSpan,
    accuracy: Math.round(accuracy * 100) / 100,
    positional_errors: totalPositionalErrors,
    quality,
  };
}

export function evaluateDigitSpanTrial(
  config: DigitSpanTrialConfig,
  userInput: number[],
): DigitSpanTrialResult {
  const positional_errors = countPositionalErrors(config.sequence, userInput);
  const correct = positional_errors === 0 && userInput.length === config.sequence.length;
  return {
    config,
    userInput,
    correct,
    positional_errors,
  };
}
