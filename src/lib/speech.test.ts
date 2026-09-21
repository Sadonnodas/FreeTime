import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { canDictateLive, dictateLive } from './speech';

/**
 * *"See what you are saying appearing on the screen, instead of having to
 * record a whole thing and then have it be analysed after."*
 *
 * The parts worth pinning are the ones that fail silently: a guess treated as
 * final, a recogniser that stops itself mid-sentence, and a microphone left
 * open after the caller has finished with it.
 */

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  started = 0;
  stopped = 0;
  aborted = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
    this.onend?.();
  }
  abort() {
    this.aborted++;
  }

  /** Feed it what the browser would send. */
  say(parts: { text: string; final: boolean }[]) {
    this.onresult?.({
      resultIndex: 0,
      results: parts.map((p) => ({ 0: { transcript: p.text }, isFinal: p.final }))
    });
  }
}

beforeEach(() => {
  FakeRecognition.last = null;
  vi.stubGlobal('window', { SpeechRecognition: FakeRecognition });
  vi.stubGlobal('navigator', { language: 'nl-NL' });
});
afterEach(() => vi.unstubAllGlobals());

describe('watching the words arrive', () => {
  it('reports a guess as a guess and a settled phrase as settled', () => {
    const seen: [string, boolean][] = [];
    dictateLive({ onText: (t, settled) => seen.push([t, settled]) });

    FakeRecognition.last!.say([{ text: 'add a to', final: false }]);
    FakeRecognition.last!.say([{ text: 'add a to-do', final: true }]);

    expect(seen[0]).toEqual(['add a to', false]);
    expect(seen[1]).toEqual(['add a to-do', true]);
  });

  it('keeps settled words when a later guess replaces the tail', () => {
    const seen: string[] = [];
    dictateLive({ onText: (t) => seen.push(t) });
    const r = FakeRecognition.last!;

    r.say([{ text: 'buy milk', final: true }]);
    r.say([{ text: 'and bre', final: false }]);
    r.say([{ text: 'and bread', final: false }]);

    expect(seen.at(-1)).toBe('buy milk and bread');
  });

  it('follows the device language unless told otherwise', () => {
    dictateLive({ onText: () => {} });
    expect(FakeRecognition.last!.lang).toBe('nl-NL');

    dictateLive({ lang: 'en-GB', onText: () => {} });
    expect(FakeRecognition.last!.lang).toBe('en-GB');
  });

  it('asks for interim results at all, which is the whole feature', () => {
    dictateLive({ onText: () => {} });
    expect(FakeRecognition.last!.interimResults).toBe(true);
    expect(FakeRecognition.last!.continuous).toBe(true);
  });
});

describe('a recogniser that stops itself', () => {
  it('restarts while the caller is still listening', () => {
    dictateLive({ onText: () => {} });
    const r = FakeRecognition.last!;
    expect(r.started).toBe(1);

    // A pause to think. Every implementation ends the session; restarting is
    // what makes it feel continuous.
    r.onend?.();
    expect(r.started).toBe(2);
  });

  it('stays stopped once asked to stop, and hands back what it heard', async () => {
    const d = dictateLive({ onText: () => {} });
    const r = FakeRecognition.last!;
    r.say([{ text: 'ear training', final: true }]);

    expect(await d.stop()).toBe('ear training');
    // No restart after the stop: an unkillable microphone is worse than none.
    expect(r.started).toBe(1);
  });

  it('gives up rather than looping when a restart is refused', async () => {
    const d = dictateLive({ onText: () => {} });
    const r = FakeRecognition.last!;
    r.start = () => {
      throw new Error('too soon');
    };
    r.onend?.();
    expect(await d.stop()).toBe('');
  });
});

describe('failures', () => {
  it('says nothing about a pause or an abort', () => {
    const errors: string[] = [];
    dictateLive({ onText: () => {}, onError: (e) => errors.push(e) });
    FakeRecognition.last!.onerror?.({ error: 'no-speech' });
    FakeRecognition.last!.onerror?.({ error: 'aborted' });
    expect(errors).toEqual([]);
  });

  it('reports a refused microphone', () => {
    const errors: string[] = [];
    dictateLive({ onText: () => {}, onError: (e) => errors.push(e) });
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(errors).toEqual(['not-allowed']);
  });

  it('is absent, not broken, where the browser has no recogniser', () => {
    vi.stubGlobal('window', {});
    expect(canDictateLive()).toBe(false);
    // The caller falls back to recording; it must not be handed a half-thing.
    expect(() => dictateLive({ onText: () => {} })).toThrow();
  });
});
