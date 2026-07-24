/**
 * PulseGuard — Reducer (state machine: loading → waiting → checking → link_invalid)
 *
 * Periodic check model: the app loads config from a signed token, then
 * cycles between waiting (idle, next check scheduled) and checking
 * (active capture window) indefinitely until the app is closed.
 *
 * States:
 * - loading: fetching link config from server
 * - waiting: next check is scheduled, nothing running
 * - checking: capture window active, collectors running
 * - link_invalid: token expired or invalid, unrecoverable
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

export type PulseGuardPhase = 'loading' | 'waiting' | 'checking' | 'link_invalid' | 'enrollment' | 'enrollment_submitting';

export interface PulseGuardState {
  phase: PulseGuardPhase;
  /** Signed link token extracted from URL. */
  linkToken: string;
  /** Check frequency in ms (from server config). */
  checkFrequencyMs: number;
  /** Capture window in seconds (from server config). */
  captureWindowSec: number;
  /** Number of checks successfully completed. */
  checksSent: number;
  /** Last error from a snapshot submission (non-fatal — cycle continues). */
  lastSubmitError: string | null;
  /** Whether the app is currently in the background (visibility hidden). */
  isBackgrounded: boolean;
  /** Error message when phase is link_invalid. */
  linkError: string | null;
  /** Whether cognitive enrollment is required before periodic checks start. */
  cognitiveEnrollmentRequired: boolean;
  /** Error message when enrollment submission fails. */
  enrollmentError: string | null;
}

export const initialPulseGuardState: PulseGuardState = {
  phase: 'loading',
  linkToken: '',
  checkFrequencyMs: 0,
  captureWindowSec: 0,
  checksSent: 0,
  lastSubmitError: null,
  isBackgrounded: false,
  linkError: null,
  cognitiveEnrollmentRequired: false,
  enrollmentError: null,
};

export type PulseGuardAction =
  | { type: 'CONFIG_LOADED'; linkToken: string; checkFrequencyMs: number; captureWindowSec: number; cognitiveEnrollmentRequired?: boolean }
  | { type: 'CONFIG_ERROR'; error: string }
  | { type: 'START_CHECK' }
  | { type: 'CHECK_SENT' }
  | { type: 'CHECK_ERROR'; error: string }
  | { type: 'BACKGROUND_ENTER' }
  | { type: 'BACKGROUND_EXIT' }
  | { type: 'CHECK_CANCELLED' }
  | { type: 'ENROLLMENT_SUBMITTING' }
  | { type: 'ENROLLMENT_SUCCESS' }
  | { type: 'ENROLLMENT_ERROR'; error: string };

export function pulseguardReducer(
  state: PulseGuardState,
  action: PulseGuardAction,
): PulseGuardState {
  switch (action.type) {
    case 'CONFIG_LOADED': {
      const enrollmentRequired = action.cognitiveEnrollmentRequired ?? false;
      return {
        ...state,
        phase: enrollmentRequired ? 'enrollment' : 'waiting',
        linkToken: action.linkToken,
        checkFrequencyMs: action.checkFrequencyMs,
        captureWindowSec: action.captureWindowSec,
        cognitiveEnrollmentRequired: enrollmentRequired,
        linkError: null,
      };
    }

    case 'CONFIG_ERROR': {
      return {
        ...state,
        phase: 'link_invalid',
        linkError: action.error,
      };
    }

    case 'START_CHECK': {
      if (state.phase !== 'waiting') return state;
      return {
        ...state,
        phase: 'checking',
        lastSubmitError: null,
      };
    }

    case 'CHECK_SENT': {
      return {
        ...state,
        phase: 'waiting',
        checksSent: state.checksSent + 1,
        lastSubmitError: null,
      };
    }

    case 'CHECK_ERROR': {
      return {
        ...state,
        phase: 'waiting',
        lastSubmitError: action.error,
      };
    }

    case 'CHECK_CANCELLED': {
      return {
        ...state,
        phase: 'waiting',
      };
    }

    case 'BACKGROUND_ENTER': {
      return { ...state, isBackgrounded: true };
    }

    case 'BACKGROUND_EXIT': {
      return { ...state, isBackgrounded: false };
    }

    case 'ENROLLMENT_SUBMITTING': {
      if (state.phase !== 'enrollment') return state;
      return { ...state, phase: 'enrollment_submitting', enrollmentError: null };
    }

    case 'ENROLLMENT_SUCCESS': {
      return { ...state, phase: 'waiting', enrollmentError: null };
    }

    case 'ENROLLMENT_ERROR': {
      return { ...state, phase: 'enrollment', enrollmentError: action.error };
    }

    default:
      return state;
  }
}
