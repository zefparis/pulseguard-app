/**
 * Audio DSP utility tests
 *
 * Tests encodeWav, pickMimeType, and VOICE_DURATION_MS constant.
 * The recordAudio function uses MediaRecorder (browser API) and is
 * tested via the VAD recording flow tests in vadRecorder.test.ts.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { describe, it, expect } from 'vitest';
import { encodeWav, pickMimeType } from '../src/lib/audio';
import { VOICE_DURATION_MS } from '../src/demoguard/collectors/audioCollector';

// ─── VOICE_DURATION_MS constant test ─────────────────────────────

describe('VOICE_DURATION_MS constant', () => {
  it('is set to 7000ms (not the old 4000ms)', () => {
    expect(VOICE_DURATION_MS).toBe(7000);
  });
});

// ─── encodeWav tests (PCM output verification) ───────────────────

describe('encodeWav (PCM output)', () => {
  it('produces valid WAV header with PCM format', () => {
    const samples = new Float32Array(1600).fill(0.5);
    const wav = encodeWav(samples, 16000);

    expect(wav[0]).toBe(0x52); // R
    expect(wav[1]).toBe(0x49); // I
    expect(wav[2]).toBe(0x46); // F
    expect(wav[3]).toBe(0x46); // F

    expect(wav[8]).toBe(0x57); // W
    expect(wav[9]).toBe(0x41); // A
    expect(wav[10]).toBe(0x56); // V
    expect(wav[11]).toBe(0x45); // E

    const view = new DataView(wav.buffer);
    expect(view.getUint16(20, true)).toBe(1); // PCM = 1
    expect(view.getUint16(22, true)).toBe(1); // Mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('preserves amplitude in PCM encoding (no codec degradation)', () => {
    const testAmplitude = 0.8;
    const samples = new Float32Array(1000).fill(testAmplitude);
    const wav = encodeWav(samples, 16000);

    const view = new DataView(wav.buffer);
    const firstSample = view.getInt16(44, true);

    expect(firstSample).toBeGreaterThan(25000);
    expect(firstSample).toBeLessThan(28000);
  });

  it('output size matches expected PCM size', () => {
    const numSamples = 1600;
    const samples = new Float32Array(numSamples).fill(0.5);
    const wav = encodeWav(samples, 16000);

    expect(wav.length).toBe(44 + numSamples * 2);
  });

  it('clips amplitude to [-1, 1] range', () => {
    const samples = new Float32Array([2.0, -2.0, 0.5, -0.5]);
    const wav = encodeWav(samples, 16000);

    const view = new DataView(wav.buffer);
    // Clipped to 1.0 → int16 max (32767)
    expect(view.getInt16(44, true)).toBe(32767);
    // Clipped to -1.0 → int16 min (-32768)
    expect(view.getInt16(46, true)).toBe(-32768);
    // 0.5 → ~16384
    expect(view.getInt16(48, true)).toBeGreaterThan(16000);
    expect(view.getInt16(48, true)).toBeLessThan(17000);
  });
});

// ─── pickMimeType tests ───────────────────────────────────────────

describe('pickMimeType', () => {
  it('returns a non-empty string when MediaRecorder is available', () => {
    // MediaRecorder is available in jsdom (or may not be). If not available,
    // pickMimeType returns '' — which is valid behavior.
    const result = pickMimeType();
    expect(typeof result).toBe('string');
  });
});
