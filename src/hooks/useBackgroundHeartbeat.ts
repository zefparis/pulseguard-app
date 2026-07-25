/**
 * useBackgroundHeartbeat — Dispatches config to the silent background heartbeat
 *
 * The @capacitor/background-runner plugin registers the task automatically
 * via capacitor.config.ts. After the app loads its link config (token,
 * API key, session ID), we dispatch the config to the background runner
 * so it can send periodic "device alive" heartbeats.
 *
 * IMPORTANT: This is a BEST-EFFORT improvement over the current situation
 * (total silence in background). The OS controls when the task runs:
 *  - iOS: OS-determined timing, ~30s runtime, may not run in simulator
 *  - Android: 15-minute minimum interval, subject to battery optimizations
 *
 * The heartbeat sends NO behavioral data (sensors are inaccessible from
 * the background-runner JS engine). It only signals "device is alive".
 * Full behavioral checks continue via the JS scheduler when in foreground.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useEffect, useRef } from 'react';

interface BackgroundHeartbeatConfig {
  linkToken: string;
  hcsSessionPublicId: string;
  apiPath: string;
  apiKey: string;
  source: string;
  version: string;
  enabled: boolean;
}

// Lazy import — only available in Capacitor native runtime, not in web build
async function getBackgroundRunner(): Promise<typeof import('@capacitor/background-runner') | null> {
  try {
    return await import('@capacitor/background-runner');
  } catch {
    return null;
  }
}

export function useBackgroundHeartbeat(config: BackgroundHeartbeatConfig | null): void {
  const dispatchedRef = useRef(false);

  useEffect(() => {
    if (!config || !config.enabled || dispatchedRef.current) return;

    let cancelled = false;

    (async () => {
      const bgRunner = await getBackgroundRunner();
      if (!bgRunner || cancelled) return;

      try {
        // Dispatch the runtime config to the background runner task.
        // The task itself is registered via capacitor.config.ts;
        // this sends the data (token, API key, etc.) it needs to send heartbeats.
        await bgRunner.BackgroundRunner.dispatchEvent({
          label: 'PulseGuardHeartbeat',
          event: 'backgroundTask',
          details: {
            apiPath: config.apiPath,
            apiKey: config.apiKey,
            linkToken: config.linkToken,
            hcsSessionPublicId: config.hcsSessionPublicId,
            source: config.source,
            version: config.version,
          },
        });

        dispatchedRef.current = true;
        console.info('[PulseGuard] Background heartbeat config dispatched');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[PulseGuard] Background heartbeat dispatch failed: ${msg}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config]);
}
