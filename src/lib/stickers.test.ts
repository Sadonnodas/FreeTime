import { describe, it, expect } from 'vitest';
import { STICKERS, stickerFrom, stickerRef, stickerFor, isStickerRef } from './stickers';

/**
 * The registry and the files have to agree, and nothing at runtime would say
 * so if they did not: a wrong id renders an <img> pointing at a 404, which
 * draws as a blank space rather than as an error. On a project cover that
 * looks exactly like a cover someone removed.
 */
// import.meta.glob rather than node:fs, so the test needs no @types/node —
// Vite resolves it at transform time and vitest inherits that.
const files = Object.keys(import.meta.glob('/static/dino/*.webp')).map((p) =>
  p.replace('/static/dino/', '')
);

describe('stickers', () => {
  it('has a file for every sticker', () => {
    const missing = STICKERS.filter((s) => !files.includes(`${s.id}.webp`));
    expect(missing.map((s) => s.id)).toEqual([]);
  });

  it('has a sticker for every file', () => {
    const ids = new Set(STICKERS.map((s) => s.id));
    const orphans = files.filter((f) => !ids.has(f.replace(/\.webp$/, '')));
    expect(orphans).toEqual([]);
  });

  it('has no duplicate ids', () => {
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
  });

  it('reads back the sticker it wrote', () => {
    const s = STICKERS[3];
    expect(stickerFrom(stickerRef(s.id))).toEqual(s);
  });

  it('leaves a real picture alone', () => {
    expect(stickerFrom('data:image/webp;base64,AAAA')).toBeNull();
    expect(stickerFrom(undefined)).toBeNull();
  });

  it('ignores an id that no longer exists rather than throwing', () => {
    // A cover chosen on a newer build, synced to an older one — or a sticker
    // that has since been retired, which has happened three times now.
    expect(stickerFrom('dino:tap-dancing')).toBeNull();
  });

  it('still knows a retired reference is a sticker and not a photo', () => {
    // ProjectCover leans on this. Without it a cover pointing at a retired
    // sticker falls through to the photo branch and renders
    // <img src="dino:through-the-fire-hoop"> — a broken image where the
    // project's own colour should be.
    expect(isStickerRef('dino:through-the-fire-hoop')).toBe(true);
    expect(isStickerRef('dino:ninja-on-a-bridge')).toBe(true);
    expect(isStickerRef('data:image/webp;base64,AAAA')).toBe(false);
    expect(isStickerRef(undefined)).toBe(false);
  });

  it('has retired the stickers that were taken out', () => {
    const ids = new Set(STICKERS.map((s) => s.id));
    for (const gone of ['rainbow-arc-2', 'through-the-fire-hoop', 'ninja-on-a-bridge']) {
      expect(ids.has(gone)).toBe(false);
    }
  });

  it('gives the same name the same dinosaur every time', () => {
    expect(stickerFor('Music')).toEqual(stickerFor('Music'));
    expect(stickerFor('Nothing here yet')).toEqual(stickerFor('Nothing here yet'));
  });
});
