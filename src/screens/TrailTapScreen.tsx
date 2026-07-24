/**
 * PulseGuard — TrailTapScreen (sequential path tapping test)
 *
 * Adapted from DemoGuard for cognitive enrollment (no camera phase).
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useEffect, useState, useRef } from 'react';
import {
  TRAIL_TAP_MIN_NODES,
  generateNormalizedTrailPoints,
  computeTrailTapLayout,
  computeNodeRadius,
  computeTrailTapResult,
} from '../demoguard/cognitive/trailTapChallenge';
import type { TrailTapSignal } from '../demoguard/cognitive/cognitiveTypes';
import type { TrailTapNode, TrailTapEvent } from '../demoguard/cognitive/trailTapChallenge';
import { recordTaskStart, recordTrailTap } from '../demoguard/behavior/taskBehaviorRecorder';
import type { BehaviorSession } from '../demoguard/behavior/behaviorSession';
import { PhaseHeader } from '../components/PhaseHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useI18n } from '../i18n/I18nContext';

interface Props {
  session: BehaviorSession;
  onComplete: (signal: TrailTapSignal) => void;
  onError: (reason: string) => void;
}

const AREA_W = 300;
const AREA_H = 320;

export function TrailTapScreen({ session, onComplete }: Props) {
  const { t } = useI18n();
  const [nodes] = useState<TrailTapNode[]>(() => {
    const normalized = generateNormalizedTrailPoints(TRAIL_TAP_MIN_NODES);
    const radius = computeNodeRadius(AREA_W);
    return computeTrailTapLayout(AREA_W, AREA_H, normalized, radius);
  });
  const [events, setEvents] = useState<TrailTapEvent[]>([]);
  const [nextIdx, setNextIdx] = useState(0);
  const [wrongNodeId, setWrongNodeId] = useState<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const completedRef = useRef(false);

  useEffect(() => {
    recordTaskStart(session, 'trail_tap');
    startTimeRef.current = performance.now();
  }, []);

  const handleTap = (node: TrailTapNode) => {
    if (completedRef.current) return;
    const expectedId = nextIdx + 1;
    const correct = node.id === expectedId;
    const event: TrailTapEvent = { nodeId: node.id, timestamp: performance.now(), correct };

    if (correct) {
      const prevNode = nextIdx > 0 ? nodes[nextIdx - 1] : null;
      const pathDist = prevNode ? Math.sqrt((node.x - prevNode.x) ** 2 + (node.y - prevNode.y) ** 2) : null;
      const optimalDist = prevNode ? pathDist : null;
      recordTrailTap(session, true, pathDist, optimalDist);
      const newEvents = [...events, event];
      setEvents(newEvents);
      setNextIdx(nextIdx + 1);

      if (nextIdx + 1 >= nodes.length) {
        completedRef.current = true;
        const completionMs = performance.now() - startTimeRef.current;
        const signal = computeTrailTapResult(nodes, newEvents, completionMs);
        onComplete(signal);
      }
    } else {
      recordTrailTap(session, false, null, null);
      setEvents([...events, event]);
      setWrongNodeId(node.id);
      setTimeout(() => setWrongNodeId(null), 500);
    }
  };

  return (
    <div className="screen">
      <PhaseHeader title={t('trailTap.title')} progress="5/6" progressPct={83} />
      <ErrorBoundary onRetry={() => { setEvents([]); setNextIdx(0); completedRef.current = false; startTimeRef.current = performance.now(); }}>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 8 }}>
          {t('trailTap.instruction')} (1 {t('trailTap.to')} {nodes.length})
        </p>
        <div className="trail-area" style={{ width: '100%', maxWidth: AREA_W, margin: '0 auto' }}>
          {nodes.map((node) => {
            const tapped = node.id <= nextIdx;
            const isWrong = wrongNodeId === node.id;
            const radius = computeNodeRadius(AREA_W);
            return (
              <div
                key={node.id}
                className={`trail-node ${tapped ? 'tapped' : ''} ${isWrong ? 'wrong' : ''}`}
                style={{
                  left: `${(node.x / AREA_W) * 100}%`,
                  top: `${(node.y / AREA_H) * 100}%`,
                  width: `${radius * 2}px`,
                  height: `${radius * 2}px`,
                }}
                onClick={() => handleTap(node)}
              >
                {node.id}
              </div>
            );
          })}
        </div>
      </ErrorBoundary>
    </div>
  );
}
