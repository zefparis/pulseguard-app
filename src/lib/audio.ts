// ─── DSP Utilities ──────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

function hamming(N: number): Float32Array {
  const w = new Float32Array(N)
  for (let n = 0; n < N; n += 1) {
    w[n] = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1))
  }
  return w
}

function dctII(vector: Float32Array, numCoeffs: number): Float32Array {
  const N = vector.length
  const out = new Float32Array(numCoeffs)
  for (let k = 0; k < numCoeffs; k += 1) {
    let sum = 0
    for (let n = 0; n < N; n += 1) {
      sum += vector[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N))
    }
    out[k] = sum
  }
  return out
}

function createMelFilterbank(
  sampleRate: number,
  fftSize: number,
  numFilters: number,
  fMin = 20,
  fMax = 8000,
): Float32Array[] {
  const nyquist = sampleRate / 2
  const maxHz = Math.min(fMax, nyquist)

  const melMin = hzToMel(fMin)
  const melMax = hzToMel(maxHz)
  const melPoints: number[] = []
  for (let i = 0; i < numFilters + 2; i += 1) {
    melPoints.push(melMin + (i / (numFilters + 1)) * (melMax - melMin))
  }
  const hzPoints = melPoints.map(m => melToHz(m))
  const binPoints = hzPoints.map(hz => Math.floor(((fftSize + 1) * hz) / sampleRate))

  const filters: Float32Array[] = []
  const numBins = Math.floor(fftSize / 2) + 1

  for (let m = 1; m <= numFilters; m += 1) {
    const f = new Float32Array(numBins)
    const left = binPoints[m - 1]
    const center = binPoints[m]
    const right = binPoints[m + 1]

    for (let k = left; k < center; k += 1) {
      if (k >= 0 && k < numBins) f[k] = (k - left) / Math.max(1, center - left)
    }
    for (let k = center; k < right; k += 1) {
      if (k >= 0 && k < numBins) f[k] = (right - k) / Math.max(1, right - center)
    }
    filters.push(f)
  }
  return filters
}

function spectrumFromFrame(frame: Float32Array, fftSize: number): Float32Array {
  const numBins = Math.floor(fftSize / 2) + 1
  const out = new Float32Array(numBins)
  for (let k = 0; k < numBins; k += 1) {
    let re = 0
    let im = 0
    const w = (2 * Math.PI * k) / fftSize
    for (let n = 0; n < fftSize; n += 1) {
      const x = frame[n]
      re += x * Math.cos(w * n)
      im -= x * Math.sin(w * n)
    }
    out[k] = Math.sqrt(re * re + im * im)
  }
  return out
}

function extractMFCC(audioData: Float32Array, sampleRate: number): Float32Array {
  const winSize = Math.floor(sampleRate * 0.025)
  const hopSize = Math.floor(sampleRate * 0.01)
  const fftSize = 1 << Math.ceil(Math.log2(winSize))
  const numMfcc = 40
  const numFilters = 40

  const windowFn = hamming(winSize)
  const filters = createMelFilterbank(sampleRate, fftSize, numFilters)

  const frames: Float32Array[] = []
  for (let start = 0; start + winSize <= audioData.length; start += hopSize) {
    const frame = new Float32Array(fftSize)
    for (let i = 0; i < winSize; i += 1) frame[i] = audioData[start + i] * windowFn[i]
    frames.push(frame)
  }

  if (frames.length === 0) return new Float32Array(192)

  const mfccSum = new Float32Array(numMfcc)
  for (const frame of frames) {
    const spectrum = spectrumFromFrame(frame, fftSize)
    const melEnergies = new Float32Array(numFilters)

    for (let m = 0; m < numFilters; m += 1) {
      let e = 0
      const f = filters[m]
      for (let k = 0; k < spectrum.length; k += 1) e += (spectrum[k] ** 2) * f[k]
      melEnergies[m] = Math.log(1e-10 + e)
    }

    const mfcc = dctII(melEnergies, numMfcc)
    for (let i = 0; i < numMfcc; i += 1) mfccSum[i] += mfcc[i]
  }

  for (let i = 0; i < numMfcc; i += 1) mfccSum[i] /= frames.length

  const targetDim = 192
  const emb = new Float32Array(targetDim)
  let offset = 0
  while (offset < targetDim) {
    const take = Math.min(numMfcc, targetDim - offset)
    emb.set(mfccSum.subarray(0, take), offset)
    offset += take
  }

  let norm = 0
  for (let i = 0; i < emb.length; i += 1) norm += emb[i] * emb[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < emb.length; i += 1) emb[i] /= norm

  return emb
}

// ─── WAV encoder (16-bit PCM) ──────────────────────────────────────────────

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

// ─── Public API ─────────────────────────────────────────────────────────────

const TARGET_SR = 16000

