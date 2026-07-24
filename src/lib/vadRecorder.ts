/**
 * VAD Recorder — Real-time Voice Activity Detection during recording
 *
 * Uses AudioWorklet (with AnalyserNode fallback) to run energy-based VAD
 * on the normalized signal during recording. Stops when cumulative voiced
 * duration reaches MIN_VOICED_DURATION_MS, with MAX_RECORDING_MS safety cap.
 *
 * VAD thresholds are centralized in vad-thresholds.ts (P10-FINAL reference).
 * See vad-thresholds.ts for cross-repo synchronization requirements.
 *
 * The client NEVER computes a liveness score — VAD only controls WHEN to
 * stop recording. Confidence decision remains 100% on HCS backend.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { pickMimeType } from './audio';
import { VAD_ENERGY_THRESHOLD as _VAD_THRESHOLD, MIN_VOICED_DURATION_MS, MAX_RECORDING_MS } from './vad-thresholds';

export { MIN_VOICED_DURATION_MS, MAX_RECORDING_MS };
export const VAD_ENERGY_THRESHOLD = _VAD_THRESHOLD;

/**
 * Warm-up phase constants (Phase 1 — mic initialization + calibration).
 *
 * WARMUP_MIN_VOICE_MS: Minimum cumulative voiced duration (ms) during warm-up
 *   to confirm the microphone is capturing voice. Uses the same relative VAD
 *   threshold as Phase 2 — this is NOT a liveness decision, just a "mic is alive"
 *   confirmation. 500ms is enough to distinguish voice from brief noise spikes.
 *
 * WARMUP_MAX_MS: Safety cap for the warm-up phase. If the user doesn't speak
 *   within this window, we proceed to Phase 2 anyway — the VAD will use whatever
 *   maxEnergy was accumulated (noise floor), and the relative threshold will
 *   self-correct when the user speaks louder in Phase 2. This ensures the
 *   warm-up never blocks the user indefinitely.
 */
export const WARMUP_MIN_VOICE_MS = 500;
export const WARMUP_MAX_MS = 6000;

const VAD_PROCESSOR_CODE = `
class VadProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      const samples = input[0];
      let sumSq = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSq += samples[i] * samples[i];
      }
      const energy = sumSq / samples.length;
      this.port.postMessage({ energy, frameSize: samples.length });
    }
    return true;
  }
}
registerProcessor('vad-processor', VadProcessor);
`;

/**
 * VAD accumulator — classifies audio frames as voiced/unvoiced using relative
 * energy normalization (energy / running maxEnergy > threshold).
 *
 * @param threshold Relative energy threshold (fraction of maxEnergy). Default: VAD_ENERGY_THRESHOLD (0.015).
 * @param initialMaxEnergy Optional pre-calibrated maxEnergy. Currently unused
 *   in the warm-up flow (see resetMaxEnergy below for the rationale).
 */
