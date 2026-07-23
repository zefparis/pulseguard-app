/**
 * PulseGuard — Reducer (state machine: idle → active → ended)
 *
 * Replaces the DemoGuard 15-phase enrollment reducer with a simple
 * 3-state lifecycle for continuous work-session monitoring.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

export type PulseGuardPhase = 'idle' | 'active' | 'ended';

export interface PulseGuardState {
  phase: PulseGuardPhase;
  sessionPublicId: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Reason the session ended — 'user' (explicit stop) or 'background' (auto-timeout). */
  endReason: 'user' | 'background' | null;
  /** Number of snapshots successfully submitted. */
  snapshotsSent: number;
  /** Last error from a snapshot submission (non-fatal — session continues). */
  lastSubmitError: string | null;
  /** Whether the app is currently in the background (visibility hidden). */
  isBackgrounded: boolean;
}

export const initialPulseGuardState: PulseGuardState = {
  phase: 'idle',
  sessionPublicId: '',
  startedAt: null,
  endedAt: null,
  endReason: null,
  snapshotsSent: 0,
  lastSubmitError: null,
  isBackgrounded: false,
};

export type PulseGuardAction =
  | { type: 'START'; sessionPublicId: string }
  | { type: 'SNAPSHOT_SENT' }
  | { type: 'SNAPSHOT_ERROR'; error: string }
  | { type: 'BACKGROUND_ENTER' }
  | { type: 'BACKGROUND_EXIT' }
  | { type: 'END'; reason: 'user' | 'background' }
  | { type: 'RESET' };

const VALID_TRANSITIONS: Record<PulseGuardPhase, PulseGuardPhase[]> = {
  idle: ['active'],
  active: ['ended'],
  ended: ['idle'],
};

function isValidTransition(from: PulseGuardPhase, to: PulseGuardPhase): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function pulseguardReducer(
  state: PulseGuardState,
  action: PulseGuardAction,
): PulseGuardState {
  switch (action.type) {
    case 'START': {
      return {
        ...initialPulseGuardState,
        phase: 'active',
        sessionPublicId: action.sessionPublicId,
        startedAt: new Date().toISOString(),
      };
    }

    case 'SNAPSHOT_SENT': {
      return {
        ...state,
        snapshotsSent: state.snapshotsSent + 1,
        lastSubmitError: null,
      };
    }

    case 'SNAPSHOT_ERROR': {
      return {
        ...state,
        lastSubmitError: action.error,
      };
    }

    case 'BACKGROUND_ENTER': {
      return { ...state, isBackgrounded: true };
    }

    case 'BACKGROUND_EXIT': {
      return { ...state, isBackgrounded: false };
    }

    case 'END': {
      if (!isValidTransition(state.phase, 'ended')) return state;
      return {
        ...state,
        phase: 'ended',
        endedAt: new Date().toISOString(),
        endReason: action.reason,
        isBackgrounded: false,
      };
    }

    case 'RESET': {
      return { ...initialPulseGuardState };
    }

    default:
      return state;
  }
}