export interface AudioRecordingResult {
  samples: Float32Array[];
  recorderState: 'inactive' | 'recording' | 'paused' | 'unknown';
  chunksCount: number;
  interrupted: boolean;
  interruptReason?: string;
  blob: Blob | null;
  mimeType: string;
  debug: {
    pickedMimeType: string;
    recorderStateAtStop: string;
    trackMuted: boolean;
    trackReadyState: string;
  };
}

const AUDIO_DEBUG = (() => {
  try { return localStorage.getItem('DEMOGUARD_AUDIO_DEBUG') === 'true'; } catch { return false; }
})();

const dbgLog = (...args: unknown[]) => { if (AUDIO_DEBUG) console.log('[DEBUG-AUDIO]', ...args); };

export function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export async function recordAudio(durationMs: number): Promise<AudioRecordingResult> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];

  // ── T2: MediaStreamTrack readyState monitoring ─────────────────────
  const recordStart = performance.now();
  let audioInterrupted = false;
  let interruptReason = '';
  const track = stream.getAudioTracks()[0];
  const onTrackEnded = () => {
    const elapsed = Math.round(performance.now() - recordStart);
    audioInterrupted = true;
    interruptReason = 'track_ended_prematurely';
    dbgLog(`track ended at ${elapsed}ms`);
  };
  if (track) track.addEventListener('ended', onTrackEnded);

  // ── T3: visibilitychange monitoring during recording ───────────────
  const onVisibilityChange = () => {
    if (document.hidden) {
      const elapsed = Math.round(performance.now() - recordStart);
      audioInterrupted = true;
      interruptReason = 'page_visibility_hidden';
      dbgLog(`visibilitychange: document.hidden at ${elapsed}ms`);
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Attach listeners BEFORE start() to avoid losing data
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  dbgLog(`recordAudio: recorder starting, mimeType=${mimeType}`);

  // Build blob inside onstop handler to guarantee all dataavailable chunks are collected
  let blob: Blob | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      resolve();
    };
  });

  // Use timeslice (250ms) for periodic dataavailable events — critical on Chrome Android
  // where without timeslice, dataavailable only fires at stop()
  recorder.start(250);

  await new Promise<void>(resolve => setTimeout(resolve, durationMs));

  const recorderStateAtStop = recorder.state;
  const trackMuted = track ? track.muted : false;
  const trackReadyState = track ? track.readyState : 'unknown';

  if (recorder.state === 'recording') {
    recorder.stop();
  }

  // Wait for onstop to fire and blob to be assembled
  if (recorder.state === 'inactive') {
    blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
  } else {
    await stopPromise;
  }

  // ── Cleanup all listeners ──────────────────────────────────────────
  if (track) track.removeEventListener('ended', onTrackEnded);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  stream.getTracks().forEach(t => t.stop());

  const actualMimeType = blob?.type || mimeType || 'audio/webm';

  dbgLog(`recordAudio: chunks=${chunks.length}, recorderState=${recorderStateAtStop}, trackMuted=${trackMuted}, trackReadyState=${trackReadyState}, mimeType=${actualMimeType}, blobSize=${blob?.size ?? 0}, interrupted=${audioInterrupted}, interruptReason=${interruptReason || 'none'}`);

  return {
    samples: [],
    recorderState: 'inactive',
    chunksCount: chunks.length,
    interrupted: audioInterrupted,
    interruptReason: interruptReason || undefined,
    blob,
    mimeType: actualMimeType,
    debug: {
      pickedMimeType: mimeType,
      recorderStateAtStop,
      trackMuted,
      trackReadyState,
    },
  };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

export async function computeBlobRmsAndDuration(blob: Blob): Promise<{ rms: number; durationMs: number; ok: boolean }> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* ignore */ }
  }
  const arrayBuffer = await blob.arrayBuffer();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (decodeErr) {
    await ctx.close();
    throw new Error('audio_decode_failed');
  }
  await ctx.close();

  const channelData = audioBuffer.getChannelData(0);
  let sumSq = 0;
  for (let i = 0; i < channelData.length; i++) sumSq += channelData[i] * channelData[i];
  const rms = Math.sqrt(sumSq / (channelData.length || 1));
  const durationMs = Math.round(audioBuffer.duration * 1000);

  return { rms, durationMs, ok: rms > 0.01 && durationMs >= 2000 };
}

export function computeVocalEmbedding(samples: Float32Array[]): number[] {
  if (samples.length === 0) return Array(192).fill(0)

  // Concatenate all samples
  const totalLen = samples.reduce((s, a) => s + a.length, 0)
  const concat = new Float32Array(totalLen)
  let off = 0
  for (const s of samples) {
    concat.set(s, off)
    off += s.length
  }

  const emb = extractMFCC(concat, TARGET_SR)
  return Array.from(emb)
}

// Re-export clamp01 for potential external use
export { clamp01 }