export function createVadAccumulator(threshold: number = VAD_ENERGY_THRESHOLD, initialMaxEnergy?: number) {
  let voicedDurationMs = 0;
  let maxEnergy = initialMaxEnergy && initialMaxEnergy > 0 ? initialMaxEnergy : 1e-10;

  return {
    processFrame(energy: number, frameDurationMs: number) {
      if (energy > maxEnergy) maxEnergy = energy;
      // Relative normalization: compare energy/maxEnergy to threshold,
      // matching the semantics of post-encode VAD and backend extractVoiceSegments.
      // VAD_ENERGY_THRESHOLD is a RELATIVE threshold (fraction of maxEnergy),
      // not an absolute energy level.
      const normalizedEnergy = energy / (maxEnergy || 1e-10);
      const voiced = normalizedEnergy > threshold;
      if (voiced) voicedDurationMs += frameDurationMs;
      return { voiced, voicedDurationMs, maxEnergy };
    },
    getVoicedDurationMs: () => voicedDurationMs,
    getMaxEnergy: () => maxEnergy,
    /**
     * Resets voiced duration counter to 0 while preserving maxEnergy.
     */
    resetVoicedDuration: () => { voicedDurationMs = 0; },
    /**
     * Resets maxEnergy to the cold-start default (1e-10).
     *
     * This is called at the Phase 1 → Phase 2 transition to ensure the
     * warm-up's maxEnergy does NOT carry over as a ceiling for Phase 2's
     * VAD classification.
     *
     * Rationale: The warm-up phrase ("Bonjour, je suis prêt") is typically
     * spoken with different energy/proximity than the RAN challenge digits.
     * If the warm-up maxEnergy is higher than the Phase 2 energy, it makes
     * the relative threshold (energy / maxEnergy > 0.015) artificially strict,
     * causing legitimate voiced frames to be classified as unvoiced. This
     * produces lower voicedDurationMs and fewer segments than the pre-warm-up
     * pipeline — a regression.
     *
     * By resetting maxEnergy to cold-start, Phase 2's VAD behaves identically
     * to the original pipeline without warm-up. The warm-up phase still
     * provides value through microphone initialization and AudioContext.resume(),
     * but VAD calibration is deferred to Phase 2's own frame processing.
     */
    resetMaxEnergy: () => { maxEnergy = 1e-10; },
  };
}

export type VadMode = 'audioworklet' | 'analyser' | 'none';

export interface VadRecordingResult {
  blob: Blob | null;
  mimeType: string;
  voicedDurationMs: number;
  totalDurationMs: number;
  interrupted: boolean;
  interruptReason?: string;
  timeout: boolean;
  chunksCount: number;
  postEncodeVoicedDurationMs: number | null;
  postEncodeRetry: boolean;
  debug: {
    pickedMimeType: string;
    recorderStateAtStop: string;
    trackMuted: boolean;
    trackReadyState: string;
    vadMode: VadMode;
    maxEnergy: number;
    warmupMaxEnergy?: number;
    warmupDurationMs?: number;
  };
}

/**
 * Post-encode VAD validation: decode the final blob and measure voiced duration
 * on the decoded signal, using the same energy threshold as the live VAD.
 *
 * This catches cases where lossy compression (WebM/Opus) reduces low-energy
 * voiced segments below the threshold, causing the backend to measure less
 * voiced duration than the client's live VAD did.
 *
 * Returns null if decoding fails.
 */
