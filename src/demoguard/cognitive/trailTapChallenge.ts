/**
 * DemoGuard Cognitive Battery — Trail Tap sequence challenge
 *
 * Displays 5–7 numbered nodes. User must tap in order.
 * Measures completion_ms, wrong_taps, hesitation_count, path_efficiency.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { TrailTapSignal, CognitiveQuality } from './cognitiveTypes';

export const TRAIL_TAP_MIN_NODES = 5;
export const TRAIL_TAP_MAX_NODES = 7;
export const TRAIL_TAP_HESITATION_MS = 1500;

export interface TrailTapNode {
  id: number;
  x: number;
  y: number;
}

export interface TrailTapEvent {
  nodeId: number;
  timestamp: number;
  correct: boolean;
}

export interface NormalizedTrailPoint {
  id: number;
  nx: number;
  ny: number;
}

const NORMALIZED_TRAIL_POINTS: NormalizedTrailPoint[] = [
  { id: 1, nx: 0.22, ny: 0.72 },
  { id: 2, nx: 0.78, ny: 0.45 },
  { id: 3, nx: 0.48, ny: 0.25 },
  { id: 4, nx: 0.18, ny: 0.48 },
  { id: 5, nx: 0.68, ny: 0.78 },
  { id: 6, nx: 0.82, ny: 0.20 },
  { id: 7, nx: 0.35, ny: 0.55 },
];

export function generateNormalizedTrailPoints(count: number = TRAIL_TAP_MIN_NODES): NormalizedTrailPoint[] {
  return NORMALIZED_TRAIL_POINTS.slice(0, count);
}

export function computeTrailTapLayout(
  areaWidth: number,
  areaHeight: number,
  normalizedPoints: NormalizedTrailPoint[],
  nodeRadius: number = 24,
): TrailTapNode[] {
  const padding = nodeRadius + 8;
  const usableWidth = Math.max(0, areaWidth - padding * 2);
  const usableHeight = Math.max(0, areaHeight - padding * 2);

  return normalizedPoints.map((p) => ({
    id: p.id,
    x: Math.round(padding + Math.max(0, Math.min(1, p.nx)) * usableWidth),
    y: Math.round(padding + Math.max(0, Math.min(1, p.ny)) * usableHeight),
  }));
}

export function computeNodeRadius(areaWidth: number): number {
  return Math.round(Math.max(20, Math.min(32, areaWidth * 0.08)));
}

export function generateTrailTapNodes(count: number = TRAIL_TAP_MIN_NODES): TrailTapNode[] {
  return computeTrailTapLayout(300, 400, generateNormalizedTrailPoints(count));
}

function distance(a: TrailTapNode, b: TrailTapNode): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Path efficiency = optimal path distance / actual path distance.
 * 1.0 = perfect direct path, <1.0 = user wandered.
 */
function computePathEfficiency(
  nodes: TrailTapNode[],
  events: TrailTapEvent[],
): number {
  const correctEvents = events.filter((e) => e.correct);
  if (correctEvents.length < 2) return 0;

  // Optimal path: sequential distance through nodes
  let optimalDistance = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    optimalDistance += distance(nodes[i], nodes[i + 1]);
  }

  // Actual path: distance between consecutive correct taps
  let actualDistance = 0;
  for (let i = 1; i < correctEvents.length; i++) {
    const prevNode = nodes[correctEvents[i - 1].nodeId - 1];
    const currNode = nodes[correctEvents[i].nodeId - 1];
    if (prevNode && currNode) {
      actualDistance += distance(prevNode, currNode);
    }
  }

  if (actualDistance === 0) return 0;
  return Math.min(1, optimalDistance / actualDistance);
}

function countHesitations(events: TrailTapEvent[]): number {
  const correctEvents = events.filter((e) => e.correct);
  let hesitations = 0;
  for (let i = 1; i < correctEvents.length; i++) {
    const gap = correctEvents[i].timestamp - correctEvents[i - 1].timestamp;
    if (gap > TRAIL_TAP_HESITATION_MS) hesitations++;
  }
  return hesitations;
}

export function computeTrailTapResult(
  nodes: TrailTapNode[],
  events: TrailTapEvent[],
  completionMs: number,
): TrailTapSignal {
  if (events.length === 0) {
    return {
      nodes: nodes.length,
      completion_ms: 0,
      wrong_taps: 0,
      hesitation_count: 0,
      path_efficiency: 0,
      quality: 'missing',
    };
  }

  const wrongTaps = events.filter((e) => !e.correct).length;
  const hesitations = countHesitations(events);
  const pathEff = computePathEfficiency(nodes, events);
  const correctCount = events.filter((e) => e.correct).length;

  let quality: CognitiveQuality = 'ok';
  if (correctCount < nodes.length || wrongTaps >= 4) {
    quality = 'failed';
  } else if (wrongTaps >= 2 || hesitations >= 3 || pathEff < 0.5) {
    quality = 'review';
  }

  return {
    nodes: nodes.length,
    completion_ms: Math.round(completionMs),
    wrong_taps: wrongTaps,
    hesitation_count: hesitations,
    path_efficiency: Math.round(pathEff * 100) / 100,
    quality,
  };
}
