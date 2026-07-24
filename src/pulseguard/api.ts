/**
 * PulseGuard — API client
 *
 * Submits periodic signal snapshots to the backend and fetches link
 * configuration from a signed token.
 *
 * Pattern follows demoguard/api.ts: fetch with AbortController timeout,
 * typed errors, no PII in logs.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import {
  PULSEGUARD_API_PATH,
  PULSEGUARD_LINK_CONFIG_PATH,
  PULSEGUARD_ENROLLMENT_PATH,
  PULSEGUARD_ENROLLMENT_TEST_PROGRESS_PATH,
  PULSEGUARD_REQUEST_TIMEOUT_MS,
  PULSEGUARD_SOURCE,
} from './constants';

export interface PulseGuardSnapshotPayload {
  hcs_session_public_id: string;
  source: typeof PULSEGUARD_SOURCE;
  link_token: string;
  pulse_guard: {
    version: string;
    snapshot_at: string;
    started_at: string;
    signals: Record<string, unknown>;
    /**
     * Informational-only device motion state ('stationary' | 'carried' | 'unknown').
     * COMPLETELY SEPARATE from scoring — never enters computeHumanState / HumanStateInput.
     * Exists for manager display and future Brain ML raw-data learning.
     */
    device_motion_state?: 'stationary' | 'carried' | 'unknown';
  };
}

export interface PulseGuardSnapshotResponse {
  ok: boolean;
  received: boolean;
  snapshot_seq?: number;
  message?: string;
}

export interface PulseGuardLinkConfig {
  ok: boolean;
  checkFrequencyMs: number;
  captureWindowSec: number;
  cognitiveEnrollmentRequired?: boolean;
}

export interface PulseGuardEnrollmentPayload {
  hcs_session_public_id: string;
  link_token: string;
  source: typeof PULSEGUARD_SOURCE;
  cognitive_signals: {
    reflex: unknown;
    stroop: unknown;
    digit_span: unknown;
    n_back: unknown;
    trail_tap: unknown;
    vocal_ran: unknown;
    summary: unknown;
  };
  behavior: {
    taskBehaviors: unknown;
    summary: unknown;
  };
  touchDiagnosticsBehavior: unknown;
  voice_diagnostics?: unknown;
  sensitive?: {
    voice_b64?: string;
    voice_mimetype?: string;
  };
}

export interface PulseGuardEnrollmentResponse {
  ok: boolean;
  received: boolean;
  cognitiveStatus: 'passed' | 'review' | 'failed';
  decisionCap: 'APPROVED' | 'REVIEW' | 'REJECTED';
  message?: string;
}

export class PulseGuardApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PulseGuardApiError';
    this.status = status;
    this.code = code;
  }
}

export async function submitPulseGuardSnapshot(
  payload: PulseGuardSnapshotPayload,
): Promise<PulseGuardSnapshotResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSEGUARD_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(PULSEGUARD_API_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_PULSEGUARD_API_KEY || '',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      let code = 'HTTP_ERROR';
      let message = `PulseGuard snapshot failed: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        if (body.error) code = body.error;
        if (body.message) message = body.message;
      } catch {
        // body not JSON
      }
      throw new PulseGuardApiError(res.status, code, message);
    }

    return res.json() as Promise<PulseGuardSnapshotResponse>;
  } finally {
    clearTimeout(timer);
  }
}

export interface PulseGuardTestProgressPayload {
  hcs_session_public_id: string;
  link_token: string;
  source: typeof PULSEGUARD_SOURCE;
  test_name: string;
  test_index: number;
  total_tests: number;
  quality: string;
  qualitative_summary: string;
}

export interface PulseGuardTestProgressResponse {
  ok: boolean;
  received: boolean;
  message?: string;
}

export async function submitPulseGuardEnrollment(
  payload: PulseGuardEnrollmentPayload,
): Promise<PulseGuardEnrollmentResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSEGUARD_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(PULSEGUARD_ENROLLMENT_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_PULSEGUARD_API_KEY || '',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      let code = 'HTTP_ERROR';
      let message = `Enrollment submission failed: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        if (body.error) code = body.error;
        if (body.message) message = body.message;
      } catch {
        // body not JSON
      }
      throw new PulseGuardApiError(res.status, code, message);
    }

    return res.json() as Promise<PulseGuardEnrollmentResponse>;
  } finally {
    clearTimeout(timer);
  }
}

export async function submitPulseGuardTestProgress(
  payload: PulseGuardTestProgressPayload,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSEGUARD_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(PULSEGUARD_ENROLLMENT_TEST_PROGRESS_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_PULSEGUARD_API_KEY || '',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      let code = 'HTTP_ERROR';
      let message = `Test progress submission failed: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        if (body.error) code = body.error;
        if (body.message) message = body.message;
      } catch {
        // body not JSON
      }
      throw new PulseGuardApiError(res.status, code, message);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLinkConfig(
  token: string,
): Promise<PulseGuardLinkConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSEGUARD_REQUEST_TIMEOUT_MS);

  try {
    const url = `${PULSEGUARD_LINK_CONFIG_PATH}?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': import.meta.env.VITE_PULSEGUARD_API_KEY || '',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      let code = 'HTTP_ERROR';
      let message = `Link config fetch failed: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        if (body.error) code = body.error;
        if (body.message) message = body.message;
      } catch {
        // body not JSON
      }
      throw new PulseGuardApiError(res.status, code, message);
    }

    return res.json() as Promise<PulseGuardLinkConfig>;
  } finally {
    clearTimeout(timer);
  }
}
