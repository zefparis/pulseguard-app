/**
 * PulseGuard Background Runner Task — Silent heartbeat
 *
 * Runs in @capacitor/background-runner's restricted JS engine (NOT a webview).
 * This engine has NO DOM, NO sensor access (devicemotion, touch, etc.),
 * but DOES support fetch() and console.
 *
 * What this task does:
 *  - Sends a lightweight "heartbeat" POST to the PulseGuard signals endpoint
 *    with no behavioral data (signals = empty object).
 *    This tells the server "the device is alive in background" without
 *    capturing any behavioral signals (which is impossible from this context).
 *
 * What this task does NOT do:
 *  - Capture motion/touch data (no sensor APIs available)
 *  - Display notifications (never — product decision to preserve signal spontaneity)
 *  - Run exact-interval timers (OS decides when to trigger, not us)
 *
 * Limitations imposed by the OS:
 *  - iOS: ~30 seconds of runtime per invocation. OS decides timing.
 *    Not executed in simulator. May not run if app is rarely used.
 *  - Android: 15-minute minimum interval between executions.
 *    Actual timing subject to battery optimizations.
 *
 * The full behavioral check (motion/touch capture + snapshot submission)
 * continues to run via the existing JS scheduler in PulseGuardApp.tsx
 * whenever the app is in the foreground.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

// ── Types ──────────────────────────────────────────────────────

interface BackgroundTaskEvent {
  eventId: string;
  data?: Record<string, unknown>;
}

interface HeartbeatConfig {
  apiPath: string;
  apiKey: string;
  linkToken: string;
  hcsSessionPublicId: string;
  source: string;
  version: string;
}

// ── Task handler ───────────────────────────────────────────────

async function handleHeartbeat(
  event: BackgroundTaskEvent,
): Promise<Record<string, unknown>> {
  const config = event.data as unknown as HeartbeatConfig | undefined;

  if (!config || !config.apiPath || !config.linkToken) {
    console.warn('[PulseGuard BG] Missing config, skipping heartbeat');
    return { ok: false, reason: 'missing_config' };
  }

  const payload = {
    hcs_session_public_id: config.hcsSessionPublicId,
    source: config.source,
    link_token: config.linkToken,
    pulse_guard: {
      version: config.version,
      snapshot_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      signals: {},
      background_heartbeat: true,
    },
  };

  try {
    const response = await fetch(config.apiPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `[PulseGuard BG] Heartbeat failed: ${response.status}`,
      );
      return { ok: false, reason: `http_${response.status}` };
    }

    console.info('[PulseGuard BG] Heartbeat sent successfully');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PulseGuard BG] Heartbeat error: ${msg}`);
    return { ok: false, reason: 'network_error' };
  }
}

// ── Event listener (entry point for background-runner) ────────

addEventListener(
  'backgroundTask',
  (event: unknown) => {
    const taskEvent = event as BackgroundTaskEvent;
    handleHeartbeat(taskEvent)
      .then((result) => {
        // Signal completion to the OS so it can release resources
        (taskEvent as unknown as { completed: (result: unknown) => void }).completed(result);
      })
      .catch((err) => {
        console.error(`[PulseGuard BG] Fatal: ${err}`);
        (taskEvent as unknown as { completed: (result: unknown) => void }).completed({
          ok: false,
          reason: 'fatal_error',
        });
      });
  },
);
