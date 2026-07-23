/**
 * PulseGuard — Reducer state machine tests
 *
 * Covers: idle→active, active→ended (user), active→ended (background),
 * invalid transitions, snapshot counting, background state, reset,
 * and state fields needed by PulseGuardApp for lifecycle decisions.
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

// ─── Helper: dispatch a sequence of actions from initial state ────
function dispatchSequence(actions: PulseGuardAction[]): PulseGuardState {
  return actions.reduce(pulseguardReducer, initialPulseGuardState);
}

// ─── 1. Initial state ─────────────────────────────────────────────

describe('pulseguardReducer — initial state', () => {
  it('has phase idle with no session', () => {
    expect(initialPulseGuardState.phase).toBe('idle');
    expect(initialPulseGuardState.sessionPublicId).toBe('');
    expect(initialPulseGuardState.startedAt).toBeNull();
    expect(initialPulseGuardState.endedAt).toBeNull();
    expect(initialPulseGuardState.endReason).toBeNull();
    expect(initialPulseGuardState.snapshotsSent).toBe(0);
    expect(initialPulseGuardState.lastSubmitError).toBeNull();
    expect(initialPulseGuardState.isBackgrounded).toBe(false);
  });
});

// ─── 2. idle → active (START) ─────────────────────────────────────

describe('pulseguardReducer — START (idle → active)', () => {
  it('transitions to active with session id and startedAt', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test123',
    });

    expect(state.phase).toBe('active');
    expect(state.sessionPublicId).toBe('pg_test123');
    expect(state.startedAt).not.toBeNull();
    expect(state.endedAt).toBeNull();
    expect(state.endReason).toBeNull();
    expect(state.snapshotsSent).toBe(0);
    expect(state.lastSubmitError).toBeNull();
    expect(state.isBackgrounded).toBe(false);
  });

  it('startedAt is a valid ISO string', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_x',
    });

    expect(state.startedAt).not.toBeNull();
    const parsed = new Date(state.startedAt!);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('START resets snapshotsSent and lastSubmitError from any prior state', () => {
    // Build a state with some snapshots and errors
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_first',
    });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_ERROR', error: 'boom' });
    state = pulseguardReducer(state, { type: 'END', reason: 'user' });

    // Now START a new session
    state = pulseguardReducer(state, { type: 'START', sessionPublicId: 'pg_second' });

    expect(state.phase).toBe('active');
    expect(state.sessionPublicId).toBe('pg_second');
    expect(state.snapshotsSent).toBe(0);
    expect(state.lastSubmitError).toBeNull();
    expect(state.endedAt).toBeNull();
    expect(state.endReason).toBeNull();
  });
});

// ─── 3. active → ended with reason 'user' ─────────────────────────

describe('pulseguardReducer — END reason=user (active → ended)', () => {
  it('transitions to ended with endReason user', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'END', reason: 'user' });

    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('user');
    expect(state.endedAt).not.toBeNull();
    expect(state.startedAt).not.toBeNull();
    expect(state.sessionPublicId).toBe('pg_test');
  });

  it('preserves snapshotsSent count', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    state = pulseguardReducer(state, { type: 'END', reason: 'user' });

    expect(state.snapshotsSent).toBe(3);
  });

  it('clears isBackgrounded on end', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    expect(state.isBackgrounded).toBe(true);
    state = pulseguardReducer(state, { type: 'END', reason: 'user' });
    expect(state.isBackgrounded).toBe(false);
  });
});

// ─── 4. active → ended with reason 'background' ───────────────────

describe('pulseguardReducer — END reason=background (active → ended)', () => {
  it('transitions to ended with endReason background', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    state = pulseguardReducer(state, { type: 'END', reason: 'background' });

    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('background');
    expect(state.endedAt).not.toBeNull();
    expect(state.isBackgrounded).toBe(false);
  });
});

// ─── 5. Invalid transitions ───────────────────────────────────────

describe('pulseguardReducer — invalid transitions', () => {
  it('END from idle is a no-op (returns same state)', () => {
    const result = pulseguardReducer(initialPulseGuardState, {
      type: 'END',
      reason: 'user',
    });
    // Should return the same state (idle)
    expect(result).toStrictEqual(initialPulseGuardState);
  });

  it('END from ended is a no-op (returns same state)', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'END', reason: 'user' });
    const endedState = state;

    // Try to END again
    state = pulseguardReducer(state, { type: 'END', reason: 'background' });
    expect(state).toStrictEqual(endedState);
  });

  it('START from ended succeeds (begins a new session without RESET)', () => {
    // The reducer does NOT guard START with isValidTransition.
    // START always resets to a fresh active state regardless of current phase.
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_first',
    });
    state = pulseguardReducer(state, { type: 'END', reason: 'user' });
    expect(state.phase).toBe('ended');

    // START directly from ended — no RESET needed
    state = pulseguardReducer(state, { type: 'START', sessionPublicId: 'pg_second' });
    expect(state.phase).toBe('active');
    expect(state.sessionPublicId).toBe('pg_second');
    expect(state.snapshotsSent).toBe(0);
    expect(state.endedAt).toBeNull();
    expect(state.endReason).toBeNull();
  });
});

// ─── 6. Snapshot tracking ─────────────────────────────────────────

describe('pulseguardReducer — snapshot tracking', () => {
  it('SNAPSHOT_SENT increments counter and clears error', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_ERROR', error: 'network' });
    expect(state.lastSubmitError).toBe('network');

    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    expect(state.snapshotsSent).toBe(1);
    expect(state.lastSubmitError).toBeNull();

    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    expect(state.snapshotsSent).toBe(2);
  });

  it('SNAPSHOT_ERROR sets error without changing snapshot count', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_SENT' });
    state = pulseguardReducer(state, { type: 'SNAPSHOT_ERROR', error: 'timeout' });

    expect(state.snapshotsSent).toBe(1);
    expect(state.lastSubmitError).toBe('timeout');
  });

  it('SNAPSHOT_SENT from idle does nothing harmful (no phase guard)', () => {
    // Reducer doesn't guard SNAPSHOT_SENT by phase — test actual behavior
    const state = pulseguardReducer(initialPulseGuardState, { type: 'SNAPSHOT_SENT' });
    expect(state.snapshotsSent).toBe(1);
    expect(state.phase).toBe('idle');
  });
});

// ─── 7. Background state ──────────────────────────────────────────

describe('pulseguardReducer — background state', () => {
  it('BACKGROUND_ENTER sets isBackgrounded true', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    expect(state.isBackgrounded).toBe(true);
  });

  it('BACKGROUND_EXIT sets isBackgrounded false', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    state = pulseguardReducer(state, { type: 'BACKGROUND_EXIT' });
    expect(state.isBackgrounded).toBe(false);
  });

  it('BACKGROUND_ENTER/EXIT do not change phase', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    expect(state.phase).toBe('active');
    state = pulseguardReducer(state, { type: 'BACKGROUND_EXIT' });
    expect(state.phase).toBe('active');
  });
});

// ─── 8. RESET ─────────────────────────────────────────────────────

describe('pulseguardReducer — RESET', () => {
  it('RESET from ended returns to initial state', () => {
    let state = dispatchSequence([
      { type: 'START', sessionPublicId: 'pg_test' },
      { type: 'SNAPSHOT_SENT' },
      { type: 'END', reason: 'background' },
    ]);
    expect(state.phase).toBe('ended');

    state = pulseguardReducer(state, { type: 'RESET' });
    expect(state).toStrictEqual(initialPulseGuardState);
  });

  it('RESET from active also works', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'RESET' });
    expect(state).toStrictEqual(initialPulseGuardState);
  });
});

// ─── 9. State fields needed by PulseGuardApp ──────────────────────

describe('pulseguardReducer — fields for PulseGuardApp lifecycle', () => {
  it('active state has sessionPublicId for snapshot submission', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_app_test',
    });
    expect(state.sessionPublicId).toBe('pg_app_test');
    expect(state.sessionPublicId).not.toBe('');
  });

  it('active state has startedAt for payload building', () => {
    const state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    expect(state.startedAt).not.toBeNull();
    expect(typeof state.startedAt).toBe('string');
  });

  it('phase field drives conditional rendering (idle/active/ended)', () => {
    let state = initialPulseGuardState;
    expect(state.phase).toBe('idle');

    state = pulseguardReducer(state, { type: 'START', sessionPublicId: 'pg_test' });
    expect(state.phase).toBe('active');

    state = pulseguardReducer(state, { type: 'END', reason: 'user' });
    expect(state.phase).toBe('ended');

    state = pulseguardReducer(state, { type: 'RESET' });
    expect(state.phase).toBe('idle');
  });

  it('isBackgrounded field drives background warning UI', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    expect(state.isBackgrounded).toBe(false);

    state = pulseguardReducer(state, { type: 'BACKGROUND_ENTER' });
    expect(state.isBackgrounded).toBe(true);

    state = pulseguardReducer(state, { type: 'BACKGROUND_EXIT' });
    expect(state.isBackgrounded).toBe(false);
  });

  it('endReason field drives ended screen message', () => {
    let state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test',
    });
    state = pulseguardReducer(state, { type: 'END', reason: 'user' });
    expect(state.endReason).toBe('user');

    state = pulseguardReducer(initialPulseGuardState, {
      type: 'START',
      sessionPublicId: 'pg_test2',
    });
    state = pulseguardReducer(state, { type: 'END', reason: 'background' });
    expect(state.endReason).toBe('background');
  });
});
