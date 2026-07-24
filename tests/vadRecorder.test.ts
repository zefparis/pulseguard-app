/**
 * VAD Recorder tests — Real-time Voice Activity Detection
 *
 * Tests the VAD accumulator logic and recording flow:
 * - VAD accumulator correctly classifies voiced/unvoiced frames
 * - Recording stops early when voiced duration target is reached
 * - MAX_RECORDING_MS timeout when not enough voiced audio
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createVadAccumulator,
  VAD_ENERGY_THRESHOLD,
  MIN_VOICED_DURATION_MS,
  MAX_RECORDING_MS,
  WARMUP_MIN_VOICE_MS,
  WARMUP_MAX_MS,
} from '../src/lib/vadRecorder';

// ─── VAD Accumulator (pure logic, no browser APIs) ─────────────────

describe('VAD Accumulator', () => {
  it('classifies frames above threshold as voiced', () => {
    const vad = createVadAccumulator(0.015);
    const r1 = vad.processFrame(1.0, 10);
    expect(r1.maxEnergy).toBe(1.0);
    expect(r1.voiced).toBe(true);
    expect(r1.voicedDurationMs).toBe(10);
  });

  it('classifies silent frames as unvoiced', () => {
    const vad = createVadAccumulator(0.015);
    vad.processFrame(1.0, 10);
    const r = vad.processFrame(0.0001, 10);
    expect(r.voiced).toBe(false);
    expect(r.voicedDurationMs).toBe(10);
  });

  it('accumulates voiced duration across multiple voiced frames', () => {
    const vad = createVadAccumulator(0.015);
    const frameMs = 2.67;
    for (let i = 0; i < 100; i++) {
      vad.processFrame(0.5, frameMs);
    }
    expect(vad.getVoicedDurationMs()).toBeCloseTo(267, 0);
  });

  it('does not accumulate duration for unvoiced frames', () => {
    const vad = createVadAccumulator(0.015);
    vad.processFrame(1.0, 10);
    vad.processFrame(0.00001, 10);
    vad.processFrame(0.00001, 10);
    expect(vad.getVoicedDurationMs()).toBe(10);
  });

  it('updates max energy as louder frames arrive', () => {
    const vad = createVadAccumulator(0.015);
    vad.processFrame(0.5, 10);
    expect(vad.getMaxEnergy()).toBe(0.5);
    vad.processFrame(2.0, 10);
    expect(vad.getMaxEnergy()).toBe(2.0);
    const r = vad.processFrame(0.5, 10);
    expect(r.voiced).toBe(true);
  });

  it('reaches MIN_VOICED_DURATION_MS after enough voiced frames', () => {
    const vad = createVadAccumulator(0.015);
    const frameMs = 10;
    const framesNeeded = Math.ceil(MIN_VOICED_DURATION_MS / frameMs);
    for (let i = 0; i < framesNeeded; i++) {
      vad.processFrame(0.8, frameMs);
    }
    expect(vad.getVoicedDurationMs()).toBeGreaterThanOrEqual(MIN_VOICED_DURATION_MS);
  });

  it('does not reach MIN_VOICED_DURATION_MS with only silence', () => {
    const vad = createVadAccumulator(0.015);
    // Use true 0.0 — with relative normalization, any uniform non-zero energy
    // normalizes to 1.0 (100% of maxEnergy) and would pass the threshold.
    // Only true silence (0.0) correctly stays below threshold after normalization.
    for (let i = 0; i < 1200; i++) {
      vad.processFrame(0.0, 10);
    }
    expect(vad.getVoicedDurationMs()).toBe(0);
  });

  it('handles mixed voiced/silent frames correctly', () => {
    const vad = createVadAccumulator(0.015);
    for (let i = 0; i < 50; i++) vad.processFrame(0.7, 10);
    for (let i = 0; i < 100; i++) vad.processFrame(0.0, 10);
    for (let i = 0; i < 250; i++) vad.processFrame(0.7, 10);
    expect(vad.getVoicedDurationMs()).toBe(3000);
  });

  it('classifies low-amplitude voice as voiced with relative normalization', () => {
    // Simulates a mobile mic with low gain: background noise energy ~0.0001,
    // voice energy ~0.0025. With absolute threshold 0.015, voice (0.0025 < 0.015)
    // would be classified as silence — causing false 12s timeouts.
    // With relative normalization, 0.0025/0.0025 = 1.0 > 0.015 → voiced.
    const vad = createVadAccumulator(0.015);

    // Background noise frames (low energy, below absolute threshold)
    for (let i = 0; i < 20; i++) {
      const r = vad.processFrame(0.0001, 10);
      expect(r.voiced).toBe(true); // 0.0001/0.0001 = 1.0 > 0.015 (only frame so far)
    }

    // Voice frames (higher energy, but still below absolute 0.015)
    // maxEnergy updates to 0.0025, now noise frames would be 0.0001/0.0025 = 0.04
    for (let i = 0; i < 100; i++) {
      const r = vad.processFrame(0.0025, 10);
      expect(r.voiced).toBe(true); // 0.0025/0.0025 = 1.0 > 0.015
    }
    expect(vad.getVoicedDurationMs()).toBe(1200); // 20 + 100 frames × 10ms

    // Noise after voice peak: 0.0001/0.0025 = 0.04 > 0.015 → still voiced
    // This is expected: relative threshold can't distinguish post-voice noise
    // from voice if noise is > 1.5% of peak. This matches backend behavior.
    const r = vad.processFrame(0.0001, 10);
    expect(r.voiced).toBe(true);
  });

  it('would fail with absolute threshold but passes with relative threshold', () => {
    // Demonstrates the bug that was fixed: absolute threshold rejects
    // low-gain mobile audio that the backend (relative) would accept.
    const vad = createVadAccumulator(0.015);
    // Voice energy 0.002 — well below absolute 0.015
    const r = vad.processFrame(0.002, 10);
    // With relative: 0.002/0.002 = 1.0 > 0.015 → voiced
    expect(r.voiced).toBe(true);
    // If this were absolute: 0.002 < 0.015 → would be false (the bug)
  });
});

// ─── Constants ─────────────────────────────────────────────────────

describe('VAD constants', () => {
  it('VAD_ENERGY_THRESHOLD is 0.015', () => {
    expect(VAD_ENERGY_THRESHOLD).toBe(0.015);
  });

  it('MIN_VOICED_DURATION_MS is 3000 (aligned with backend)', () => {
    expect(MIN_VOICED_DURATION_MS).toBe(3000);
  });

  it('MAX_RECORDING_MS is 12000 (safety cap)', () => {
    expect(MAX_RECORDING_MS).toBe(12000);
  });
});

// ─── Simulated recording flow (mocks browser APIs) ─────────────────

describe('VAD recording flow simulation', () => {
  let originalMediaDevices: PropertyDescriptor | undefined;
  let originalAudioContext: typeof window.AudioContext | undefined;
  let originalBlobArrayBuffer: typeof Blob.prototype.arrayBuffer | undefined;

  beforeEach(() => {
    originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    originalAudioContext = window.AudioContext;
    // Polyfill Blob.arrayBuffer for jsdom (not implemented in older versions)
    if (!Blob.prototype.arrayBuffer) {
      originalBlobArrayBuffer = undefined;
      Blob.prototype.arrayBuffer = async function (): Promise<ArrayBuffer> {
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
          reader.readAsArrayBuffer(this);
        });
      };
    } else {
      originalBlobArrayBuffer = Blob.prototype.arrayBuffer;
    }
  });

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    } else {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
    if (originalAudioContext) {
      window.AudioContext = originalAudioContext;
    }
    if (originalBlobArrayBuffer !== undefined) {
      Blob.prototype.arrayBuffer = originalBlobArrayBuffer;
    } else {
      delete (Blob.prototype as unknown as Record<string, unknown>).arrayBuffer;
    }
    vi.restoreAllMocks();
  });

  function createMockStream() {
    const track = {
      stop: vi.fn(),
      muted: false,
      readyState: 'live' as string,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    return {
      getTracks: vi.fn(() => [track]),
      getAudioTracks: vi.fn(() => [track]),
    };
  }

  function createMockAnalyser(fillValue: number) {
    return {
      fftSize: 1024,
      getFloatTimeDomainData: vi.fn((arr: Float32Array) => {
        arr.fill(fillValue);
      }),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  function createMockAudioContext(analyser: ReturnType<typeof createMockAnalyser>) {
    const mockGain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
    const mockSource = { connect: vi.fn(), disconnect: vi.fn() };
    return {
      sampleRate: 48000,
      state: 'running' as string,
      destination: {},
      createMediaStreamSource: vi.fn(() => mockSource),
      createAnalyser: vi.fn(() => analyser),
      createGain: vi.fn(() => mockGain),
      close: vi.fn(() => Promise.resolve()),
      resume: vi.fn(() => Promise.resolve()),
      audioWorklet: { addModule: vi.fn().mockRejectedValue(new Error('not available')) },
    };
  }

  function createMockRecorder() {
    const recorder = {
      state: 'recording' as 'recording' | 'inactive',
      start: vi.fn(function (this: { state: 'recording' | 'inactive' }) {
        // Reset state so retry attempts can record again with the same mock
        this.state = 'recording';
      }),
      stop: vi.fn(function (this: { state: string; onstop: (() => void) | null; ondataavailable: ((e: { data: Blob }) => void) | null }) {
        // Fire ondataavailable with a real Blob so blob.arrayBuffer() works and blob.size > 0
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['dummy-audio'], { type: 'audio/webm' }) });
        }
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }),
      ondataavailable: null as ((e: { data: Blob }) => void) | null,
      onstop: null as (() => void) | null,
    };
    return recorder;
  }

  function setupMediaRecorderMock(recorder: ReturnType<typeof createMockRecorder>) {
    const MockMR = vi.fn(() => recorder) as unknown as {
      new (): typeof recorder;
      isTypeSupported: ReturnType<typeof vi.fn>;
    };
    MockMR.isTypeSupported = vi.fn(() => true);
    const originalMR = (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = MockMR;
    return originalMR;
  }

  function restoreMediaRecorder(originalMR: unknown) {
    if (originalMR) {
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = originalMR;
    } else {
      delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    }
  }

  it('stops before MAX_RECORDING_MS when voiced duration reached early', async () => {
    const mockStream = createMockStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => Promise.resolve(mockStream)) },
      configurable: true,
      writable: true,
    });

    const mockAnalyser = createMockAnalyser(0.5);
    const mockCtx = createMockAudioContext(mockAnalyser);
    window.AudioContext = vi.fn(() => mockCtx) as unknown as typeof window.AudioContext;

    const mockRecorder = createMockRecorder();
    const originalMR = setupMediaRecorderMock(mockRecorder);

    vi.useFakeTimers();

    const { recordAudioWithVad } = await import('../src/lib/vadRecorder');
    const recordPromise = recordAudioWithVad({ minVoicedDurationMs: 1000, maxRecordingMs: 5000 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await recordPromise;

    expect(result.timeout).toBe(false);
    expect(result.voicedDurationMs).toBeGreaterThan(0);
    expect(result.totalDurationMs).toBeLessThan(5000);

    vi.useRealTimers();
    restoreMediaRecorder(originalMR);
  });

  it('returns voiced_duration_timeout when MAX_RECORDING_MS reached with silence', async () => {
    const mockStream = createMockStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => Promise.resolve(mockStream)) },
      configurable: true,
      writable: true,
    });

    const mockAnalyser = createMockAnalyser(0.0);
    const mockCtx = createMockAudioContext(mockAnalyser);
    window.AudioContext = vi.fn(() => mockCtx) as unknown as typeof window.AudioContext;

    const mockRecorder = createMockRecorder();
    const originalMR = setupMediaRecorderMock(mockRecorder);

    // Use real timers with small maxRecordingMs to avoid fake timer issues
    // with async cleanup chain (audioCtx.close(), etc.)
    const { recordAudioWithVad } = await import('../src/lib/vadRecorder');
    const result = await recordAudioWithVad({ minVoicedDurationMs: 3000, maxRecordingMs: 500 });

    expect(result.timeout).toBe(true);
    expect(result.voicedDurationMs).toBe(0);

    restoreMediaRecorder(originalMR);
  }, 10000);

  // ─── Post-encode VAD validation tests ─────────────────────────────

  /**
   * Helper: create a mock AudioBuffer with controllable energy level.
   * When voiced=true, fills with high-energy samples (0.5).
   * When voiced=false, fills with near-zero samples (0.0001).
   */
  function createMockAudioBuffer(voiced: boolean, length = 48000 * 5) {
    // Use 0.0 for silence (not 0.0001) — after normalization 0/maxEnergy=0 < threshold
    // Use 0.5 for voiced — after normalization 0.25/0.25=1.0 > threshold
    const fillValue = voiced ? 0.5 : 0.0;
    const samples = new Float32Array(length);
    samples.fill(fillValue);
    return {
      getChannelData: vi.fn(() => samples),
      sampleRate: 48000,
      duration: length / 48000,
    };
  }

  it('triggers automatic retry when live VAD passes but post-encode VAD is insufficient', async () => {
    const mockStream = createMockStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => Promise.resolve(mockStream)) },
      configurable: true,
      writable: true,
    });

    // Live analyser returns high energy → live VAD will pass
    const mockAnalyser = createMockAnalyser(0.5);
    const mockCtx = createMockAudioContext(mockAnalyser);
    // decodeAudioData returns a silent buffer (simulating lossy compression killing voiced segments)
    const mockAudioBuffer = createMockAudioBuffer(false);
    (mockCtx as unknown as { decodeAudioData: unknown }).decodeAudioData = vi.fn(() => Promise.resolve(mockAudioBuffer));
    window.AudioContext = vi.fn(() => mockCtx) as unknown as typeof window.AudioContext;

    const mockRecorder = createMockRecorder();
    const originalMR = setupMediaRecorderMock(mockRecorder);

    vi.useFakeTimers();

    const { recordAudioWithVad } = await import('../src/lib/vadRecorder');
    const recordPromise = recordAudioWithVad({ minVoicedDurationMs: 1000, maxRecordingMs: 5000 });

    // Advance through first attempt's live VAD accumulation
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(2000);
    // First attempt completes, post-encode validation runs, retry starts
    // Advance through second attempt's live VAD accumulation
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await recordPromise;

    // Retry should have been triggered
    expect(result.postEncodeRetry).toBe(true);
    // Post-encode voiced duration should be 0 (silent mock buffer)
    expect(result.postEncodeVoicedDurationMs).toBe(0);
    // Fail-closed: both attempts had insufficient post-encode → timeout
    expect(result.timeout).toBe(true);

    vi.useRealTimers();
    restoreMediaRecorder(originalMR);
  });

  it('accepts recording when post-encode VAD is sufficient after retry', async () => {
    const mockStream = createMockStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => Promise.resolve(mockStream)) },
      configurable: true,
      writable: true,
    });

    const mockAnalyser = createMockAnalyser(0.5);
    const mockCtx = createMockAudioContext(mockAnalyser);

    // First decodeAudioData call returns silent (compression killed voice)
    // Second call returns voiced (retry's blob decodes properly)
    const silentBuffer = createMockAudioBuffer(false);
    const voicedBuffer = createMockAudioBuffer(true);
    let decodeCallCount = 0;
    (mockCtx as unknown as { decodeAudioData: unknown }).decodeAudioData = vi.fn(() => {
      decodeCallCount++;
      return Promise.resolve(decodeCallCount === 1 ? silentBuffer : voicedBuffer);
    });
    window.AudioContext = vi.fn(() => mockCtx) as unknown as typeof window.AudioContext;

    const mockRecorder = createMockRecorder();
    const originalMR = setupMediaRecorderMock(mockRecorder);

    vi.useFakeTimers();

    const { recordAudioWithVad } = await import('../src/lib/vadRecorder');
    const recordPromise = recordAudioWithVad({ minVoicedDurationMs: 1000, maxRecordingMs: 5000 });

    // First attempt
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(2000);
    // Retry attempt
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await recordPromise;

    expect(result.postEncodeRetry).toBe(true);
    // Retry's post-encode VAD should be sufficient (voiced buffer)
    expect(result.postEncodeVoicedDurationMs).toBeGreaterThan(0);
    expect(result.timeout).toBe(false);

    vi.useRealTimers();
    restoreMediaRecorder(originalMR);
  });
});

