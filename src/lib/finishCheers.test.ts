import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CHEERS, pickCheer } from './finishCheers';
import { STICKERS } from './stickers';

describe('finish cheers', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v)
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only names stickers that exist', () => {
    // A retired sticker would render as a broken image on the best screen in the app.
    const ids = new Set(STICKERS.map((s) => s.id));
    expect(CHEERS.filter((c) => !ids.has(c.sticker))).toEqual([]);
  });

  it('never shows the same one twice running, even across opens', () => {
    // Always "roll" the first option, the worst case for a repeat.
    const first = pickCheer(() => 0).cheer.sticker;
    const second = pickCheer(() => 0).cheer.sticker;
    expect(second).not.toBe(first);
  });

  it('keeps its jokes about the dinosaur rather than about you', () => {
    // The house rule: nothing that tells the reader what they should have done.
    for (const c of CHEERS) expect(c.line).not.toMatch(/\b(should|finally|about time|at last)\b/i);
  });
});
