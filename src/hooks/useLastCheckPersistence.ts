/**
 * useLastCheckPersistence — Persist last check timestamp via @capacitor/preferences
 *
 * Stores the timestamp of the last successful check (foreground or background)
 * so it survives OS kills. This is the source of truth for inactivity detection
 * on foreground return — the in-memory ref (lastCheckSentAtRef) is lost when the
 * app is killed by the OS.
 *
 * Source of truth hierarchy:
 *   1. @capacitor/preferences (this hook) — survives OS kills, authoritative
 *   2. last_check_at (backend) — server-side, used for dashboard display
 *   3. lastCheckSentAtRef (in-memory) — ephemeral, used for scheduling only
 *
 * If the persisted timestamp and backend last_check_at diverge (e.g. device
 * clock was changed), the PERSISTED timestamp takes precedence for the
 * inactivity threshold calculation because it reflects the device's own
 * timeline, which is what the user actually experienced.
 *
 * On web (no Capacitor), falls back to localStorage so the mechanism works
 * in browser preview too.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useRef, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'pulseguard_last_check_ts';

async function getCapacitorPreferences(): Promise<{
  get: (opts: { key: string }) => Promise<{ value: string | null }>;
  set: (opts: { key: string; value: string }) => Promise<void>;
} | null> {
  try {
    const mod = await import('@capacitor/preferences');
    return mod.Preferences;
  } catch {
    return null;
  }
}

export function useLastCheckPersistence() {
  const cachedRef = useRef<number | null>(null);

  const persist = useCallback(async (timestampMs: number): Promise<void> => {
    cachedRef.current = timestampMs;
    const prefs = await getCapacitorPreferences();
    if (prefs) {
      try {
        await prefs.set({ key: STORAGE_KEY, value: String(timestampMs) });
      } catch {
        // Fallback to localStorage
        try { localStorage.setItem(STORAGE_KEY, String(timestampMs)); } catch { /* ignore */ }
      }
    } else {
      try { localStorage.setItem(STORAGE_KEY, String(timestampMs)); } catch { /* ignore */ }
    }
  }, []);

  const read = useCallback(async (): Promise<number | null> => {
    if (cachedRef.current !== null) return cachedRef.current;

    const prefs = await getCapacitorPreferences();
    if (prefs) {
      try {
        const { value } = await prefs.get({ key: STORAGE_KEY });
        if (value) {
          const ts = parseInt(value, 10);
          if (!isNaN(ts) && ts > 0) {
            cachedRef.current = ts;
            return ts;
          }
        }
      } catch {
        // fall through to localStorage
      }
    }

    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value) {
        const ts = parseInt(value, 10);
        if (!isNaN(ts) && ts > 0) {
          cachedRef.current = ts;
          return ts;
        }
      }
    } catch { /* ignore */ }

    return null;
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  return { persist, read };
}
