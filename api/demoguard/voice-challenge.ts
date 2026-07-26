/**
 * PulseGuard — Voice challenge proxy handler
 *
 * POST /api/demoguard/voice-challenge
 *
 * Forwards the voice challenge nonce request to the hybrid-vector-api,
 * which in turn calls the HCS backend to issue a one-time-use nonce.
 *
 * Security:
 * - POST only, OPTIONS preflight
 * - Origin allowlist (no wildcard CORS)
 * - HV_API_KEY injected server-side only
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ─── Types ─────────────────────────────────────────────────────────

export interface DemoGuardRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[]>;
}

export interface DemoGuardResponse extends ServerResponse {
  status: (code: number) => DemoGuardResponse;
  json: (data: unknown) => void;
  send: (data: string | Buffer) => void;
}

// ─── Config ────────────────────────────────────────────────────────

const UPSTREAM_TIMEOUT_MS = 10_000;

const DEFAULT_ALLOWED_ORIGINS = [
  'capacitor://localhost',
  'https://localhost',
  'http://localhost:5173',
  'http://localhost:3001',
];

function getAllowedOrigins(): Set<string> {
  const set = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  const envOrigins = process.env.PAYGUARD_ALLOWED_ORIGINS;
  if (envOrigins) {
    for (const o of envOrigins.split(',')) {
      const trimmed = o.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return set;
}

function getUpstreamUrl(): string {
  const base = process.env.HYBRID_VECTOR_API_URL || 'https://hybrid-vector-api-m5xt.onrender.com';
  return `${base.replace(/\/+$/, '')}/demoguard/voice-challenge`;
}

function getTenantId(): string {
  return process.env.DEMOGUARD_TENANT_ID || 'demoguard-demo';
}

// ─── Helpers ───────────────────────────────────────────────────────

function getClientIp(req: DemoGuardRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

function isCapacitorRequest(req: DemoGuardRequest): boolean {
  const ua = req.headers['user-agent'] ?? '';
  const origin = req.headers.origin ?? '';
  return (
    ua.toLowerCase().includes('capacitor') ||
    origin.startsWith('capacitor://') ||
    origin === 'https://localhost'
  );
}

function safeLog(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>): void {
  const line = JSON.stringify(fields);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function safeError(message: string): Record<string, unknown> {
  return {
    ok: false,
    success: false,
    error: message,
  };
}

// ─── Main handler ──────────────────────────────────────────────────

export default async function demoguardVoiceChallengeHandler(
  req: DemoGuardRequest,
  res: DemoGuardResponse,
): Promise<void> {
  const startTime = Date.now();
  const ip = getClientIp(req);
  const origin = (req.headers.origin ?? '') as string;

  // ── CORS ──
  if (origin) {
    const allowed = getAllowedOrigins();
    if (allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    } else {
      safeLog('warn', { msg: 'CORS_ORIGIN_DENIED', origin, ip });
      res.status(403).json(safeError('Origin not allowed'));
      return;
    }
  } else if (!isCapacitorRequest(req)) {
    safeLog('warn', { msg: 'CORS_NO_ORIGIN', ip });
    res.status(403).json(safeError('Origin header required'));
    return;
  }

  // ── OPTIONS preflight ──
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // ── POST only ──
  if (req.method !== 'POST') {
    res.status(405).json(safeError('Only POST is supported'));
    return;
  }

  // ── Parse JSON safely ──
  let body: Record<string, unknown>;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as Record<string, unknown>;
  } catch {
    res.status(400).json(safeError('Invalid JSON'));
    return;
  }

  // ── Validate required hcs_session_public_id ──
  const sessionId = body.hcs_session_public_id;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json(safeError('hcs_session_public_id is required'));
    return;
  }

  // ── Force server-side source + tenantId ──
  body.source = 'pulseguard_mobile';
  body.tenant_id = getTenantId();

  // ── API key (server-side only) ──
  const apiKey = process.env.HV_API_KEY;
  if (!apiKey) {
    safeLog('error', { msg: 'CONFIG_ERROR', reason: 'HV_API_KEY not set' });
    res.status(500).json(safeError('Server misconfigured'));
    return;
  }

  safeLog('info', {
    event: 'pulseguard_voice_challenge_proxy',
    sessionPublicId: sessionId,
  });

  // ── Forward to upstream ──
  const targetUrl = getUpstreamUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const durationMs = Date.now() - startTime;

    safeLog('info', {
      msg: 'pulseguard_voice_challenge_proxy_ok',
      status: upstreamRes.status,
      durationMs,
    });

    let upstreamData: unknown;
    try {
      upstreamData = await upstreamRes.json();
    } catch {
      res.status(502).json(safeError('Voice challenge unavailable'));
      return;
    }

    res.status(upstreamRes.status).json(upstreamData);
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    safeLog('error', {
      msg: isAbort ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      durationMs: Date.now() - startTime,
    });
    res.status(502).json(safeError('Voice challenge unavailable'));
  }
}
