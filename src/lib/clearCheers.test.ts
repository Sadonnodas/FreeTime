import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CLEAR_CHEERS, pickClearCheer } from './clearCheers';
import { STICKERS } from './stickers';

describe('cheers for clearing a list', () => {
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
    // A retired one renders as a broken image, which is worse than no picture.
    const ids = new Set(STICKERS.map((s) => s.id));
    expect(CLEAR_CHEERS.filter((c) => !ids.has(c.sticker))).toEqual([]);
  });

  it('never shows the same one twice running, even across opens', () => {
    const first = pickClearCheer(() => 0).cheer.sticker;
    const second = pickClearCheer(() => 0).cheer.sticker;
    expect(second).not.toBe(first);
  });

  it('keeps its jokes about the dinosaur rather than about you', () => {
    for (const c of CLEAR_CHEERS) {
      expect(c.line).not.toMatch(/\b(should|finally|about time|at last|well done)\b/i);
    }
  });

  it('never mentions tomorrow, which would be a streak with a smile on it', () => {
    // Congratulating you and then pointing at the next day is how a habit app
    // starts keeping score.
    for (const c of CLEAR_CHEERS) {
      expect(c.line).not.toMatch(/\b(tomorrow|keep it up|again tomorrow|streak)\b/i);
    }
  });

  it('has enough of them that a week does not exhaust the joke', () => {
    expect(CLEAR_CHEERS.length).toBeGreaterThanOrEqual(14);
  });
});
