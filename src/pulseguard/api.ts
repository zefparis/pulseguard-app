/**
 * PulseGuard — API client
 *
 * Submits periodic signal snapshots to the backend.
 * Pattern follows demoguard/api.ts: fetch with AbortController timeout,
 * typed errors, no PII in logs.
 *
 * The endpoint /api/pulseguard/signals does NOT exist yet on the backend —
 * this is client-side only for now. Errors are non-fatal: the session
 * continues even if submission fails.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { PULSEGUARD_API_PATH, PULSEGUARD_REQUEST_TIMEOUT_MS, PULSEGUARD_SOURCE } from './constants';

export interface PulseGuardSnapshotPayload {
  hcs_session_public_id: string;
  source: typeof PULSEGUARD_SOURCE;
  pulse_guard: {
    version: string;
    snapshot_at: string;
    started_at: string;
    signals: Record<string, unknown>;
  };
}

export interface PulseGuardSnapshotResponse {
  ok: boolean;
  received: boolean;
  snapshot_seq?: number;
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
      headers: { 'Content-Type': 'application/json' },
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
