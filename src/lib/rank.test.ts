import { describe, it, expect } from 'vitest';
import { rankOf, byRank, placement, type Rankable } from './rank';

const at = (id: string, minute: number, rank?: number): Rankable => ({
  id,
  createdAt: new Date(Date.UTC(2026, 8, 18, 10, minute)).toISOString(),
  rank
});

/** Apply a placement to a list and read it back in order. */
const apply = (all: Rankable[], writes: { id: string; rank: number }[]) =>
  all
    .map((x) => ({ ...x, rank: writes.find((w) => w.id === x.id)?.rank ?? x.rank }))
    .sort(byRank)
    .map((x) => x.id);

describe('your own order', () => {
  it('is newest first until something is dragged', () => {
    const list = [at('old', 1), at('new', 3), at('mid', 2)].sort(byRank);
    expect(list.map((x) => x.id)).toEqual(['new', 'mid', 'old']);
  });

  it('moves ONE item between its new neighbours', () => {
    const list = [at('c', 3), at('b', 2), at('a', 1)].sort(byRank); // c b a
    const moved = [list[1], list[2], list[0]]; // drag c to the bottom: b a c
    const writes = placement(moved, 'c');
    expect(writes).toHaveLength(1);
    expect(apply(list, writes)).toEqual(['b', 'a', 'c']);
  });

  it('keeps hidden items in their places when dragged in a filtered list', () => {
    // All four: d c b a. A filter shows only d and a; drag a above d.
    const all = [at('d', 4), at('c', 3), at('b', 2), at('a', 1)];
    const visible = [all[3], all[0]]; // a, d  (new order)
    const writes = placement(visible, 'a');
    expect(writes.map((w) => w.id)).toEqual(['a']);
    // a lands above d; c and b, hidden, keep their order below d.
    expect(apply(all, writes)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('renumbers the visible list when there is no room between neighbours', () => {
    const tied = [at('x', 1, 5), at('y', 1, 5), at('z', 1, 5)];
    const writes = placement([tied[0], tied[2], tied[1]], 'z');
    expect(writes).toHaveLength(3);
    expect(apply(tied, writes)).toEqual(['x', 'z', 'y']);
  });

  it('has nothing to do for a list of one', () => {
    expect(placement([at('solo', 1)], 'solo')).toEqual([]);
  });

  it('takes a dragged rank over the date', () => {
    expect(rankOf(at('x', 1, 42))).toBe(42);
  });
});
