/**
 * PulseGuard — Reducer state machine tests
 *
 * Tests the periodic check model state machine:
 * loading → waiting → checking → waiting (cycle)
 * loading → link_invalid (error)
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { describe, it, expect } from 'vitest';
import {
  pulseguardReducer,
  initialPulseGuardState,
  type PulseGuardState,
  type PulseGuardAction,
} from '../src/state/pulseguardReducer';

function dispatchSequence(actions: PulseGuardAction[]): PulseGuardState {
  return actions.reduce(pulseguardReducer, initialPulseGuardState);
}

// ─── 1. Initial state ─────────────────────────────────────────────

describe('pulseguardReducer — initial state', () => {
  it('has phase loading with no config', () => {
    expect(initialPulseGuardState.phase).toBe('loading');
    expect(initialPulseGuardState.linkToken).toBe('');
    expect(initialPulseGuardState.checkFrequencyMs).toBe(0);
    expect(initialPulseGuardState.captureWindowSec).toBe(0);
    expect(initialPulseGuardState.checksSent).toBe(0);
    expect(initialPulseGuardState.lastSubmitError).toBeNull();
    expect(initialPulseGuardState.isBackgrounded).toBe(false);
    expect(initialPulseGuardState.linkError).toBeNull();
  });
});

// ─── 2. CONFIG_LOADED (loading → waiting) ─────────────────────────

describe('pulseguardReducer — CONFIG_LOADED (loading → waiting)', () => {
  it('transitions to waiting with config values', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_LOADED',
      linkToken: 'test-jwt-token',
      checkFrequencyMs: 300000,
      captureWindowSec: 30,
    });

    expect(state.phase).toBe('waiting');
    expect(state.linkToken).toBe('test-jwt-token');
    expect(state.checkFrequencyMs).toBe(300000);
    expect(state.captureWindowSec).toBe(30);
    expect(state.linkError).toBeNull();
  });
});

// ─── 3. CONFIG_ERROR (loading → link_invalid) ─────────────────────

describe('pulseguardReducer — CONFIG_ERROR (loading → link_invalid)', () => {
  it('transitions to link_invalid with error message', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_ERROR',
      error: 'expired',
    });

    expect(state.phase).toBe('link_invalid');
    expect(state.linkError).toBe('expired');
  });

  it('stores different error types', () => {
    const missingState = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_ERROR',
      error: 'missing',
    });
    expect(missingState.linkError).toBe('missing');

    const networkState = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_ERROR',
      error: 'network',
    });
    expect(networkState.linkError).toBe('network');
  });
});

// ─── 4. Check cycle: waiting → checking → waiting ─────────────────

describe('pulseguardReducer — check cycle', () => {
  it('START_CHECK transitions from waiting to checking', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_LOADED',
      linkToken: 'tok',
      checkFrequencyMs: 60000,
      captureWindowSec: 10,
    });
    state = pulseguardReducer(state, { type: 'START_CHECK' });

    expect(state.phase).toBe('checking');
    expect(state.lastSubmitError).toBeNull();
  });

  it('CHECK_SENT transitions back to waiting and increments counter', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
      { type: 'START_CHECK' },
    ]);
    state = pulseguardReducer(state, { type: 'CHECK_SENT' });

    expect(state.phase).toBe('waiting');
    expect(state.checksSent).toBe(1);
    expect(state.lastSubmitError).toBeNull();
  });

  it('CHECK_ERROR transitions back to waiting with error', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
      { type: 'START_CHECK' },
    ]);
    state = pulseguardReducer(state, { type: 'CHECK_ERROR', error: 'timeout' });

    expect(state.phase).toBe('waiting');
    expect(state.checksSent).toBe(0);
    expect(state.lastSubmitError).toBe('timeout');
  });

  it('CHECK_CANCELLED transitions from checking to waiting', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
      { type: 'START_CHECK' },
    ]);
    state = pulseguardReducer(state, { type: 'CHECK_CANCELLED' });

    expect(state.phase).toBe('waiting');
  });

  it('multiple check cycles increment counter correctly', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
      { type: 'START_CHECK' },
      { type: 'CHECK_SENT' },
      { type: 'START_CHECK' },
      { type: 'CHECK_SENT' },
      { type: 'START_CHECK' },
      { type: 'CHECK_SENT' },
    ]);

    expect(state.phase).toBe('waiting');
    expect(state.checksSent).toBe(3);
  });
});

// ─── 5. Invalid transitions ───────────────────────────────────────

describe('pulseguardReducer — invalid transitions', () => {
  it('START_CHECK from loading is a no-op', () => {
    const result = pulseguardReducer(initialPulseGuardState, { type: 'START_CHECK' });
    expect(result).toStrictEqual(initialPulseGuardState);
  });

  it('START_CHECK from checking is a no-op', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
      { type: 'START_CHECK' },
    ]);
    const checkingState = state;
    state = pulseguardReducer(state, { type: 'START_CHECK' });
    expect(state).toStrictEqual(checkingState);
  });

  it('START_CHECK from link_invalid is a no-op', () => {
    let state = pulseguardReducer(initialPulseGuardState, { type: 'CONFIG_ERROR', error: 'expired' });
    state = pulseguardReducer(state, { type: 'START_CHECK' });
    expect(state.phase).toBe('link_invalid');
  });
});

// ─── 6. Background state ──────────────────────────────────────────

describe('pulseguardReducer — background state', () => {
  it('BACKGROUND_ENTER sets isBackgrounded true without changing phase', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
    ]);
    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    expect(state.isBackgrounded).toBe(true);
    expect(state.phase).toBe('waiting');
  });

  it('BACKGROUND_EXIT sets isBackgrounded false', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
      { type: 'BACKGROUND_ENTER' },
    ]);
    state = pulseguardReducer(state, { type: 'BACKGROUND_EXIT' });
    expect(state.isBackgrounded).toBe(false);
  });

  it('BACKGROUND_ENTER/EXIT work during checking phase', () => {
    let state = dispatchSequence([
      { type: 'CONFIG_LOADED', linkToken: 'tok', checkFrequencyMs: 60000, captureWindowSec: 10 },
      { type: 'START_CHECK' },
    ]);
    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    expect(state.isBackgrounded).toBe(true);
    expect(state.phase).toBe('checking');
    state = pulseguardReducer(state, { type: 'BACKGROUND_EXIT' });
    expect(state.isBackgrounded).toBe(false);
  });
});

// ─── 7. State fields needed by PulseGuardApp ──────────────────────

describe('pulseguardReducer — fields for PulseGuardApp lifecycle', () => {
  it('waiting state has linkToken for snapshot submission', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_LOADED',
      linkToken: 'jwt-abc123',
      checkFrequencyMs: 300000,
      captureWindowSec: 30,
    });
    expect(state.linkToken).toBe('jwt-abc123');
    expect(state.linkToken).not.toBe('');
  });

  it('waiting state has checkFrequencyMs for timer scheduling', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_LOADED',
      linkToken: 'tok',
      checkFrequencyMs: 120000,
      captureWindowSec: 15,
    });
    expect(state.checkFrequencyMs).toBe(120000);
    expect(state.captureWindowSec).toBe(15);
  });

  it('phase field drives conditional rendering', () => {
    let state = initialPulseGuardState;
    expect(state.phase).toBe('loading');

    state = pulseguardReducer(state, {
      type: 'CONFIG_LOADED',
      linkToken: 'tok',
      checkFrequencyMs: 60000,
      captureWindowSec: 10,
    });
    expect(state.phase).toBe('waiting');

    state = pulseguardReducer(state, { type: 'START_CHECK' });
    expect(state.phase).toBe('checking');

    state = pulseguardReducer(state, { type: 'CHECK_SENT' });
    expect(state.phase).toBe('waiting');
  });

  it('linkError field drives error screen message', () => {
    const expiredState = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_ERROR',
      error: 'expired',
    });
    expect(expiredState.linkError).toBe('expired');

    const missingState = pulseguardReducer(initialPulseGuardState, {
      type: 'CONFIG_ERROR',
      error: 'missing',
    });
    expect(missingState.linkError).toBe('missing');
  });
});
