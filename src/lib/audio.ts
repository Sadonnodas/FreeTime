/**
 * Recording, and getting it into a format Gemini will actually accept.
 *
 * THE PROBLEM. Gemini's inline audio accepts wav, mp3, aiff, aac, ogg and
 * flac. It does NOT document webm — which is exactly what Chrome's
 * MediaRecorder produces by default (webm/opus), while Safari produces
 * mp4/aac. Handing Gemini the raw recording is therefore a coin flip that
 * lands differently on the user's phone and their laptop.
 *
 * THE FIX. Decode whatever the browser recorded using the browser's own
 * decoder — which understands its own output — and re-encode to 16 kHz mono
 * WAV by hand. WAV is explicitly supported, needs no library (it is a 44-byte
 * header followed by raw samples), and 16 kHz mono is what speech models want
 * anyway. Downmixing and downsampling also cuts the payload by roughly 6x
 * versus 48 kHz stereo, which matters because inline data is base64 and base64
 * costs another third on top.
 */

/** Gemini bills 32 tokens per second of audio; the real limit is request size.
 *  Ten minutes of 16 kHz mono WAV is ~19 MB base64, so we stop before that. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

/** A kept recording never goes to Gemini, so the request-size ceiling does not
 *  apply. Half an hour of opus is about 15 MB. The cap exists only so a
 *  recording left running in a pocket cannot fill the device. */
export const MAX_MEMO_MS = 30 * 60 * 1000;

const TARGET_SAMPLE_RATE = 16_000;

/**
 * Picks a container the browser can actually record.
 *
 * Note this is NOT about what Gemini accepts — everything gets re-encoded to
 * WAV before it leaves. It only has to be something MediaRecorder will produce
 * and decodeAudioData will read back.
 */
function pickMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];
  if (typeof MediaRecorder === 'undefined') return undefined;
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export interface Recorder {
  stop(): Promise<Blob>;
  cancel(): void;
  readonly mimeType: string;
}

export interface RecordOptions {
  /**
   * Record music rather than speech.
   *
   * THIS MATTERS MORE THAN IT LOOKS. getUserMedia turns on echo cancellation,
   * noise suppression and automatic gain by default, because the browser
   * assumes it is capturing a voice call. Those three are actively destructive
   * on a sung melody or an acoustic guitar: noise suppression treats sustained
   * tones as background hum and gates them, and auto gain pumps the level
   * between phrases. A brain-dump in a car wants all three ON. A song idea
   * wants all three OFF, and the difference is audible immediately.
   */
  music?: boolean;
}

/**
 * Starts recording. Throws if the user denies the microphone.
 *
 * iOS caveat the spec flagged: getUserMedia inside an installed standalone PWA
 * has historically been restricted. If this throws on the home-screen app but
 * works in Safari, that is the cause, and the fallback is text capture.
 */
export async function startRecording(opts: RecordOptions = {}): Promise<Recorder> {
  const constraints: MediaTrackConstraints = opts.music
    ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
      }
    : {};
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    // The default is around 40 kbps, which is fine for speech and audibly
    // grainy on music. Opus at 128 kbps is transparent enough for a demo and
    // still only ~1 MB a minute.
    ...(opts.music ? { audioBitsPerSecond: 128_000 } : {})
  });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const releaseMic = () => stream.getTracks().forEach((t) => t.stop());

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
      releaseMic();
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          releaseMic();
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      });
    }
  };
}

/** Average the channels rather than dropping to the left one — a phone held at
 *  an angle can put most of the voice in one channel. */
function toMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0);

  const out = new Float32Array(length);
  for (let c = 0; c < numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i]! / numberOfChannels;
  }
  return out;
}

/** Linear interpolation. Speech at 16 kHz does not need a windowed-sinc
 *  resampler, and the model is far more tolerant than a human ear. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    out[i] = input[left]! * (1 - frac) + input[right]! * frac;
  }
  return out;
}

/** 16-bit PCM WAV: a 44-byte RIFF header, then samples. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling, or a sample slightly over 1.0 wraps to loud noise.
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** Whatever the browser recorded -> 16 kHz mono WAV that Gemini accepts. */
export async function toGeminiWav(blob: Blob): Promise<Blob> {
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = toMono(decoded);
    return encodeWav(resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
  } finally {
    void ctx.close();
  }
}

/** Base64 for inlineData. Chunked because a spread of a multi-megabyte array
 *  into String.fromCharCode blows the argument limit and throws. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Two short tones so the car case works without looking at the screen. */
export function beep(kind: 'start' | 'stop'): void {
  try {
    const Ctx: typeof AudioContext =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === 'start' ? 880 : 440;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    // A missing confirmation tone is not worth failing a recording over.
  }
}
