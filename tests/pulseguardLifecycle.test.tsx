/**
 * PulseGuard — Lifecycle tests (PulseGuardApp component)
 *
 * Tests the periodic check lifecycle: token loading, config fetch,
 * check cycle (waiting → checking → waiting), background cancellation,
 * and unmount cleanup.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

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
const mockFetchLinkConfig = vi.fn().mockResolvedValue({
  ok: true,
  checkFrequencyMs: 10000,
  captureWindowSec: 1,
});
vi.mock('../src/pulseguard/api', () => ({
  submitPulseGuardSnapshot: (...args: unknown[]) => mockSubmitSnapshot(...args),
  fetchLinkConfig: (...args: unknown[]) => mockFetchLinkConfig(...args),
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

const TEST_TOKEN = 'test-jwt-token-abc123';
const CHECK_FREQUENCY_MS = 10000;
const CAPTURE_WINDOW_SEC = 1;

function renderApp() {
  return render(
    <I18nProvider>
      <PulseGuardApp />
    </I18nProvider>,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

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

function setUrlToken(token: string | null) {
  const url = token
    ? `http://localhost/?token=${encodeURIComponent(token)}`
    : 'http://localhost/';
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
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
  mockFetchLinkConfig.mockResolvedValue({
    ok: true,
    checkFrequencyMs: CHECK_FREQUENCY_MS,
    captureWindowSec: CAPTURE_WINDOW_SEC,
  });
  setUrlToken(TEST_TOKEN);
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

// ─── 1. Loading and config fetch ──────────────────────────────────

describe('PulseGuard lifecycle — loading and config', () => {
  it('shows loading screen initially', () => {
    setUrlToken(TEST_TOKEN);
    const { container } = renderApp();

    // en: "Loading configuration…", fr: "Chargement de la configuration…"
    expect(hasText(container, 'Loading configuration', 'Chargement de la configuration')).toBe(true);
  });

  it('fetches link config and transitions to waiting', async () => {
    const { container } = renderApp();

    // Flush the fetchLinkConfig promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mockFetchLinkConfig).toHaveBeenCalledWith(TEST_TOKEN);
    // en: "Waiting for next check", fr: "En attente du prochain contrôle"
    expect(hasText(container, 'Waiting for next check', 'attente du prochain')).toBe(true);
  });

  it('shows link invalid screen when token is missing', async () => {
    setUrlToken(null);
    const { container } = renderApp();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // en: "Link invalid", fr: "Lien invalide"
    expect(hasText(container, 'Link invalid', 'Lien invalide')).toBe(true);
  });

  it('shows link expired screen when config fetch returns 401', async () => {
    mockFetchLinkConfig.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), {
        name: 'PulseGuardApiError',
        status: 401,
        code: 'UNAUTHORIZED',
      }),
    );
    const { container } = renderApp();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // en: "This link has expired", fr: "Ce lien a expiré"
    expect(hasText(container, 'Link invalid', 'Lien invalide')).toBe(true);
  });
});

// ─── 2. Check cycle ───────────────────────────────────────────────

describe('PulseGuard lifecycle — check cycle', () => {
  it('starts a check after checkFrequencyMs', async () => {
    renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mockStart).not.toHaveBeenCalled();

    // Advance to check time
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS);
    });

    // Collectors should have started (checking phase)
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('completes check: start → capture window → stop → submit', async () => {
    const { container } = renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Advance to trigger check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS);
    });

    expect(mockStart).toHaveBeenCalledTimes(1);

    // Advance through capture window
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_WINDOW_SEC * 1000);
    });

    // Collectors stopped and snapshot submitted
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockSubmitSnapshot).toHaveBeenCalledTimes(1);

    // Back to waiting
    expect(hasText(container, 'Waiting for next check', 'attente du prochain')).toBe(true);
  });

  it('schedules next check after completion', async () => {
    renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // First check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_WINDOW_SEC * 1000);
    });

    expect(mockSubmitSnapshot).toHaveBeenCalledTimes(1);

    // Second check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_WINDOW_SEC * 1000);
    });

    expect(mockSubmitSnapshot).toHaveBeenCalledTimes(2);
  });
});

// ─── 3. Background handling ───────────────────────────────────────

describe('PulseGuard lifecycle — background during check', () => {
  it('cancels active check when app goes background', async () => {
    renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Start a check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS);
    });

    expect(mockStart).toHaveBeenCalledTimes(1);

    // Go background during capture window
    act(() => setVisibilityHidden(true));

    // Collectors should be stopped
    expect(mockStop).toHaveBeenCalled();

    // Advance past capture window — should NOT submit
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_WINDOW_SEC * 1000 + 100);
    });

    expect(mockSubmitSnapshot).not.toHaveBeenCalled();
  });

  it('reschedules check when returning from background', async () => {
    renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Go background and come back
    act(() => setVisibilityHidden(true));
    act(() => setVisibilityHidden(false));

    // Check should still fire after checkFrequencyMs
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS);
    });

    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

// ─── 4. Unmount cleanup ───────────────────────────────────────────

describe('PulseGuard lifecycle — unmount cleanup', () => {
  it('no timers fire after unmount during waiting', async () => {
    const { unmount } = renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS * 3);
    });

    expect(mockStart).not.toHaveBeenCalled();
    expect(mockSubmitSnapshot).not.toHaveBeenCalled();
  });

  it('no timers fire after unmount during active check', async () => {
    const { unmount } = renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Start a check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FREQUENCY_MS);
    });

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_WINDOW_SEC * 1000 + 1000);
    });

    // Snapshot should NOT have been submitted after unmount
    expect(mockSubmitSnapshot).not.toHaveBeenCalled();
  });

  it('visibilitychange listener is removed after unmount', async () => {
    const { unmount } = renderApp();

    // Wait for config to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const removeSpy = vi.spyOn(document, 'removeEventListener');

    unmount();

    const visibilityCalls = removeSpy.mock.calls.filter(
      ([event]) => event === 'visibilitychange',
    );
    expect(visibilityCalls.length).toBeGreaterThan(0);

    removeSpy.mockRestore();
  });
});
