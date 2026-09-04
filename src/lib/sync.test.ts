import { describe, it, expect } from 'vitest';
import { mergeRecords } from './merge';
import type { Note } from './types';

/**
 * Notes are the one content table that used to sync ONLY as .md files, and it
 * failed in two ways that both look like nothing happening.
 *
 * The Drive half cannot be exercised without Drive, so what is pinned here is
 * the part that was actually wrong: that a note arrives on a device that has
 * never seen it, and that two notes for the same project stay two notes.
 */
const note = (over: Partial<Note> & { id: string }): Note => ({
  projectId: 'era-1',
  markdown: '',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over
});

describe('notes across devices', () => {
  it('brings down a note the device has never seen', () => {
    // The old mechanism walked LOCAL notes and wrote each to Drive. A phone
    // with no row for a note written on the laptop had nothing to walk, so the
    // note simply never arrived — the exact report.
    const phone: Note[] = [];
    const drive = [note({ id: 'n1', markdown: 'https://claude.ai/share/abc' })];

    const { merged, localChanged } = mergeRecords(phone, drive);

    expect(localChanged).toBe(true);
    expect(merged).toHaveLength(1);
    expect(merged[0].markdown).toBe('https://claude.ai/share/abc');
  });

  it('keeps an era note and its projects notes apart', () => {
    // These used to share one filename — "crafting.md" — so each overwrote the
    // last and only one survived a round trip.
    const local = [
      note({ id: 'era', markdown: 'about the era' }),
      note({ id: 'spd', tag: 'SPD pad', markdown: 'about the pad' }),
      note({ id: 'shelf', tag: 'Shelf', markdown: 'about the shelf' })
    ];

    const { merged } = mergeRecords([], local);

    expect(merged).toHaveLength(3);
    expect(merged.find((n) => n.id === 'spd')!.markdown).toBe('about the pad');
    expect(merged.find((n) => n.id === 'shelf')!.markdown).toBe('about the shelf');
    expect(merged.find((n) => n.id === 'era')!.tag).toBeUndefined();
  });

  it('takes the newer edit when both sides changed', () => {
    const local = [note({ id: 'n1', markdown: 'older', updatedAt: '2026-09-01T10:00:00.000Z' })];
    const remote = [note({ id: 'n1', markdown: 'newer', updatedAt: '2026-09-02T10:00:00.000Z' })];

    expect(mergeRecords(local, remote).merged[0].markdown).toBe('newer');
  });

  it('keeps a deleted note deleted, even against a newer edit', () => {
    // Same rule as everywhere else: a tombstone beats a later write, because
    // nothing ever clears one and the alternative resurrects deleted records.
    const local = [
      note({ id: 'n1', markdown: 'gone', deletedAt: '2026-09-01T10:00:00.000Z' })
    ];
    const remote = [note({ id: 'n1', markdown: 'back', updatedAt: '2026-09-02T10:00:00.000Z' })];

    expect(mergeRecords(local, remote).merged[0].deletedAt).toBeTruthy();
  });
});
