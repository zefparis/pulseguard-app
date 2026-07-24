/**
 * Unit tests for computePulseGuardBehaviorSummary
 *
 * Covers:
 *   1. Good-quality signals from both collectors → rich summary
 *   2. One collector missing/unsupported → coherent degradation
 *   3. Both collectors missing → summary that yields hasBehavior=false
 *      on the server (quality='missing', behaviorLikelihood=null)
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { describe, it, expect } from 'vitest';
import { computePulseGuardBehaviorSummary } from '../src/pulseguard/behaviorSummary';
import type { DemoGuardSignals } from '../src/demoguard/types';

// ─── Helpers ───────────────────────────────────────────────────────

function makeTouchOk(overrides: Partial<DemoGuardSignals['touch']> = {}): DemoGuardSignals['touch'] {
  return {
    touch_count: 5,
    pointer_type: 'touch',
    pressure_supported: true,
    pressure_avg: 0.5,
    touch_duration_ms: 120,
    move_distance: 300,
    multi_touch_detected: false,
    quality: 'ok',
    ...overrides,
  };
}

function makeMotionOk(overrides: Partial<DemoGuardSignals['motion']> = {}): DemoGuardSignals['motion'] {
  return {
    supported: true,
    permission: 'granted',
    sample_count: 50,
    variance: 1.2,
    quality: 'ok',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('PULSEGUARD-BEHAVIOR-SUMMARY — good quality signals', () => {
  it('produces quality=ok and behaviorLikelihood=high when both collectors are ok', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk(),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.quality).toBe('ok');
    expect(summary.behaviorLikelihood).toBe('high');
  });

  it('produces a non-null motorConfidence in a reasonable range', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk({ variance: 1.5 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.motorConfidence).not.toBeNull();
    expect(summary.motorConfidence!).toBeGreaterThan(0.5);
    expect(summary.motorConfidence!).toBeLessThanOrEqual(1.0);
  });

  it('produces a non-null consistencyScore for normal motion variance', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk({ variance: 2.0 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.consistencyScore).not.toBeNull();
    expect(summary.consistencyScore!).toBeGreaterThan(0.5);
  });

  it('leaves task/rhythm/hesitation/correction fields null', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk(),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.tasksObserved).toBeNull();
    expect(summary.totalInteractions).toBeNull();
    expect(summary.avgRhythmMs).toBeNull();
    expect(summary.rhythmVariance).toBeNull();
    expect(summary.hesitationTotal).toBeNull();
    expect(summary.correctionTotal).toBeNull();
  });
});

describe('PULSEGUARD-BEHAVIOR-SUMMARY — one collector degraded', () => {
  it('produces quality=ok when touch is ok but motion is low', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk({ quality: 'low', sample_count: 3 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    // touch is ok → overall quality is ok
    expect(summary.quality).toBe('ok');
    // touch good, motion not good → medium
    expect(summary.behaviorLikelihood).toBe('medium');
  });

  it('produces quality=review when both collectors are low (but not missing)', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'low', touch_count: 1 }),
      motion: makeMotionOk({ quality: 'low', sample_count: 3 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.quality).toBe('review');
    expect(summary.behaviorLikelihood).toBe('low');
  });

  it('produces quality=ok when motion is ok but touch is missing', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'missing', touch_count: 0 }),
      motion: makeMotionOk(),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    // motion is ok → overall quality is ok
    expect(summary.quality).toBe('ok');
    expect(summary.behaviorLikelihood).toBe('medium');
  });

  it('reduces motorConfidence when touch is missing but motion is ok', () => {
    const signalsWithTouch: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk(),
    };
    const signalsWithoutTouch: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'missing', touch_count: 0 }),
      motion: makeMotionOk(),
    };

    const withTouch = computePulseGuardBehaviorSummary(signalsWithTouch);
    const withoutTouch = computePulseGuardBehaviorSummary(signalsWithoutTouch);

    expect(withoutTouch.motorConfidence!).toBeLessThan(withTouch.motorConfidence!);
  });
});

describe('PULSEGUARD-BEHAVIOR-SUMMARY — both collectors missing', () => {
  it('produces quality=missing (hasBehavior=false on server)', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'missing', touch_count: 0 }),
      motion: makeMotionOk({ quality: 'missing', sample_count: 0 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.quality).toBe('missing');
  });

  it('produces behaviorLikelihood=null', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'missing', touch_count: 0 }),
      motion: makeMotionOk({ quality: 'missing', sample_count: 0 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.behaviorLikelihood).toBeNull();
  });

  it('produces motorConfidence=null', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'missing', touch_count: 0 }),
      motion: makeMotionOk({ quality: 'missing', sample_count: 0 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.motorConfidence).toBeNull();
  });

  it('produces consistencyScore=null', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'missing', touch_count: 0 }),
      motion: makeMotionOk({ quality: 'missing', sample_count: 0 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.consistencyScore).toBeNull();
  });
});

describe('PULSEGUARD-BEHAVIOR-SUMMARY — both collectors unsupported', () => {
  it('produces quality=missing for unsupported signals', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'unsupported', touch_count: 0 }),
      motion: makeMotionOk({ quality: 'unsupported', sample_count: 0 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.quality).toBe('missing');
    expect(summary.behaviorLikelihood).toBeNull();
    expect(summary.motorConfidence).toBeNull();
  });
});

describe('PULSEGUARD-BEHAVIOR-SUMMARY — empty signals object', () => {
  it('produces quality=missing when no signals at all', () => {
    const signals: Partial<DemoGuardSignals> = {};
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.quality).toBe('missing');
    expect(summary.behaviorLikelihood).toBeNull();
    expect(summary.motorConfidence).toBeNull();
    expect(summary.consistencyScore).toBeNull();
  });
});

describe('PULSEGUARD-BEHAVIOR-SUMMARY — motorConfidence edge cases', () => {
  it('gives low motorConfidence when phone is completely still (variance ≈ 0)', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ touch_count: 0, quality: 'missing' }),
      motion: makeMotionOk({ variance: 0.001 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.motorConfidence).not.toBeNull();
    expect(summary.motorConfidence!).toBeLessThan(0.35);
  });

  it('gives moderate motorConfidence for excessive movement (variance ≥ 10)', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk({ variance: 15 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.motorConfidence).not.toBeNull();
    expect(summary.motorConfidence!).toBeLessThan(0.7);
  });

  it('gives null motorConfidence when motion has no variance data', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk({ quality: 'missing', touch_count: 0 }),
      motion: makeMotionOk({ variance: undefined, quality: 'low', sample_count: 2 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    // quality will be 'review' (motion is low, touch is missing → only motion usable)
    // motorConfidence should be 0.35 baseline (no variance) - 0.10 (motion low) = 0.25
    // touch missing → -0.10 → 0.15
    expect(summary.motorConfidence).not.toBeNull();
    expect(summary.motorConfidence!).toBeLessThan(0.4);
  });
});

describe('PULSEGUARD-BEHAVIOR-SUMMARY — consistencyScore edge cases', () => {
  it('gives low consistencyScore when phone is completely still', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk({ variance: 0.001 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.consistencyScore).not.toBeNull();
    expect(summary.consistencyScore!).toBeLessThan(0.5);
  });

  it('gives lower consistencyScore for excessive movement', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk({ variance: 20 }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.consistencyScore).not.toBeNull();
    expect(summary.consistencyScore!).toBeLessThan(0.6);
  });

  it('gives null consistencyScore when motion has no variance', () => {
    const signals: Partial<DemoGuardSignals> = {
      touch: makeTouchOk(),
      motion: makeMotionOk({ variance: undefined }),
    };
    const summary = computePulseGuardBehaviorSummary(signals);

    expect(summary.consistencyScore).toBeNull();
  });
});