async function measureVoicedDurationFromBlob(
  blob: Blob,
  energyThreshold: number,
): Promise<number | null> {
  try {
    const AudioCtx = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    await ctx.close();

    const samples = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const frameSize = Math.floor(sampleRate * 0.025); // 25ms frames
    const hopSize = Math.floor(sampleRate * 0.010);   // 10ms hop

    const energies: number[] = [];
    for (let i = 0; i < samples.length - frameSize; i += hopSize) {
      let sumSq = 0;
      for (let j = i; j < i + frameSize; j++) {
        sumSq += samples[j] * samples[j];
      }
      energies.push(sumSq / frameSize);
    }

    if (energies.length === 0) return 0;

    const maxEnergy = Math.max(...energies);
    const normalizedEnergies = energies.map(e => e / (maxEnergy || 1));

    let voicedDurationMs = 0;
    let inSegment = false;
    let segmentStart = 0;

    for (let i = 0; i < normalizedEnergies.length; i++) {
      if (!inSegment && normalizedEnergies[i] > energyThreshold) {
        inSegment = true;
        segmentStart = i * hopSize;
      } else if (inSegment && normalizedEnergies[i] <= energyThreshold) {
        inSegment = false;
        const segmentEnd = i * hopSize;
        voicedDurationMs += ((segmentEnd - segmentStart) / sampleRate) * 1000;
      }
    }
    if (inSegment) {
      const segmentEnd = samples.length;
      voicedDurationMs += ((segmentEnd - segmentStart) / sampleRate) * 1000;
    }

    return voicedDurationMs;
  } catch (err) {
    // TEMP-DEBUG: log post-encode decode failure
    console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'post_encode_decode_failed', error: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}

async function recordAudioWithVadSingleAttempt(options: {
  minVoicedDurationMs?: number;
  maxRecordingMs?: number;
  energyThreshold?: number;
  warmup?: {
    enabled: boolean;
    minVoiceDetectedMs?: number;
    maxWarmupMs?: number;
  };
  referenceMaxEnergy?: number;
  onWarmupComplete?: (referenceMaxEnergy: number) => void;
} = {}): Promise<VadRecordingResult> {
  const minVoicedMs = options.minVoicedDurationMs ?? MIN_VOICED_DURATION_MS;
  const maxRecordingMs = options.maxRecordingMs ?? MAX_RECORDING_MS;
  const energyThreshold = options.energyThreshold ?? VAD_ENERGY_THRESHOLD;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];

  let recordStart = performance.now();
  let audioInterrupted = false;
  let interruptReason = '';
  const track = stream.getAudioTracks()[0];
  const onTrackEnded = () => {
    audioInterrupted = true;
    interruptReason = 'track_ended_prematurely';
  };
  if (track) track.addEventListener('ended', onTrackEnded);

  const onVisibilityChange = () => {
    if (document.hidden) {
      audioInterrupted = true;
      interruptReason = 'page_visibility_hidden';
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  let blob: Blob | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      resolve();
    };
  });

  const AudioCtx = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  // TEMP-DEBUG: log AudioContext state at creation
  console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'audioCtx_created', state: audioCtx.state, sampleRate: audioCtx.sampleRate }));
  if (audioCtx.state === 'suspended') {
    // TEMP-DEBUG: log resume attempt
    console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'resume_attempt', state: audioCtx.state }));
    try {
      await audioCtx.resume();
      // TEMP-DEBUG: log resume success
      console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'resume_result', success: true, state: audioCtx.state }));
    } catch (resumeErr) {
      // TEMP-DEBUG: log resume failure — this is the prime suspect for intermittent timeout
      console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'resume_result', success: false, state: audioCtx.state, error: resumeErr instanceof Error ? resumeErr.message : String(resumeErr) }));
    }
  }

  const sourceNode = audioCtx.createMediaStreamSource(stream);
  const vad = createVadAccumulator(energyThreshold, options.referenceMaxEnergy);
  let vadMode: VadMode = 'none';
  let vadInterval: ReturnType<typeof setInterval> | null = null;
  let analyser: AnalyserNode | null = null;
  let workletNode: AudioWorkletNode | null = null;

  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  silentGain.connect(audioCtx.destination);

  let workletFirstFrameReceived = false; // TEMP-DEBUG: detect if worklet never receives frames
  try {
    const blobUrl = URL.createObjectURL(
      new Blob([VAD_PROCESSOR_CODE], { type: 'application/javascript' }),
    );
    await audioCtx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);

    workletNode = new AudioWorkletNode(audioCtx, 'vad-processor');
    sourceNode.connect(workletNode);
    workletNode.connect(silentGain);
    vadMode = 'audioworklet';
    // TEMP-DEBUG: log worklet path selected and audioCtx state at this point
    console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'worklet_loaded', state: audioCtx.state }));

    workletNode.port.onmessage = (e: MessageEvent) => {
      if (!workletFirstFrameReceived) {
        workletFirstFrameReceived = true;
        // TEMP-DEBUG: log first frame arrival — if this never fires, worklet is loaded but no audio flows
        console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'worklet_first_frame', state: audioCtx.state, elapsedMs: Math.round(performance.now() - recordStart) }));
      }
      const { energy, frameSize } = e.data as { energy: number; frameSize: number };
      const frameDurationMs = (frameSize / audioCtx.sampleRate) * 1000;
      vad.processFrame(energy, frameDurationMs);
    };
  } catch (workletErr) {
    // TEMP-DEBUG: log worklet failure reason — was silently swallowed before
    console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'worklet_failed', error: workletErr instanceof Error ? workletErr.message : String(workletErr), state: audioCtx.state }));
    workletNode = null;
    try {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode.connect(analyser);
      analyser.connect(silentGain);
      vadMode = 'analyser';
      // TEMP-DEBUG: log analyser fallback selected
      console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'analyser_fallback', state: audioCtx.state }));

      let analyserFirstFrame = false; // TEMP-DEBUG
      const timeData = new Float32Array(analyser.fftSize);
      vadInterval = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(timeData);
        if (!analyserFirstFrame) {
          analyserFirstFrame = true;
          // TEMP-DEBUG: log first analyser frame
          console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'analyser_first_frame', state: audioCtx.state, elapsedMs: Math.round(performance.now() - recordStart) }));
        }
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          sumSq += timeData[i] * timeData[i];
        }
        const energy = sumSq / timeData.length;
        const frameDurationMs = (timeData.length / audioCtx.sampleRate) * 1000;
        vad.processFrame(energy, frameDurationMs);
      }, 25);
    } catch {
      vadMode = 'none';
    }
  }

  // ─── Phase 1: Warm-up (optional) ────────────────────────────────
  // Initializes mic + AudioContext BEFORE starting MediaRecorder.
  //
  // The warm-up phase provides two benefits:
  //   1. Microphone initialization (getUserMedia, AudioContext.resume())
  //   2. Confirmation that the microphone is capturing voice (WARMUP_MIN_VOICE_MS)
  //
  // Warm-up audio is NOT recorded (MediaRecorder has not started yet), so it
  // is never included in the blob sent to HCS backend.
  //
  // VAD calibration decision (regression fix):
  //   The warm-up's maxEnergy is NOT carried over to Phase 2. Empirical testing
  //   showed that the warm-up phrase (spoken with different energy/proximity
  //   than the RAN digits) produced a maxEnergy that was often HIGHER than the
  //   actual Phase 2 energy. Since VAD_ENERGY_THRESHOLD is relative
  //   (energy / maxEnergy > 0.015), a higher maxEnergy makes the threshold
  //   artificially strict, causing voiced frames to be misclassified as
  //   unvoiced. This produced voicedDurationMs ~1780ms vs ~4000-5650ms without
  //   warm-up — a severe regression.
  //
  //   Fix: Both voicedDuration AND maxEnergy are reset at the Phase 1 → Phase 2
  //   transition. Phase 2's VAD starts with cold-start maxEnergy (1e-10),
  //   identical to the original pipeline without warm-up. The warm-up still
  //   provides mic initialization and AudioContext.resume() benefits.
  let warmupMaxEnergy: number | undefined;
  let warmupDurationMs: number | undefined;
  if (options.warmup?.enabled) {
    const warmupMinVoiceMs = options.warmup.minVoiceDetectedMs ?? WARMUP_MIN_VOICE_MS;
    const warmupMaxMs = options.warmup.maxWarmupMs ?? WARMUP_MAX_MS;
    const warmupStart = performance.now();

    console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'warmup_start', vadMode, audioCtxState: audioCtx.state }));

    await new Promise<void>((resolve) => {
      if (vadMode === 'none') {
        // No VAD available — skip warm-up, proceed to recording
        console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'warmup_skipped', reason: 'vadMode_none' }));
        resolve();
        return;
      }
      const checkInterval = setInterval(() => {
        if (audioInterrupted) {
          clearInterval(checkInterval);
          resolve();
          return;
        }
        if (vad.getVoicedDurationMs() >= warmupMinVoiceMs) {
          clearInterval(checkInterval);
          resolve();
          return;
        }
        if (performance.now() - warmupStart >= warmupMaxMs) {
          // Warm-up timeout — proceed anyway. maxEnergy will be whatever was
          // accumulated (noise floor or partial voice). The relative threshold
          // self-corrects when the user speaks louder in Phase 2.
          console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'warmup_timeout', voicedMs: Math.round(vad.getVoicedDurationMs()), maxEnergy: vad.getMaxEnergy() }));
          clearInterval(checkInterval);
          resolve();
          return;
        }
      }, 50);
    });

    warmupMaxEnergy = vad.getMaxEnergy();
    warmupDurationMs = Math.round(performance.now() - warmupStart);

    // Reset BOTH voiced duration AND maxEnergy for Phase 2.
    // maxEnergy reset is critical: the warm-up phrase energy must NOT carry
    // over as a ceiling for Phase 2's relative VAD threshold. Without this
    // reset, if the warm-up energy > Phase 2 energy, the VAD becomes
    // artificially strict and produces lower voicedDurationMs than the
    // original pipeline without warm-up (a regression).
    vad.resetVoicedDuration();
    vad.resetMaxEnergy();

    // Reset recordStart so warm-up time doesn't eat into maxRecordingMs budget.
    recordStart = performance.now();

    console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'warmup_complete', warmupDurationMs, warmupMaxEnergy, audioCtxState: audioCtx.state }));

    if (options.onWarmupComplete) {
      options.onWarmupComplete(warmupMaxEnergy);
    }
  }

  recorder.start(250);
  // TEMP-DEBUG: log recorder start and audioCtx state at recording start
  console.log(JSON.stringify({ event: '[VAD-DEBUG]', stage: 'recorder_started', recorderState: recorder.state, audioCtxState: audioCtx.state, vadMode, warmupMaxEnergy: warmupMaxEnergy ?? null }));

  let timeout = false;
  // TEMP-DEBUG: periodic voiced-duration sampler — logs every 1000ms to see if accumulation progresses
  const debugSampler = setInterval(() => {
    const elapsed = Math.round(performance.now() - recordStart);
    console.log(JSON.stringify({
      event: '[VAD-DEBUG]',
      stage: 'progress_sample',
      elapsedMs: elapsed,
      voicedDurationMs: Math.round(vad.getVoicedDurationMs()),
      targetVoicedMs: minVoicedMs,
      audioCtxState: audioCtx.state,
      vadMode,
      maxEnergy: vad.getMaxEnergy(),
      workletFirstFrameReceived,
    }));
  }, 1000);

  await new Promise<void>((resolve) => {
    if (vadMode === 'none') {
      setTimeout(resolve, maxRecordingMs);
      return;
    }

    const checkInterval = setInterval(() => {
      const elapsed = performance.now() - recordStart;
      if (audioInterrupted) {
        clearInterval(checkInterval);
        resolve();
        return;
      }
      if (vad.getVoicedDurationMs() >= minVoicedMs) {
        clearInterval(checkInterval);
        resolve();
        return;
      }
      if (elapsed >= maxRecordingMs) {
        timeout = true;
        clearInterval(checkInterval);
        resolve();
        return;
      }
    }, 50);
  });

  clearInterval(debugSampler); // TEMP-DEBUG: stop periodic sampler

  const recorderStateAtStop = recorder.state;
  const trackMuted = track ? track.muted : false;
  const trackReadyState = track ? track.readyState : 'unknown';

  if (recorder.state === 'recording') {
    recorder.stop();
  }

  if (recorder.state === 'inactive') {
    blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
  } else {
    await stopPromise;
  }

  if (vadInterval) clearInterval(vadInterval);
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
  }
  if (analyser) analyser.disconnect();
  if (silentGain) silentGain.disconnect();
  sourceNode.disconnect();
  try { await audioCtx.close(); } catch { /* ignore */ }
  if (track) track.removeEventListener('ended', onTrackEnded);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  stream.getTracks().forEach(t => t.stop());

  const totalDurationMs = Math.round(performance.now() - recordStart);
  const actualMimeType = blob?.type || mimeType || 'audio/webm';

  console.log(JSON.stringify({
    event: '[VAD-RECORD]',
    vadMode,
    voicedDurationMs: Math.round(vad.getVoicedDurationMs()),
    totalDurationMs,
    timeout,
    interrupted: audioInterrupted,
    mimeType: actualMimeType,
    blobSize: blob?.size ?? 0,
    chunksCount: chunks.length,
    maxEnergy: vad.getMaxEnergy(),
    // TEMP-DEBUG: additional diagnostic fields for intermittent timeout investigation
    workletFirstFrameReceived, // false = worklet loaded but never got audio (suspended ctx?)
    audioCtxStateAtStop: audioCtx.state, // 'closed' expected after close()
    warmupMaxEnergy: warmupMaxEnergy ?? null,
    warmupDurationMs: warmupDurationMs ?? null,
  }));

  return {
    blob,
    mimeType: actualMimeType,
    voicedDurationMs: Math.round(vad.getVoicedDurationMs()),
    totalDurationMs,
    interrupted: audioInterrupted,
    interruptReason: interruptReason || undefined,
    timeout,
    chunksCount: chunks.length,
    postEncodeVoicedDurationMs: null,
    postEncodeRetry: false,
    debug: {
      pickedMimeType: mimeType,
      recorderStateAtStop,
      trackMuted,
      trackReadyState,
      vadMode,
      maxEnergy: vad.getMaxEnergy(),
      warmupMaxEnergy,
      warmupDurationMs,
    },
  };
}

