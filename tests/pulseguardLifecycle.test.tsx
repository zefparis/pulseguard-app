/**
 * PulseGuard — Lifecycle tests (PulseGuardApp component)
 *
 * Tests the timer/visibility/snapshot logic in PulseGuardApp.tsx using
 * fake timers, mocked useContinuousSignals, and mocked fetch.
 *
 * Critical scenarios:
 * 1. Background return before timeout → session continues
 * 2. Background timeout fires at exactly PULSEGUARD_BACKGROUND_TIMEOUT_MS
 * 3. Rapid visibility bounce → no timer accumulation
 * 4. Snapshot interval fires at correct frequency, stops on ended
 * 5. Unmount cleanup → no orphan timers/listeners
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import {
  PULSEGUARD_SNAPSHOT_INTERVAL_MS,
  PULSEGUARD_BACKGROUND_TIMEOUT_MS,
} from '../src/pulseguard/constants';

// ─── Mocks ────────────────────────────────────────────────────────

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockReturnValue({ motion: { samples: 1 } });
const mockIsCollecting = vi.fn().mockReturnValue(false);
const mockSetPhase = vi.fn();

vi.mock('../src/hooks/useContinuousSignals', () => ({
  useContinuousSignals: () => ({
    start: mockStart,
    stop: mockStop,
    isCollecting: mockIsCollecting,
    setPhase: mockSetPhase,
  }),
}));

const mockSubmitSnapshot = vi.fn().mockResolvedValue({ ok: true, received: true });
vi.mock('../src/pulseguard/api', () => ({
  submitPulseGuardSnapshot: (...args: unknown[]) => mockSubmitSnapshot(...args),
  PulseGuardApiError: class PulseGuardApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'PulseGuardApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

// Import after mocks are set up
import PulseGuardApp from '../src/PulseGuardApp';
import { I18nProvider } from '../src/i18n/I18nContext';

function renderApp() {
  return render(
    <I18nProvider>
      <PulseGuardApp />
    </I18nProvider>,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

// Locale-independent text matching (jsdom defaults to en, but tests
// should work regardless of which locale the I18nProvider picks).
function hasText(container: HTMLElement, en: string, fr: string): boolean {
  const text = container.textContent ?? '';
  return text.includes(en) || text.includes(fr);
}

function setVisibilityHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    value: hidden,
    configurable: true,
    writable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

// handleStart is async (awaits continuousSignals.start), so we need
// async act to flush the microtask before assertions.
async function startSession(container: HTMLElement) {
  const buttons = container.querySelectorAll('button');
  // en: "Start session", fr: "Démarrer la session"
  const startBtn = Array.from(buttons).find(
    (b) => b.textContent?.includes('Start') || b.textContent?.includes('Démarrer'),
  );
  expect(startBtn).toBeTruthy();
  await act(async () => {
    fireEvent.click(startBtn!);
  });
}

function stopSession(container: HTMLElement) {
  const buttons = container.querySelectorAll('button');
  // en: "Stop session", fr: "Arrêter la session"
  const stopBtn = Array.from(buttons).find(
    (b) => b.textContent?.includes('Stop') || b.textContent?.includes('Arrêter'),
  );
  expect(stopBtn).toBeTruthy();
  act(() => {
    fireEvent.click(stopBtn!);
  });
}

// ─── Test setup ───────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockStart.mockResolvedValue(undefined);
  mockStop.mockReturnValue({ motion: { samples: 1 } });
  mockIsCollecting.mockReturnValue(false);
  mockSubmitSnapshot.mockResolvedValue({ ok: true, received: true });
  Object.defineProperty(document, 'hidden', {
    value: false,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ─── 1. Background return before timeout → session continues ─────

describe('PulseGuard lifecycle — background return before timeout', () => {
  it('session continues if user returns before PULSEGUARD_BACKGROUND_TIMEOUT_MS', async () => {
    const { container } = renderApp();
    await startSession(container);

    // en: "Monitoring active", fr: "Surveillance active"
    expect(hasText(container, 'Monitoring active', 'Surveillance active')).toBe(true);

    // Go background
    act(() => setVisibilityHidden(true));
    // en: "App in background", fr: "Application en arrière-plan"
    expect(hasText(container, 'App in background', 'arrière-plan')).toBe(true);

    // Advance less than timeout
    act(() => {
      vi.advanceTimersByTime(PULSEGUARD_BACKGROUND_TIMEOUT_MS - 1000);
    });

    // Come back to foreground
    act(() => setVisibilityHidden(false));

    // Session should still be active
    expect(hasText(container, 'Monitoring active', 'Surveillance active')).toBe(true);
    expect(hasText(container, 'Session ended', 'Session terminée')).toBe(false);
  });

  it('no double-start of collectors when returning from background', async () => {
    const { container } = renderApp();
    await startSession(container);

    const startCallsBefore = mockStart.mock.calls.length;

    act(() => setVisibilityHidden(true));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => setVisibilityHidden(false));

    expect(mockStart.mock.calls.length).toBe(startCallsBefore);
  });
});

// ─── 2. Background timeout fires at correct time ─────────────────

describe('PulseGuard lifecycle — background timeout', () => {
  it('session auto-ends exactly at PULSEGUARD_BACKGROUND_TIMEOUT_MS', async () => {
    const { container } = renderApp();
    await startSession(container);

    act(() => setVisibilityHidden(true));

    // Just before timeout — still active
    act(() => {
      vi.advanceTimersByTime(PULSEGUARD_BACKGROUND_TIMEOUT_MS - 1);
    });
    expect(hasText(container, 'Monitoring active', 'Surveillance active')).toBe(true);

    // Past timeout — should end
    act(() => {
      vi.advanceTimersByTime(2);
    });

    expect(hasText(container, 'Session ended', 'Session terminée')).toBe(true);
    // en: "app was in background", fr: "arrière-plan"
    expect(hasText(container, 'background', 'arrière-plan')).toBe(true);
  });

  it('does NOT auto-end before PULSEGUARD_BACKGROUND_TIMEOUT_MS', async () => {
    const { container } = renderApp();
    await startSession(container);

    act(() => setVisibilityHidden(true));

    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000);
    });

    expect(hasText(container, 'Monitoring active', 'Surveillance active')).toBe(true);
    expect(hasText(container, 'Session ended', 'Session terminée')).toBe(false);
  });
});

// ─── 3. Rapid visibility bounce → no timer accumulation ──────────

describe('PulseGuard lifecycle — rapid visibility bounce', () => {
  it('multiple rapid hidden/visible cycles do not accumulate timers', async () => {
    const { container } = renderApp();
    await startSession(container);

    // Rapid bounce: hidden → visible → hidden → visible → hidden
    act(() => setVisibilityHidden(true));
    act(() => setVisibilityHidden(false));
    act(() => setVisibilityHidden(true));
    act(() => setVisibilityHidden(false));
    act(() => setVisibilityHidden(true));

    // Advance past timeout — session should end (from the last hidden)
    act(() => {
      vi.advanceTimersByTime(PULSEGUARD_BACKGROUND_TIMEOUT_MS + 100);
    });

    expect(hasText(container, 'Session ended', 'Session terminée')).toBe(true);
    expect(hasText(container, 'background', 'arrière-plan')).toBe(true);
  });

  it('returning from bounce before timeout keeps session alive', async () => {
    const { container } = renderApp();
    await startSession(container);

    for (let i = 0; i < 5; i++) {
      act(() => setVisibilityHidden(true));
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      act(() => setVisibilityHidden(false));
    }

    // Total elapsed: 5 * 30s = 150s < 300s (5 min)
    expect(hasText(container, 'Monitoring active', 'Surveillance active')).toBe(true);
  });
});

// ─── 4. Snapshot interval ────────────────────────────────────────

describe('PulseGuard lifecycle — snapshot interval', () => {
  it('snapshot is submitted at PULSEGUARD_SNAPSHOT_INTERVAL_MS', async () => {
    const { container } = renderApp();
    await startSession(container);

    expect(mockSubmitSnapshot).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PULSEGUARD_SNAPSHOT_INTERVAL_MS - 1);
    });
    expect(mockSubmitSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });

    expect(mockSubmitSnapshot).toHaveBeenCalledTimes(1);
  });

  it('snapshot stops when session ends (user stop)', async () => {
    const { container } = renderApp();
    await startSession(container);

    stopSession(container);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PULSEGUARD_SNAPSHOT_INTERVAL_MS * 3);
    });

    // handleStop sends one final snapshot, so at most 1 call total
    expect(mockSubmitSnapshot.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('snapshot stops when session ends (background timeout)', async () => {
    const { container } = renderApp();
    await startSession(container);

    act(() => setVisibilityHidden(true));
    act(() => {
      vi.advanceTimersByTime(PULSEGUARD_BACKGROUND_TIMEOUT_MS + 100);
    });

    expect(hasText(container, 'Session ended', 'Session terminée')).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PULSEGUARD_SNAPSHOT_INTERVAL_MS * 3);
    });

    // No periodic snapshots should fire after background-end
    expect(mockSubmitSnapshot).not.toHaveBeenCalled();
  });
});

// ─── 5. Unmount cleanup ───────────────────────────────────────────

describe('PulseGuard lifecycle — unmount cleanup', () => {
  it('no timers fire after unmount during active session', async () => {
    const { container, unmount } = renderApp();
    await startSession(container);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PULSEGUARD_SNAPSHOT_INTERVAL_MS * 2);
      await vi.advanceTimersByTimeAsync(PULSEGUARD_BACKGROUND_TIMEOUT_MS * 2);
    });

    // No snapshots should have been submitted after unmount
    expect(mockSubmitSnapshot).not.toHaveBeenCalled();
  });

  it('no background timeout fires after unmount', async () => {
    const { container, unmount } = renderApp();
    await startSession(container);

    act(() => setVisibilityHidden(true));
    unmount();

    // Advance past background timeout — should not throw or cause side effects
    act(() => {
      vi.advanceTimersByTime(PULSEGUARD_BACKGROUND_TIMEOUT_MS + 1000);
    });

    // Test passing without errors is the assertion — if the timer
    // wasn't cleaned up, it would try to dispatch on an unmounted component.
  });

  it('visibilitychange listener is removed after unmount', async () => {
    const { container, unmount } = renderApp();
    await startSession(container);

    const removeSpy = vi.spyOn(document, 'removeEventListener');

    unmount();

    const visibilityCalls = removeSpy.mock.calls.filter(
      ([event]) => event === 'visibilitychange',
    );
    expect(visibilityCalls.length).toBeGreaterThan(0);

    removeSpy.mockRestore();
  });
});
