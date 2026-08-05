/**
 * DemoGuard — Hardened Vercel proxy handler
 *
 * POST /api/demoguard/verify
 *
 * Security:
 * - POST only, OPTIONS preflight
 * - Origin allowlist (no wildcard CORS)
 * - Best-effort rate limiting
 * - Server-side tenant + source enforcement
 * - HV_API_KEY injected server-side only
 * - Upstream response sanitized (no PII, raw biometrics, tokens, embeddings)
 * - Safe error responses (no stack traces)
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sanitizeResponse } from '../_lib/demoguardSanitize.js';

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

const UPSTREAM_TIMEOUT_MS = 15_000;
const RATE_WINDOW_MS = 60_000;

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
  const base = process.env.HYBRID_VECTOR_API_URL || 'https://hybrid-vector-api-owc4.onrender.com';
  return `${base.replace(/\/+$/, '')}/demoguard/verify`;
}

function getTenantId(): string {
  return process.env.DEMOGUARD_TENANT_ID || 'demoguard-demo';
}

function getRateLimitPerMin(): number {
  const raw = process.env.DEMOGUARD_PROXY_RATE_LIMIT_PER_MIN;
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ─── Rate limiting ─────────────────────────────────────────────────

const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): boolean {
  const limit = getRateLimitPerMin();
  if (limit === 0) return true;
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
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

// ─── Safe response shapes ──────────────────────────────────────────

function safeSuccess(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: true,
    source: 'demoguard_mobile',
    status: 'submitted',
    ...data,
  };
}

function safeError(message: string): Record<string, unknown> {
  return {
    ok: false,
    source: 'demoguard_mobile',
    status: 'failed',
    message,
  };
}

// ─── Main handler ──────────────────────────────────────────────────

export default async function demoguardVerifyHandler(
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

  // ── Rate limit ──
  if (!checkRateLimit(ip)) {
    safeLog('warn', { msg: 'RATE_LIMITED', ip });
    res.status(429).json(safeError('Too many requests'));
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
  body.source = 'demoguard_mobile';
  body.tenant_id = getTenantId();

  // ── Safe log: voice_b64 presence (never log the value itself) ──
  const sensitive = body.sensitive as Record<string, unknown> | undefined;
  const voiceB64 = sensitive?.voice_b64 as string | undefined;
  const hasVoiceB64 = !!voiceB64;
  const voiceB64ByteLen = voiceB64 ? Math.round(voiceB64.length * 3 / 4) : 0;
  const audioSizeBucket = voiceB64
    ? (voiceB64ByteLen < 2048 ? 'small' : voiceB64ByteLen < 16384 ? 'medium' : 'large')
    : 'none';
  const voiceSignal = (body.demo_guard as Record<string, unknown>)?.signals as Record<string, unknown> | undefined;
  const voiceDurationMs = (voiceSignal?.voice as Record<string, unknown>)?.duration_ms as number | undefined;
  safeLog('info', {
    event: 'demoguard_voice_forward',
    voicePresent: hasVoiceB64,
    audioSizeBucket,
    durationMs: voiceDurationMs ?? null,
    mimeType: hasVoiceB64 ? 'audio/wav' : null,
    sessionPublicId: sessionId,
  });

  // ── Safe log: behavior signal presence (P10-FINAL) ──
  const behaviorData = voiceSignal?.behavior as Record<string, unknown> | undefined;
  const behaviorSummary = behaviorData?.summary as Record<string, unknown> | undefined;
  const touchDiagBehavior = voiceSignal?.touchDiagnosticsBehavior as Record<string, unknown> | undefined;
  safeLog('info', {
    event: 'demoguard_behavior_signal',
    behaviorPresent: !!behaviorData,
    behaviorTasksObserved: behaviorSummary?.tasksObserved ?? 0,
    behaviorTotalInteractions: behaviorSummary?.totalInteractions ?? 0,
    touchDiagBehaviorPresent: !!touchDiagBehavior,
    touchDiagStatus: touchDiagBehavior?.status ?? 'missing',
    sessionPublicId: sessionId,
  });

  // ── API key (server-side only) ──
  const apiKey = process.env.HV_API_KEY;
  if (!apiKey) {
    safeLog('error', { msg: 'CONFIG_ERROR', reason: 'HV_API_KEY not set' });
    res.status(500).json(safeError('Server misconfigured'));
    return;
  }

  // [DEBUG-AUDIO-VERCEL] Temporary diagnostic — remove before investor demo
  const relayBodyStr = JSON.stringify(body);
  console.log(JSON.stringify({
    event: '[DEBUG-AUDIO-VERCEL]',
    sessionPublicId: sessionId,
    payloadSizeBytes: relayBodyStr.length,
    voiceB64Length: voiceB64?.length ?? 0,
    voiceB64Present: hasVoiceB64,
    audioSizeBucket,
  }));

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
      msg: 'demoguard_proxy_ok',
      status: upstreamRes.status,
      durationMs,
      origin: origin || 'capacitor',
    });

    // ── Parse and sanitize upstream response ──
    let upstreamData: unknown;
    try {
      upstreamData = await upstreamRes.json();
    } catch {
      res.status(502).json(safeError('DemoGuard verification unavailable'));
      return;
    }

    const sanitized = sanitizeResponse(upstreamData);

    // ── Build safe response ──
    const safeResponse = typeof sanitized === 'object' && sanitized !== null
      ? safeSuccess(sanitized as Record<string, unknown>)
      : safeSuccess({});

    // Override source/ok to ensure consistency
    (safeResponse as Record<string, unknown>).source = 'demoguard_mobile';
    (safeResponse as Record<string, unknown>).ok = upstreamRes.ok;

    res.status(upstreamRes.status).json(safeResponse);
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    safeLog('error', {
      msg: isAbort ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      durationMs: Date.now() - startTime,
    });
    res.status(502).json(safeError('DemoGuard verification unavailable'));
  }
}
