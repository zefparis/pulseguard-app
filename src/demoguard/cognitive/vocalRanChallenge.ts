/**
 * DemoGuard Cognitive Battery — Vocal RAN (Rapid Automatised Naming)
 *
 * Displays 5 symbols/digits. User reads them aloud in order.
 * Collects duration, challenge_id, expected_sequence_hash, audio_present.
 * Never exposes raw sequence in terminal/API response.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { VocalRanSignal, CognitiveQuality } from './cognitiveTypes';

export const VOCAL_RAN_ITEMS = 5;
export const VOCAL_RAN_SYMBOLS = ['3', '7', '1', '9', '4', '2', '6', '8', '5', '0'];

/**
 * Generate a simple hash of the expected sequence.
 * Uses a non-cryptographic hash — purpose is uniqueness, not security.
 * Never expose the raw sequence in UI/logs/response.
 */
export function hashSequence(sequence: string[]): string {
  const str = sequence.join(',');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  // Convert to unsigned hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateVocalRanChallengeId(): string {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `dg_vran_${code}`;
}

export interface VocalRanChallenge {
  challenge_id: string;
  sequence: string[];
  expected_hash: string;
  items_count: number;
}

export function generateVocalRanChallenge(
  itemsCount: number = VOCAL_RAN_ITEMS,
): VocalRanChallenge {
  const sequence: string[] = [];
  for (let i = 0; i < itemsCount; i++) {
    sequence.push(VOCAL_RAN_SYMBOLS[Math.floor(Math.random() * VOCAL_RAN_SYMBOLS.length)]);
  }

  return {
    challenge_id: generateVocalRanChallengeId(),
    expected_hash: hashSequence(sequence),
    items_count: itemsCount,
    sequence, // Only used internally — never sent in safe payload
  };
}

export function computeVocalRanResult(
  challenge: VocalRanChallenge,
  durationMs: number,
  audioPresent: boolean,
): VocalRanSignal {
  let quality: CognitiveQuality = 'ok';
  if (!audioPresent) {
    quality = 'failed';
  } else if (durationMs < 1000 || durationMs > 15000) {
    quality = 'review';
  }

  return {
    items_count: challenge.items_count,
    duration_ms: Math.round(durationMs),
    challenge_id: challenge.challenge_id,
    expected_hash: challenge.expected_hash,
    audio_present: audioPresent,
    quality,
  };
}
