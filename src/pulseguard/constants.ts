/**
 * PulseGuard — Configuration constants
 *
 * All tunable values for the continuous monitoring lifecycle.
 * Centralized here to avoid magic numbers scattered across the codebase.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

/** Interval between periodic signal snapshot submissions (milliseconds). Default: 10 minutes. */
export const PULSEGUARD_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

/** How long the app can stay in background (hidden) before the session auto-ends (milliseconds). Default: 5 minutes. */
export const PULSEGUARD_BACKGROUND_TIMEOUT_MS = 5 * 60 * 1000;

/** API endpoint for submitting signal snapshots. Backend not yet implemented — client-side only for now. */
export const PULSEGUARD_API_PATH = '/api/pulseguard/signals';

/** Request timeout for snapshot submission (milliseconds). */
export const PULSEGUARD_REQUEST_TIMEOUT_MS = 15_000;

/** PulseGuard client version. */
export const PULSEGUARD_VERSION = '1.0.0';

/** Source identifier sent in payloads. */
export const PULSEGUARD_SOURCE = 'pulseguard_mobile' as const;