/**
 * Standard recording (no warm-up). Identical behavior as before — zero regression.
 * Existing callers use this function unchanged.
 */
export async function recordAudioWithVad(options: {
  minVoicedDurationMs?: number;
  maxRecordingMs?: number;
  energyThreshold?: number;
} = {}): Promise<VadRecordingResult> {
  const minVoicedMs = options.minVoicedDurationMs ?? MIN_VOICED_DURATION_MS;
  const energyThreshold = options.energyThreshold ?? VAD_ENERGY_THRESHOLD;

  const firstAttempt = await recordAudioWithVadSingleAttempt(options);

  // Skip post-encode validation if interrupted, timeout, or no blob
  if (firstAttempt.interrupted || firstAttempt.timeout || !firstAttempt.blob || firstAttempt.blob.size === 0) {
    return firstAttempt;
  }

  // Post-encode VAD validation: decode the compressed blob and re-measure voiced duration
  const postEncodeVoicedMs = await measureVoicedDurationFromBlob(firstAttempt.blob, energyThreshold);

  // TEMP-DEBUG: log the comparison between live and post-encode voiced duration
  console.log(JSON.stringify({
    event: '[VAD-DEBUG]',
    stage: 'post_encode_comparison',
    liveVoicedDurationMs: firstAttempt.voicedDurationMs,
    postEncodeVoicedDurationMs: postEncodeVoicedMs !== null ? Math.round(postEncodeVoicedMs) : null,
    targetVoicedMs: minVoicedMs,
    blobSize: firstAttempt.blob.size,
    mimeType: firstAttempt.mimeType,
  }));

  firstAttempt.postEncodeVoicedDurationMs = postEncodeVoicedMs !== null ? Math.round(postEncodeVoicedMs) : null;

  // If post-encode voiced duration is sufficient, accept the recording
  if (postEncodeVoicedMs !== null && postEncodeVoicedMs >= minVoicedMs) {
    return firstAttempt;
  }

  // If decode failed (null), we can't validate — trust the live VAD result
  if (postEncodeVoicedMs === null) {
    return firstAttempt;
  }

  // Post-encode validation failed — live VAD said OK but compressed audio is insufficient
  // TEMP-DEBUG: log retry trigger
  console.log(JSON.stringify({
    event: '[VAD-DEBUG]',
    stage: 'post_encode_retry_triggered',
    liveVoicedDurationMs: firstAttempt.voicedDurationMs,
    postEncodeVoicedDurationMs: postEncodeVoicedMs !== null ? Math.round(postEncodeVoicedMs) : null,
    targetVoicedMs: minVoicedMs,
  }));

  // Automatic retry: one more recording attempt
  const retryAttempt = await recordAudioWithVadSingleAttempt(options);
  retryAttempt.postEncodeRetry = true;

  // Validate the retry's blob too
  if (retryAttempt.interrupted || retryAttempt.timeout || !retryAttempt.blob || retryAttempt.blob.size === 0) {
    retryAttempt.postEncodeVoicedDurationMs = null;
    return retryAttempt;
  }

  const retryPostEncodeVoicedMs = await measureVoicedDurationFromBlob(retryAttempt.blob, energyThreshold);

  // TEMP-DEBUG: log retry post-encode comparison
  console.log(JSON.stringify({
    event: '[VAD-DEBUG]',
    stage: 'post_encode_retry_comparison',
    liveVoicedDurationMs: retryAttempt.voicedDurationMs,
    postEncodeVoicedDurationMs: retryPostEncodeVoicedMs !== null ? Math.round(retryPostEncodeVoicedMs) : null,
    targetVoicedMs: minVoicedMs,
    blobSize: retryAttempt.blob.size,
    mimeType: retryAttempt.mimeType,
  }));

  retryAttempt.postEncodeVoicedDurationMs = retryPostEncodeVoicedMs !== null ? Math.round(retryPostEncodeVoicedMs) : null;

  // If retry's post-encode is sufficient, accept it
  if (retryPostEncodeVoicedMs !== null && retryPostEncodeVoicedMs >= minVoicedMs) {
    return retryAttempt;
  }

  // Fail-closed: both attempts had insufficient post-encode voiced duration
  // Return the retry attempt but mark as timeout (voiced_duration_timeout)
  retryAttempt.timeout = true;
  return retryAttempt;
}

