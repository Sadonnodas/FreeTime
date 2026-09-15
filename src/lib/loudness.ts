/**
 * Playing a quiet recording at a sensible volume.
 *
 * From Toon's own list: *"Voice memos need to be normalized because the volume
 * is too low."* True of most of them, and for a reason the app chose on
 * purpose: music memos record with auto gain OFF (see audio.ts — auto gain
 * pumps the level between phrases and wrecks a sung melody), so a guitar picked
 * softly from across the room is saved as quietly as it arrived.
 *
 * NORMALISED ON PLAYBACK, NOT BAKED INTO THE FILE. Measure the loudest moment,
 * raise the whole recording so that moment sits just under full scale. Doing it
 * at playback is real normalisation — it can see the whole take — and it works
 * on every memo already recorded, and it never rewrites a file. The
 * alternative was boosting the microphone WHILE recording, which fixes shared
 * and Drive copies too; it lost because the boost has to be chosen before the
 * loudest moment has happened, so it either clips the chorus or leaves a quiet
 * take quiet, and it does nothing for anything recorded before today. The cost
 * of this choice, said plainly wherever it shows: a file shared or opened from
 * Drive plays at its original level.
 *
 * THE iPHONE SILENT SWITCH IS THE TRAP. An `<audio>` element ignores the ring/
 * silent switch; Web Audio obeys it. Routing a memo through Web Audio to boost
 * it would make every memo SILENT on a phone set to silent — reported as "my
 * recording won't play", which this app has already been through once for a
 * different reason. `navigator.audioSession` (Safari 17+) lets the page declare
 * itself a playback app and escape the switch, so the boost is only used where
 * that exists, or where there is no switch at all.
 */

/** Just under full scale, so the loudest moment is loud without touching 0 dB. */
export const TARGET_PEAK = 0.891; // −1 dBFS
/**
 * The most a recording is raised: +18 dB. A take that is nearly silent is
 * mostly room noise, and raising it all the way would play the hiss at full
 * volume rather than the idea.
 */
export const MAX_GAIN = 8;

/** How much to multiply a recording by, given its loudest sample. Never below 1:
 *  this only ever makes things louder, never quieter. */
export function gainFor(peak: number): number {
  if (!(peak > 0)) return 1;
  return Math.max(1, Math.min(MAX_GAIN, TARGET_PEAK / peak));
}

/** A gain as the decibels a person reads, rounded to whole ones. */
export const decibels = (gain: number): number => Math.round(20 * Math.log10(gain));

/** The loudest absolute sample across every channel. */
export function peakOfChannels(channels: Float32Array[]): number {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i]! < 0 ? -data[i]! : data[i]!;
      if (v > peak) peak = v;
    }
  }
  return peak;
}

const cache = new Map<string, number>();

/**
 * The gain for one recording, decoded once and remembered for the session.
 *
 * Decoded in an OfflineAudioContext, which renders nothing and so opens no
 * audio session on iOS — the audio session is the thing this app has been
 * bitten by twice. Any failure returns 1: the memo then plays exactly as it
 * always did, which is the right way for an enhancement to fail.
 */
export async function gainForRecording(key: string, blob: Blob): Promise<number> {
  const known = cache.get(key);
  if (known !== undefined) return known;
  try {
    const Offline: typeof OfflineAudioContext =
      window.OfflineAudioContext ??
      (window as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext!;
    const decoded = await new Offline(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
      decoded.getChannelData(i)
    );
    const gain = gainFor(peakOfChannels(channels));
    cache.set(key, gain);
    return gain;
  } catch {
    return 1;
  }
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** Whether boosting through Web Audio is safe here. See the silent-switch note. */
export function canBoost(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as AudioSessionNavigator).audioSession) return true;
  // No silent switch on a device with a mouse. A touch device without the API
  // may be an older iPhone, where boosting could play nothing at all.
  return !window.matchMedia?.('(pointer: coarse)').matches;
}

/**
 * Routes an `<audio>` element through a gain and a limiter.
 *
 * The limiter is a safety net, not the normalisation: the gain already aims
 * the peak below full scale, but a peak measured in one decode and the samples
 * played back after resampling can differ by a hair, and a hard limit at −1 dB
 * turns that hair into nothing instead of a click.
 *
 * Returns a release function that MUST be called when the player empties. It
 * closes the context and hands the audio session back — a second thing able to
 * hold the iOS audio session open is exactly what the microphone bug was.
 */
export function boostElement(el: HTMLAudioElement, gain: number): (() => void) | null {
  if (gain <= 1.05) return null;
  const session = (navigator as AudioSessionNavigator).audioSession;
  try {
    if (session) session.type = 'playback';
    const Ctx: typeof AudioContext =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(el);
    const amp = ctx.createGain();
    amp.gain.value = gain;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    source.connect(amp).connect(limiter).connect(ctx.destination);
    void ctx.resume();
    return () => {
      void ctx.close();
      if (session) session.type = 'auto';
    };
  } catch {
    if (session) session.type = 'auto';
    return null;
  }
}