// ─── Warm-up phase tests ───────────────────────────────────────────

describe('Warm-up constants', () => {
  it('WARMUP_MIN_VOICE_MS is 500 (mic-is-alive confirmation)', () => {
    expect(WARMUP_MIN_VOICE_MS).toBe(500);
  });

  it('WARMUP_MAX_MS is 6000 (safety cap, never blocks indefinitely)', () => {
    expect(WARMUP_MAX_MS).toBe(6000);
  });
});

describe('VAD Accumulator — warm-up calibration', () => {
  it('initializes maxEnergy from initialMaxEnergy when provided', () => {
    const vad = createVadAccumulator(0.015, 0.05);
    // First frame: energy 0.003 / maxEnergy 0.05 = 0.06 > 0.015 → voiced
    const r = vad.processFrame(0.003, 10);
    expect(r.voiced).toBe(true);
    expect(r.maxEnergy).toBe(0.05); // maxEnergy unchanged (0.003 < 0.05)
  });

  it('without initialMaxEnergy, starts from near-zero (cold start)', () => {
    const vad = createVadAccumulator(0.015);
    // First frame: any non-zero energy / 1e-10 >> threshold → voiced (cold start behavior)
    const r = vad.processFrame(0.0001, 10);
    expect(r.voiced).toBe(true);
    expect(r.maxEnergy).toBe(0.0001);
  });

  it('initialMaxEnergy=0 falls back to default 1e-10 (no division by zero)', () => {
    const vad = createVadAccumulator(0.015, 0);
    const r = vad.processFrame(0.001, 10);
    expect(r.voiced).toBe(true);
    expect(r.maxEnergy).toBe(0.001);
  });

  it('initialMaxEnergy negative falls back to default 1e-10', () => {
    const vad = createVadAccumulator(0.015, -1);
    const r = vad.processFrame(0.001, 10);
    expect(r.voiced).toBe(true);
    expect(r.maxEnergy).toBe(0.001);
  });

  it('resetVoicedDuration resets duration but preserves maxEnergy', () => {
    const vad = createVadAccumulator(0.015);
    for (let i = 0; i < 50; i++) vad.processFrame(0.8, 10);
    expect(vad.getVoicedDurationMs()).toBe(500);
    expect(vad.getMaxEnergy()).toBe(0.8);

    vad.resetVoicedDuration();
    expect(vad.getVoicedDurationMs()).toBe(0);
    expect(vad.getMaxEnergy()).toBe(0.8);
  });

  it('resetMaxEnergy resets maxEnergy to cold-start default', () => {
    const vad = createVadAccumulator(0.015);
    for (let i = 0; i < 50; i++) vad.processFrame(0.8, 10);
    expect(vad.getMaxEnergy()).toBe(0.8);

    vad.resetMaxEnergy();
    expect(vad.getMaxEnergy()).toBe(1e-10);
  });

  // ── Regression test: warm-up maxEnergy must NOT carry over to Phase 2 ──
  // This tests the exact bug that was reported: warm-up phrase spoken louder
  // than RAN digits → high maxEnergy → relative threshold too strict →
  // voicedDurationMs drops from ~4000ms to ~1780ms.
  it('warm-up maxEnergy carried over causes over-strict VAD (the regression)', () => {
    // Simulate warm-up: user says "Bonjour" loudly, maxEnergy = 0.3
    const warmupVad = createVadAccumulator(0.015);
    for (let i = 0; i < 50; i++) warmupVad.processFrame(0.3, 10);
    const warmupMaxEnergy = warmupVad.getMaxEnergy(); // 0.3

    // BUG: Phase 2 VAD starts with warm-up maxEnergy as initialMaxEnergy
    const buggyPhase2Vad = createVadAccumulator(0.015, warmupMaxEnergy);

    // User reads digits more quietly: energy 0.005
    // 0.005 / 0.3 = 0.017 > 0.015 → voiced (barely passes)
    // But quieter parts at 0.004: 0.004 / 0.3 = 0.013 < 0.015 → unvoiced (WRONG!)
    const buggyQuiet = buggyPhase2Vad.processFrame(0.004, 10);
    expect(buggyQuiet.voiced).toBe(false); // This is the regression!

    // FIX: Phase 2 VAD starts with cold-start maxEnergy (resetMaxEnergy)
    const fixedPhase2Vad = createVadAccumulator(0.015);
    // First frame at 0.005: 0.005 / 1e-10 >> 0.015 → voiced, maxEnergy becomes 0.005
    fixedPhase2Vad.processFrame(0.005, 10);
    // Now quieter frame at 0.004: 0.004 / 0.005 = 0.8 > 0.015 → voiced (correct!)
    const fixedQuiet = fixedPhase2Vad.processFrame(0.004, 10);
    expect(fixedQuiet.voiced).toBe(true); // Fixed!
  });

  it('Phase 2 with resetMaxEnergy behaves identically to no-warm-up pipeline', () => {
    // Simulate the full warm-up → reset → Phase 2 flow
    const vad = createVadAccumulator(0.015);

    // Warm-up: loud phrase
    for (let i = 0; i < 50; i++) vad.processFrame(0.3, 10);
    expect(vad.getMaxEnergy()).toBe(0.3);

    // Phase 1 → Phase 2 transition
    vad.resetVoicedDuration();
    vad.resetMaxEnergy();

    expect(vad.getVoicedDurationMs()).toBe(0);
    expect(vad.getMaxEnergy()).toBe(1e-10);

    // Phase 2: quieter digits — should classify same as cold-start VAD
    const coldVad = createVadAccumulator(0.015);
    for (let i = 0; i < 100; i++) {
      const energy = 0.05 + Math.sin(i * 0.3) * 0.02; // varying voice energy
      const r1 = vad.processFrame(energy, 10);
      const r2 = coldVad.processFrame(energy, 10);
      expect(r1.voiced).toBe(r2.voiced); // Identical classification
    }
    expect(vad.getVoicedDurationMs()).toBe(coldVad.getVoicedDurationMs());
  });
});