/**
 * Warm-up + recording flow (2-phase vocal capture).
 *
 * Phase 1 (Warm-up):
 *   - Opens microphone (getUserMedia) and AudioContext
 *   - Resumes AudioContext if suspended (same rigor as existing resume() fix)
 *   - Runs VAD without MediaRecorder to capture reference maxEnergy
 *   - Waits until voice is detected (WARMUP_MIN_VOICE_MS of voiced audio)
 *   - Warm-up audio is NEVER recorded — MediaRecorder starts only in Phase 2
 *
 * Phase 2 (RAN challenge capture):
 *   - Starts MediaRecorder
 *   - VAD runs with cold-start maxEnergy (NOT calibrated from Phase 1)
 *   - Identical VAD logic, post-encode validation, and retry as recordAudioWithVad
 *   - The 5 liveness dimensions (breathingPresence, HNR, jitter, harmonicBalance,
 *     voicingRatio) are computed by HCS backend from Phase 2 audio only
 *
 * VAD calibration decision (regression fix):
 *   The warm-up's maxEnergy is NOT carried over to Phase 2. Testing showed
 *   that the warm-up phrase energy was often higher than the RAN digit energy,
 *   making the relative VAD threshold (energy / maxEnergy > 0.015) artificially
 *   strict. This caused voicedDurationMs to drop from ~4000-5650ms (pre-warm-up)
 *   to ~1780ms — a severe regression. Phase 2 now starts with cold-start
 *   maxEnergy, identical to the original pipeline. The warm-up still provides
 *   mic initialization and AudioContext.resume() benefits.
 *
 * @param options Recording options + onWarmupComplete callback for UI transition
 */
