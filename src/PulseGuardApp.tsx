/**
 * PulseGuard — Main app component (continuous monitoring lifecycle)
 *
 * Replaces DemoGuard's 15-phase enrollment flow with a simple 3-state cycle:
 * idle → active → ended
 *
 * During 'active': collectors run continuously, snapshots are submitted
 * every PULSEGUARD_SNAPSHOT_INTERVAL_MS. If the app goes background for
 * longer than PULSEGUARD_BACKGROUND_TIMEOUT_MS, the session auto-ends.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useReducer, useRef, useCallback, useEffect, useState } from 'react';
import { pulseguardReducer, initialPulseGuardState } from './state/pulseguardReducer';
import { useContinuousSignals } from './hooks/useContinuousSignals';
import { submitPulseGuardSnapshot, type PulseGuardSnapshotPayload } from './pulseguard/api';
import { PULSEGUARD_SNAPSHOT_INTERVAL_MS, PULSEGUARD_BACKGROUND_TIMEOUT_MS, PULSEGUARD_VERSION, PULSEGUARD_SOURCE } from './pulseguard/constants';
import { PulseGuardIndicator } from './components/PulseGuardIndicator';
import { useI18n } from './i18n/I18nContext';

export default function PulseGuardApp() {
  const { t, toggleLocale } = useI18n();
  const [state, dispatch] = useReducer(pulseguardReducer, initialPulseGuardState);
  const continuousSignals = useContinuousSignals();
  const { start: csStart, stop: csStop, isCollecting: csIsCollecting } = continuousSignals;
  const [sessionId, setSessionId] = useState('');

  // Refs for interval/timeout management
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backgroundTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<string>('');
  const sessionPublicIdRef = useRef<string>('');

  // ─── Visibility / background management ───────────────────────────

  useEffect(() => {
    if (state.phase !== 'active') return;

    const onVisibilityChange = () => {
      if (document.hidden) {
        dispatch({ type: 'BACKGROUND_ENTER' });
        // Start countdown to auto-end session
        backgroundTimeoutRef.current = setTimeout(() => {
          // Auto-end: stop collectors and transition to 'ended'
          csStop();
          if (snapshotIntervalRef.current) {
            clearInterval(snapshotIntervalRef.current);
            snapshotIntervalRef.current = null;
          }
          dispatch({ type: 'END', reason: 'background' });
        }, PULSEGUARD_BACKGROUND_TIMEOUT_MS);
      } else {
        dispatch({ type: 'BACKGROUND_EXIT' });
        // Cancel auto-end countdown
        if (backgroundTimeoutRef.current) {
          clearTimeout(backgroundTimeoutRef.current);
          backgroundTimeoutRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (backgroundTimeoutRef.current) {
        clearTimeout(backgroundTimeoutRef.current);
        backgroundTimeoutRef.current = null;
      }
    };
  }, [state.phase, csStop]);

  // ─── Periodic snapshot submission ─────────────────────────────────

  const sendSnapshot = useCallback(async () => {
    if (sessionPublicIdRef.current === '') return;

    // Stop collectors to get accumulated signals, then immediately restart
    const signals = csStop();

    // Restart collectors for next interval (unless we're ending)
    if (!csIsCollecting()) {
      // Already stopped — restart for next window
      csStart({ motion: 'granted', orientation: 'granted' }).catch(() => {});
    }

    const payload: PulseGuardSnapshotPayload = {
      hcs_session_public_id: sessionPublicIdRef.current,
      source: PULSEGUARD_SOURCE,
      pulse_guard: {
        version: PULSEGUARD_VERSION,
        snapshot_at: new Date().toISOString(),
        started_at: startedAtRef.current,
        signals,
      },
    };

    try {
      await submitPulseGuardSnapshot(payload);
      dispatch({ type: 'SNAPSHOT_SENT' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Snapshot submission failed';
      console.error('[PulseGuard] Snapshot error:', msg);
      dispatch({ type: 'SNAPSHOT_ERROR', error: msg });
    }
  }, [csStop, csIsCollecting, csStart]);

  // Start/stop the periodic interval when phase changes
  useEffect(() => {
    if (state.phase === 'active') {
      snapshotIntervalRef.current = setInterval(() => {
        sendSnapshot();
      }, PULSEGUARD_SNAPSHOT_INTERVAL_MS);

      return () => {
        if (snapshotIntervalRef.current) {
          clearInterval(snapshotIntervalRef.current);
          snapshotIntervalRef.current = null;
        }
      };
    }
  }, [state.phase, sendSnapshot]);

  // ─── Session lifecycle handlers ───────────────────────────────────

  const handleStart = useCallback(async () => {
    const id = sessionId.trim() || `pg_${Date.now().toString(36)}`;
    sessionPublicIdRef.current = id;
    startedAtRef.current = new Date().toISOString();

    await csStart({ motion: 'prompt', orientation: 'prompt' });
    dispatch({ type: 'START', sessionPublicId: id });
  }, [csStart, sessionId]);

  const handleStop = useCallback(() => {
    // Final snapshot before ending
    const signals = csStop();

    if (snapshotIntervalRef.current) {
      clearInterval(snapshotIntervalRef.current);
      snapshotIntervalRef.current = null;
    }
    if (backgroundTimeoutRef.current) {
      clearTimeout(backgroundTimeoutRef.current);
      backgroundTimeoutRef.current = null;
    }

    // Send final snapshot (fire-and-forget — session is ending)
    if (sessionPublicIdRef.current) {
      const payload: PulseGuardSnapshotPayload = {
        hcs_session_public_id: sessionPublicIdRef.current,
        source: PULSEGUARD_SOURCE,
        pulse_guard: {
          version: PULSEGUARD_VERSION,
          snapshot_at: new Date().toISOString(),
          started_at: startedAtRef.current,
          signals,
        },
      };
      submitPulseGuardSnapshot(payload).catch((err) => {
        console.error('[PulseGuard] Final snapshot error:', err);
      });
    }

    dispatch({ type: 'END', reason: 'user' });
  }, [csStop]);

  const handleReset = useCallback(() => {
    sessionPublicIdRef.current = '';
    startedAtRef.current = '';
    dispatch({ type: 'RESET' });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current);
      if (backgroundTimeoutRef.current) clearTimeout(backgroundTimeoutRef.current);
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

      {/* ─── IDLE ─── */}
      {state.phase === 'idle' && (
        <div className="screen-center">
          <div style={{ fontSize: 48 }}>🫀</div>
          <h1>{t('pulseguard.title')}</h1>
          <p className="muted">{t('pulseguard.subtitle')}</p>
          <input
            type="text"
            placeholder={t('pulseguard.sessionPlaceholder')}
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--surface-2)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '16px',
              minHeight: '48px',
            }}
          />
          <button className="btn" onClick={handleStart}>
            {t('pulseguard.startSession')}
          </button>
        </div>
      )}

      {/* ─── ACTIVE ─── */}
      {state.phase === 'active' && (
        <>
          <div className="screen-center" style={{ paddingBottom: '80px' }}>
            <div style={{ fontSize: 48 }}>🫀</div>
            <h1>{t('pulseguard.monitoringActive')}</h1>
            <p className="muted">{t('pulseguard.sessionActiveFor')}</p>
            <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary, #888)' }}>
                {t('pulseguard.snapshotsSent')}: {state.snapshotsSent}
              </div>
              {state.isBackgrounded && (
                <div style={{ fontSize: '13px', color: '#f59e0b' }}>
                  {t('pulseguard.backgroundWarning')}
                </div>
              )}
              {state.lastSubmitError && (
                <div style={{ fontSize: '13px', color: '#ef4444' }}>
                  {t('pulseguard.lastError')}: {state.lastSubmitError}
                </div>
              )}
              <button
                className="btn"
                onClick={handleStop}
                style={{
                  background: '#dc2626',
                  borderColor: '#dc2626',
                  marginTop: '16px',
                }}
              >
                {t('pulseguard.stopSession')}
              </button>
            </div>
          </div>

          {/* Permanent transparency indicator — always visible during active session */}
          <PulseGuardIndicator />
        </>
      )}

      {/* ─── ENDED ─── */}
      {state.phase === 'ended' && (
        <div className="screen-center">
          <div style={{ fontSize: 48 }}>
            {state.endReason === 'background' ? '⏱️' : '✅'}
          </div>
          <h1>{t('pulseguard.sessionEnded')}</h1>
          <p className="muted">
            {state.endReason === 'background'
              ? t('pulseguard.endedBackground')
              : t('pulseguard.endedUser')}
          </p>
          <div style={{ marginTop: '16px', fontSize: '14px', color: 'var(--text-secondary, #888)' }}>
            {t('pulseguard.snapshotsSent')}: {state.snapshotsSent}
          </div>
          <div style={{ marginTop: '4px', fontSize: '13px', color: 'var(--text-secondary, #888)' }}>
            {t('pulseguard.startedAt')}: {state.startedAt ? new Date(state.startedAt).toLocaleTimeString() : '—'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary, #888)' }}>
            {t('pulseguard.endedAt')}: {state.endedAt ? new Date(state.endedAt).toLocaleTimeString() : '—'}
          </div>
          <button className="btn" onClick={handleReset} style={{ marginTop: '24px' }}>
            {t('pulseguard.newSession')}
          </button>
        </div>
      )}
    </div>
  );
}
