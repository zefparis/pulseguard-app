/**
 * Remote VAD Config — Client-side reader with memory + localStorage cache
 *
 * Fetches VAD thresholds from the hybrid-vector-api proxy endpoint
 * GET /api/vad-config?env=production
 *
 * The browser NEVER touches Supabase directly — only via this server-side proxy.
 * Falls back to hardcoded defaults from vad-thresholds.ts on any failure.
 *
 * Pattern adapted from hcs-widget-mvp/src/widget-v3/policy/remote-config.ts:
 *   - Safe defaults (hardcoded) always available
 *   - In-memory cache + localStorage cache
 *   - TTL-based freshness check
 *   - Silent fallback — never blocks the UI
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface VadThresholds {
  VAD_ENERGY_THRESHOLD: number;
  MIN_VOICED_DURATION_MS: number;
  MIN_VOICE_SEGMENT_MS: number;
  VOICE_SEGMENT_MERGE_GAP_MS: number;
}

interface CacheEntry {
  thresholds: VadThresholds;
  fetchedAt: number;
}

// ─── Hardcoded fallbacks (from vad-thresholds.ts P10-FINAL) ────────

const HARDCODED_DEFAULTS: VadThresholds = {
  VAD_ENERGY_THRESHOLD: 0.015,
  MIN_VOICED_DURATION_MS: 3000,
  MIN_VOICE_SEGMENT_MS: 500,
  VOICE_SEGMENT_MERGE_GAP_MS: 200,
};

// ─── Config ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds
const STORAGE_KEY = 'hcs:vad-config';
const FETCH_TIMEOUT_MS = 4000;

// The proxy endpoint on hybrid-vector-api. This URL should be configured
// via VITE_HV_API_URL or fallback to a sensible default.
function getProxyUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const baseUrl = env?.VITE_HV_API_URL || '';
  if (!baseUrl) return '';
  return `${baseUrl}/api/vad-config?env=production`;
}

// ─── Cache ─────────────────────────────────────────────────────────

let memoryCache: CacheEntry | null = null;

function supportsLocalStorage(): boolean {
  try {
    const k = '__hcs_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function readLocalCache(): CacheEntry | null {
  if (!supportsLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry.thresholds || !entry.fetchedAt) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeLocalCache(entry: CacheEntry): void {
  if (!supportsLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // quota exceeded — ignore
  }
}

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Fetch remote VAD config. Returns cached if fresh, otherwise fetches.
 * On failure, returns safe defaults.
 */
export async function fetchRemoteVadConfig(): Promise<VadThresholds> {
  // 1. Check memory cache
  if (memoryCache && isFresh(memoryCache)) {
    return memoryCache.thresholds;
  }

  // 2. Check localStorage cache
  const local = readLocalCache();
  if (local && isFresh(local)) {
    memoryCache = local;
    return local.thresholds;
  }

  // 3. Fetch from backend proxy
  const url = getProxyUrl();
  if (!url) {
    return HARDCODED_DEFAULTS;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    const thresholds = data.thresholds as VadThresholds | undefined;

    if (!thresholds || typeof thresholds.VAD_ENERGY_THRESHOLD !== 'number') {
      throw new Error('Invalid config shape');
    }

    const entry: CacheEntry = { thresholds, fetchedAt: Date.now() };
    memoryCache = entry;
    writeLocalCache(entry);

    return thresholds;
  } catch {
    // Use stale cache if available
    if (local) {
      memoryCache = local;
      return local.thresholds;
    }

    return HARDCODED_DEFAULTS;
  }
}

/**
 * Synchronous access to the last known thresholds (from cache or defaults).
 * Use this when you can't await — e.g., in VAD frame processing.
 */
export function getCachedVadThresholds(): VadThresholds {
  if (memoryCache) return memoryCache.thresholds;
  const local = readLocalCache();
  if (local) {
    memoryCache = local;
    return local.thresholds;
  }
  return HARDCODED_DEFAULTS;
}

/**
 * Force-clear cache (for testing).
 */
export function clearVadConfigCache(): void {
  memoryCache = null;
  if (supportsLocalStorage()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
