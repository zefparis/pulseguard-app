/**
 * PulseGuard — Main app component (periodic check lifecycle)
 *
 * Loads a signed link token from the URL (?token=...), fetches check
 * configuration from the server, then cycles between waiting and
 * checking states: every checkFrequencyMs, starts collectors for
 * captureWindowSec seconds, sends the snapshot, returns to waiting.
 *
 * If the app goes background during an active check, the check is
 * cancelled (collectors stopped) and the next check is rescheduled
 * when the app returns to foreground.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useReducer, useRef, useCallback, useEffect } from 'react';
import { pulseguardReducer, initialPulseGuardState } from './state/pulseguardReducer';
import { useContinuousSignals } from './hooks/useContinuousSignals';
import { submitPulseGuardSnapshot, fetchLinkConfig, type PulseGuardSnapshotPayload, type PulseGuardApiError } from './pulseguard/api';
import { PULSEGUARD_FALLBACK_CHECK_FREQUENCY_MS, PULSEGUARD_FALLBACK_CAPTURE_WINDOW_SEC, PULSEGUARD_VERSION, PULSEGUARD_SOURCE } from './pulseguard/constants';
import { PulseGuardIndicator } from './components/PulseGuardIndicator';
import { PulseGuardEnrollment } from './components/PulseGuardEnrollment';
import { computePulseGuardBehaviorSummary } from './pulseguard/behaviorSummary';
import { computeDeviceMotionState } from './pulseguard/deviceMotionState';
import { useI18n } from './i18n/I18nContext';

function extractTokenFromUrl(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
  } catch {
    return '';
  }
}

export default function PulseGuardApp() {
  const { t, toggleLocale } = useI18n();
  const [state, dispatch] = useReducer(pulseguardReducer, initialPulseGuardState);
  const continuousSignals = useContinuousSignals();
  const { start: csStart, stop: csStop } = continuousSignals;

  // Refs for timer management
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<string>('');
  const linkTokenRef = useRef<string>('');
  const checkFrequencyRef = useRef<number>(PULSEGUARD_FALLBACK_CHECK_FREQUENCY_MS);
  const captureWindowRef = useRef<number>(PULSEGUARD_FALLBACK_CAPTURE_WINDOW_SEC);
  const isCheckingRef = useRef<boolean>(false);
  const lastCheckSentAtRef = useRef<number>(0);

  // ─── Extract token and fetch config on mount ─────────────────────

  useEffect(() => {
    const token = extractTokenFromUrl();
    if (!token) {
      dispatch({ type: 'CONFIG_ERROR', error: 'missing' });
      return;
    }
    linkTokenRef.current = token;

    let cancelled = false;

    fetchLinkConfig(token)
      .then((config) => {
        if (cancelled) return;
        checkFrequencyRef.current = config.checkFrequencyMs;
        captureWindowRef.current = config.captureWindowSec;
        dispatch({
          type: 'CONFIG_LOADED',
          linkToken: token,
          checkFrequencyMs: config.checkFrequencyMs,
          captureWindowSec: config.captureWindowSec,
          cognitiveEnrollmentRequired: config.cognitiveEnrollmentRequired,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const isApiError = (e: unknown): e is PulseGuardApiError =>
          e instanceof Error && e.name === 'PulseGuardApiError';
        const errorType = isApiError(err) && err.code === 'LINK_REVOKED'
          ? 'revoked'
          : isApiError(err) && err.status === 401 ? 'expired' : 'network';
        dispatch({ type: 'CONFIG_ERROR', error: errorType });
      });

    return () => { cancelled = true; };
  }, []);

  // Ref to runCheck for use in the visibility handler (declared early, assigned after runCheck is defined)
  const runCheckRef = useRef<(() => Promise<void>) | null>(null);

  // ─── Visibility / background management ───────────────────────────

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        dispatch({ type: 'BACKGROUND_ENTER' });
        // If a check is in progress, cancel it
        if (isCheckingRef.current) {
          csStop();
          if (captureTimerRef.current) {
            clearTimeout(captureTimerRef.current);
            captureTimerRef.current = null;
          }
          isCheckingRef.current = false;
          dispatch({ type: 'CHECK_CANCELLED' });
        }
      } else {
        dispatch({ type: 'BACKGROUND_EXIT' });
        // On foreground return: if the time since the last check exceeds the
        // configured frequency, trigger an immediate check to catch up.
        // Mobile browsers suspend JS in background, so setTimeout-based
        // scheduling doesn't fire while the app is hidden. This ensures we
        // rattrap the missed checks as soon as the user reopens the app.
        const elapsed = Date.now() - lastCheckSentAtRef.current;
        if (lastCheckSentAtRef.current > 0 && elapsed >= checkFrequencyRef.current && runCheckRef.current) {
          runCheckRef.current();
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [csStop]);

  // ─── Check cycle: waiting → checking → waiting ───────────────────

  const runCheck = useCallback(async () => {
    if (isCheckingRef.current) return;
    if (document.hidden) return;

    isCheckingRef.current = true;
    dispatch({ type: 'START_CHECK' });
    startedAtRef.current = new Date().toISOString();

    // Start collectors
    await csStart({ motion: 'prompt', orientation: 'prompt' });

    // Wait for capture window duration
    const captureMs = captureWindowRef.current * 1000;

    await new Promise<void>((resolve) => {
      captureTimerRef.current = setTimeout(() => {
        captureTimerRef.current = null;
        resolve();
      }, captureMs);
    });

    // If backgrounded during capture, the visibility handler already
    // stopped collectors and set isCheckingRef to false — abort.
    if (!isCheckingRef.current) return;

    // Stop collectors and get signals
    const signals = csStop();
    isCheckingRef.current = false;

    // Build behavior summary from touch/motion signals so the server-side
    // mapPulseGuardToHumanStateInput can populate behaviorStatus and enable
    // computeHumanState to evaluate the behavioral dimension.
    const behaviorSummary = computePulseGuardBehaviorSummary(signals);

    // Device motion state — INFORMATIONAL ONLY, completely separate from scoring.
    // Derived from the same motion collector output but stored as a distinct field.
    // NEVER enters computeHumanState / HumanStateInput / motorConfidence.
    const deviceMotionState = computeDeviceMotionState(signals.motion ?? undefined);

    // Build and send snapshot
    const payload: PulseGuardSnapshotPayload = {
      hcs_session_public_id: `pg_${linkTokenRef.current.slice(-12)}`,
      source: PULSEGUARD_SOURCE,
      link_token: linkTokenRef.current,
      pulse_guard: {
        version: PULSEGUARD_VERSION,
        snapshot_at: new Date().toISOString(),
        started_at: startedAtRef.current,
        signals: {
          ...signals,
          behavior: { summary: behaviorSummary },
        },
        // Informational-only — separate from scoring pipeline
        device_motion_state: deviceMotionState,
      },
    };

    try {
      await submitPulseGuardSnapshot(payload);
      dispatch({ type: 'CHECK_SENT' });
      lastCheckSentAtRef.current = Date.now();
    } catch (err) {
      const isApiErr = (e: unknown): e is PulseGuardApiError =>
        e instanceof Error && e.name === 'PulseGuardApiError';
      if (isApiErr(err) && err.code === 'LINK_REVOKED') {
        dispatch({ type: 'CONFIG_ERROR', error: 'revoked' });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Check submission failed';
      console.error('[PulseGuard] Check error:', msg);
      dispatch({ type: 'CHECK_ERROR', error: msg });
    }
  }, [csStart, csStop]);

  // Keep runCheckRef in sync so the visibility handler always calls the latest version
  runCheckRef.current = runCheck;

  // Schedule checks when in waiting phase
  useEffect(() => {
    if (state.phase !== 'waiting') return;

    // Schedule next check
    checkTimerRef.current = setTimeout(() => {
      runCheck();
    }, checkFrequencyRef.current);

    return () => {
      if (checkTimerRef.current) {
        clearTimeout(checkTimerRef.current);
        checkTimerRef.current = null;
      }
    };
  }, [state.phase, state.checksSent, runCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      {/* Language switch button (always visible) */}
      <button
        onClick={toggleLocale}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'var(--surface)',
          border: '1px solid var(--surface-2)',
          borderRadius: 'var(--radius)',
          padding: '4px 12px',
          fontSize: 13,
          color: 'var(--text)',
          cursor: 'pointer',
          minHeight: 32,
          zIndex: 100,
        }}
      >
        {t('app.langSwitch')}
      </button>

      {/* ─── LOADING ─── */}
      {state.phase === 'loading' && (
        <div className="screen-center">
          <div style={{ fontSize: 48 }}>🫀</div>
          <h1>{t('pulseguard.title')}</h1>
          <p className="muted">{t('pulseguard.loadingConfig')}</p>
        </div>
      )}

      {/* ─── LINK_INVALID ─── */}
      {state.phase === 'link_invalid' && (
        <div className="screen-center">
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h1>{t('pulseguard.linkInvalidTitle')}</h1>
          <p className="muted">
            {state.linkError === 'revoked'
              ? t('pulseguard.linkRevoked')
              : state.linkError === 'expired'
                ? t('pulseguard.linkExpired')
                : state.linkError === 'missing'
                  ? t('pulseguard.linkMissing')
                  : t('pulseguard.linkNetworkError')}
          </p>
        </div>
      )}

      {/* ─── ENROLLMENT ─── */}
      {(state.phase === 'enrollment' || state.phase === 'enrollment_submitting') && (
        <PulseGuardEnrollment
          linkToken={linkTokenRef.current}
          onComplete={() => dispatch({ type: 'ENROLLMENT_SUCCESS' })}
        />
      )}

      {/* ─── WAITING / CHECKING ─── */}
      {(state.phase === 'waiting' || state.phase === 'checking') && (
        <>
          <div className="screen-center" style={{ paddingBottom: '80px' }}>
            <div style={{ fontSize: 48 }}>🫀</div>
            <h1>
              {state.phase === 'checking'
                ? t('pulseguard.checkInProgress')
                : t('pulseguard.waitingNextCheck')}
            </h1>
            <p className="muted">{t('pulseguard.periodicMonitoring')}</p>
            <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary, #888)' }}>
                {t('pulseguard.checksSent')}: {state.checksSent}
              </div>
              {state.lastSubmitError && (
                <div style={{ fontSize: '13px', color: '#ef4444' }}>
                  {t('pulseguard.lastError')}: {state.lastSubmitError}
                </div>
              )}
            </div>
          </div>

          {/* Permanent transparency indicator — phase-aware */}
          <PulseGuardIndicator phase={state.phase} />
        </>
      )}
    </div>
  );
}