export async function warmupAndRecordAudioWithVad(options: {
  minVoicedDurationMs?: number;
  maxRecordingMs?: number;
  energyThreshold?: number;
  onWarmupComplete?: (referenceMaxEnergy: number) => void;
} = {}): Promise<VadRecordingResult> {
  const minVoicedMs = options.minVoicedDurationMs ?? MIN_VOICED_DURATION_MS;
  const energyThreshold = options.energyThreshold ?? VAD_ENERGY_THRESHOLD;

  const firstAttempt = await recordAudioWithVadSingleAttempt({
    ...options,
    warmup: { enabled: true },
    onWarmupComplete: options.onWarmupComplete,
  });

  // Skip post-encode validation if interrupted, timeout, or no blob
  if (firstAttempt.interrupted || firstAttempt.timeout || !firstAttempt.blob || firstAttempt.blob.size === 0) {
    return firstAttempt;
  }

  // Post-encode VAD validation: decode the compressed blob and re-measure voiced duration
  const postEncodeVoicedMs = await measureVoicedDurationFromBlob(firstAttempt.blob, energyThreshold);

  console.log(JSON.stringify({
    event: '[VAD-DEBUG]',
    stage: 'post_encode_comparison',
    liveVoicedDurationMs: firstAttempt.voicedDurationMs,
    postEncodeVoicedDurationMs: postEncodeVoicedMs !== null ? Math.round(postEncodeVoicedMs) : null,
    targetVoicedMs: minVoicedMs,
    blobSize: firstAttempt.blob.size,
    mimeType: firstAttempt.mimeType,
    warmupMaxEnergy: firstAttempt.debug.warmupMaxEnergy ?? null,
  }));

  firstAttempt.postEncodeVoicedDurationMs = postEncodeVoicedMs !== null ? Math.round(postEncodeVoicedMs) : null;

  if (postEncodeVoicedMs !== null && postEncodeVoicedMs >= minVoicedMs) {
    return firstAttempt;
  }

  if (postEncodeVoicedMs === null) {
    return firstAttempt;
  }

  // Post-encode validation failed — retry with cold-start VAD (no warm-up calibration).
  // The warm-up's maxEnergy is NOT passed to the retry, to avoid the same
  // regression where a high warm-up maxEnergy makes VAD too strict.
  console.log(JSON.stringify({
    event: '[VAD-DEBUG]',
    stage: 'post_encode_retry_triggered',
    liveVoicedDurationMs: firstAttempt.voicedDurationMs,
    postEncodeVoicedDurationMs: postEncodeVoicedMs !== null ? Math.round(postEncodeVoicedMs) : null,
    targetVoicedMs: minVoicedMs,
    warmupMaxEnergy: firstAttempt.debug.warmupMaxEnergy ?? null,
  }));

  const retryAttempt = await recordAudioWithVadSingleAttempt({
    ...options,
  });
  retryAttempt.postEncodeRetry = true;

  if (retryAttempt.interrupted || retryAttempt.timeout || !retryAttempt.blob || retryAttempt.blob.size === 0) {
    retryAttempt.postEncodeVoicedDurationMs = null;
    return retryAttempt;
  }

  const retryPostEncodeVoicedMs = await measureVoicedDurationFromBlob(retryAttempt.blob, energyThreshold);

  console.log(JSON.stringify({
    event: '[VAD-DEBUG]',
    stage: 'post_encode_retry_comparison',
    liveVoicedDurationMs: retryAttempt.voicedDurationMs,
    postEncodeVoicedDurationMs: retryPostEncodeVoicedMs !== null ? Math.round(retryPostEncodeVoicedMs) : null,
    targetVoicedMs: minVoicedMs,
    blobSize: retryAttempt.blob.size,
    mimeType: retryAttempt.mimeType,
  }));

  retryAttempt.postEncodeVoicedDurationMs = retryPostEncodeVoicedMs !== null ? Math.round(retryPostEncodeVoicedMs) : null;

  if (retryPostEncodeVoicedMs !== null && retryPostEncodeVoicedMs >= minVoicedMs) {
    return retryAttempt;
  }

  // Fail-closed: both attempts had insufficient post-encode voiced duration
  retryAttempt.timeout = true;
  return retryAttempt;
}
