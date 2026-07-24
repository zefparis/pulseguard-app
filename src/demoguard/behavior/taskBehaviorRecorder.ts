/**
 * DemoGuard — Task behavior recorder (non-singleton)
 *
 * Provides per-task recording helpers that screens call during each
 * cognitive module. Each helper feeds the BehaviorSession instance
 * with safe aggregate data.
 *
 * No raw coordinates, raw paths, or raw traces stored.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { BehaviorSession } from './behaviorSession';
import type { CognitiveTaskName } from './behaviorTypes';

export function recordTaskStart(session: BehaviorSession, task: CognitiveTaskName): void {
  session.startTask(task);
}

export function recordReflexTap(session: BehaviorSession, _reactionMs: number, tooFast: boolean): void {
  session.recordInteraction('reflex', {
    isWrongTap: tooFast,
  });
}

export function recordStroopSelection(
  session: BehaviorSession,
  _color: string,
  isCorrect: boolean,
  _responseMs: number,
  isCorrection: boolean,
): void {
  session.recordInteraction('stroop', {
    isCorrection,
    isWrongTap: !isCorrect,
  });
}

export function recordDigitSpanKey(session: BehaviorSession, isDeletion: boolean): void {
  session.recordInteraction('digit_span', {
    isCorrection: isDeletion,
  });
}

export function recordDigitSpanSubmit(session: BehaviorSession): void {
  session.recordInteraction('digit_span');
}

export function recordNBackDecision(
  session: BehaviorSession,
  isCorrect: boolean,
  _responseMs: number,
): void {
  session.recordInteraction('n_back', {
    isWrongTap: !isCorrect,
  });
}

export function recordTrailTap(
  session: BehaviorSession,
  isCorrect: boolean,
  pathSegmentDistance: number | null,
  optimalSegmentDistance: number | null,
): void {
  session.recordInteraction('trail_tap', {
    isWrongTap: !isCorrect,
    pathSegmentDistance,
    optimalSegmentDistance,
  });
}
