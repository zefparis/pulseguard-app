/**
 * PulseGuard — Configuration constants
 *
 * In the periodic check model, checkFrequencyMs and captureWindowSec come
 * from the server via GET /api/pulseguard/link-config. The constants below
 * are FALLBACK values used only if the link-config call fails unexpectedly
 * after the token has already been validated (e.g. transient network loss).
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

/** Fallback check frequency (milliseconds) if link-config fetch fails. Default: 5 minutes. */
export const PULSEGUARD_FALLBACK_CHECK_FREQUENCY_MS = 5 * 60 * 1000;

/** Fallback capture window duration (seconds) if link-config fetch fails. Default: 30 seconds. */
export const PULSEGUARD_FALLBACK_CAPTURE_WINDOW_SEC = 30;

/** API endpoint for submitting signal snapshots. */
export const PULSEGUARD_API_PATH = '/api/pulseguard/signals';

/** API endpoint for fetching link configuration from token. */
export const PULSEGUARD_LINK_CONFIG_PATH = '/api/pulseguard/link-config';

/** Request timeout for snapshot submission (milliseconds). */
export const PULSEGUARD_REQUEST_TIMEOUT_MS = 15_000;

/** PulseGuard client version. */
export const PULSEGUARD_VERSION = '1.0.0';

/** API endpoint for submitting cognitive enrollment data. */
export const PULSEGUARD_ENROLLMENT_PATH = '/api/pulseguard/enrollment';

/** API endpoint for publishing per-test enrollment progress events. */
export const PULSEGUARD_ENROLLMENT_TEST_PROGRESS_PATH = '/api/pulseguard/enrollment/test-progress';

/** Source identifier sent in payloads. */
export const PULSEGUARD_SOURCE = 'pulseguard_mobile' as const;
