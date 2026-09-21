import { announceMic } from './audio';

/**
 * Dictation you can WATCH, using the browser's own speech recogniser.
 *
 * Asked for as: *"can we not have the audio while using the assistant write
 * down what you are saying almost in real time, like when you have a chat with
 * an AI, you see what you are saying appearing on the screen, instead of
 * having to record a whole thing and then have it be analysed after?"*
 *
 * The existing path records, stops, uploads a WAV and waits for Gemini to send
 * words back — and that wait was already reported once as *"anything between 5
 * and 20 seconds, so sometimes it feels like it didn't work"*. No amount of
 * tuning removes a round trip. The browser's SpeechRecognition has no round
 * trip to remove: it streams words as you speak, which is both instantly
 * legible and free.
 *
 * **THE GEMINI PATH STAYS, and is not a legacy branch.** `SpeechRecognition`
 * is absent or unreliable on plenty of devices — notably an installed web app
 * on iOS, which is the most important device this app has — so the caller
 * feature-detects and falls back to recording. That is the hard rule anyway:
 * every AI feature keeps a working path that is not this one.
 *
 * **It is not offline.** Chrome and Safari both send the audio to their own
 * servers, so dictation is a network feature however local the rest of the app
 * is. Nothing else changes: the words land in a box and are not sent anywhere
 * until you tap.
 */

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canDictateLive = (): boolean => !!ctor();

export interface LiveDictation {
  /** Stop and keep what was heard. Resolves with the final text. */
  stop(): Promise<string>;
  /** Stop and throw it away. */
  cancel(): void;
}

export interface LiveDictationOptions {
  /** BCP-47. Undefined follows the browser, which is usually right and
   *  sometimes very wrong — see Settings → Dictation. */
  lang?: string;
  /** Everything heard so far: the settled words plus the guess in progress. */
  onText: (text: string, settled: boolean) => void;
  /** Something went wrong mid-flight; the caller decides what to say. */
  onError?: (code: string) => void;
}

/**
 * Starts listening. Throws if the recogniser cannot be constructed at all.
 *
 * INTERIM RESULTS ARE THE FEATURE, so they are reported separately from
 * settled ones: a caller that treated a guess as final would leave half-heard
 * words in the box when the recogniser corrected itself a moment later.
 */
export function dictateLive(opts: LiveDictationOptions): LiveDictation {
  const Ctor = ctor();
  if (!Ctor) throw new Error('This browser cannot dictate.');

  const rec = new Ctor();
  rec.lang = opts.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-GB');
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let settled = '';
  let stopped = false;
  let done: ((text: string) => void) | null = null;

  announceMic(true);

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) settled = `${settled} ${r[0].transcript}`.trim();
      else interim = `${interim} ${r[0].transcript}`.trim();
    }
    opts.onText(`${settled} ${interim}`.trim(), !interim);
  };

  rec.onerror = (e) => {
    // 'no-speech' and 'aborted' are ordinary ends, not failures worth naming.
    if (e.error !== 'no-speech' && e.error !== 'aborted') opts.onError?.(e.error);
  };

  /*
   * A recogniser stops itself after a pause — every implementation does, and
   * `continuous` only lengthens the fuse. Restarting is what makes it feel
   * continuous to someone who paused to think. Only while the caller still
   * wants to listen, or this would be an unkillable microphone.
   */
  rec.onend = () => {
    if (stopped) {
      announceMic(false);
      done?.(settled);
      done = null;
      return;
    }
    try {
      rec.start();
    } catch {
      // Refused to restart (some browsers refuse a too-rapid restart). Treat
      // it as the end rather than looping on it.
      stopped = true;
      announceMic(false);
      done?.(settled);
      done = null;
    }
  };

  rec.start();

  return {
    stop() {
      return new Promise<string>((resolve) => {
        if (stopped) return resolve(settled);
        stopped = true;
        done = resolve;
        try {
          rec.stop();
        } catch {
          announceMic(false);
          resolve(settled);
        }
      });
    },
    cancel() {
      stopped = true;
      done = null;
      try {
        rec.abort();
      } catch {
        /* already gone */
      }
      announceMic(false);
    }
  };
}

/**
 * What dictation can be set to. "Auto" follows the browser's own language,
 * which is right until the day you dictate in the other one.
 *
 * Kept deliberately short: this is a setting that exists because a Dutch
 * phone dictating English produces confident nonsense, not a language picker
 * for its own sake.
 */
export const DICTATION_LANGS: { key: string; label: string }[] = [
  { key: '', label: 'Follow the device' },
  { key: 'en-GB', label: 'English (UK)' },
  { key: 'en-US', label: 'English (US)' },
  { key: 'nl-NL', label: 'Nederlands' }
];
