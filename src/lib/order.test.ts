import { describe, it, expect } from 'vitest';
import {
  indexById, blockerOf, isBlocked, chainDepth, wouldCycle, possibleBlockers, readyFirst
} from './order';
import type { Todo } from './types';

/** The garden, which is the example this was built from. */
const todo = (id: string, over: Partial<Todo> = {}): Todo => ({
  id,
  title: id,
  createdAt: `2026-09-01T10:0${id.length}:00.000Z`,
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over
});

const garden = () => {
  const clean = todo('clean', { createdAt: '2026-09-01T10:00:00.000Z' });
  const bamboo = todo('bamboo', { createdAt: '2026-09-01T10:01:00.000Z' });
  const grass = todo('grass', { createdAt: '2026-09-01T10:02:00.000Z', after: 'clean' });
  const pots = todo('pots', { createdAt: '2026-09-01T10:03:00.000Z', after: 'grass' });
  return [clean, bamboo, grass, pots];
};

describe('one to-do waiting on another', () => {
  it('blocks while the thing before it is open', () => {
    const all = garden();
    const byId = indexById(all);
    expect(isBlocked(all[2], byId)).toBe(true);
    expect(blockerOf(all[2], byId)!.id).toBe('clean');
    expect(isBlocked(all[0], byId)).toBe(false);
  });

  it('releases the moment the blocker is completed, with no second action', () => {
    // The whole mechanic. Nothing writes to the waiting to-do when its blocker
    // is ticked — being blocked is derived, so it cannot go stale.
    const all = garden();
    all[0] = { ...all[0], completedAt: '2026-09-02T09:00:00.000Z' };
    expect(isBlocked(all[2], indexById(all))).toBe(false);
  });

  it('does NOT block on a to-do that was deleted', () => {
    // A link into nothing must fail towards visible. Blocking here would freeze
    // the to-do forever with nothing on screen to explain it or undo it.
    const all = garden();
    all[0] = { ...all[0], deletedAt: '2026-09-02T09:00:00.000Z' };
    expect(isBlocked(all[2], indexById(all))).toBe(false);
  });

  it('does NOT block on an id that is not there at all', () => {
    const orphan = todo('orphan', { after: 'a-to-do-from-another-device' });
    expect(isBlocked(orphan, indexById([orphan]))).toBe(false);
  });
});

describe('the order the links produce', () => {
  it('puts what can be started first and reads each chain in sequence', () => {
    const order = readyFirst(garden()).map((t) => t.id);
    expect(order).toEqual(['clean', 'bamboo', 'grass', 'pots']);
  });

  it('re-sorts itself as things get done', () => {
    const all = garden();
    all[0] = { ...all[0], completedAt: '2026-09-02T09:00:00.000Z' };
    // Sowing is now ready, so it joins the top group rather than sitting under
    // the bamboo it never actually depended on.
    expect(readyFirst(all).map((t) => t.id)).toEqual(['clean', 'bamboo', 'grass', 'pots']);
    expect(chainDepth(all[3], indexById(all))).toBe(1);
  });

  it('survives a cycle instead of hanging', () => {
    // Two devices can each write a legal half of a loop. A depth walk with no
    // guard would spin here forever, taking the whole page with it.
    const a = todo('a', { after: 'b' });
    const b = todo('b', { after: 'a' });
    const byId = indexById([a, b]);
    expect(chainDepth(a, byId)).toBe(1);
    expect(() => readyFirst([a, b])).not.toThrow();
  });
});

describe('refusing to build a loop', () => {
  it('spots the direct one', () => {
    const all = garden();
    // "clean" already has "grass" waiting on it, so sending it the other way
    // would leave both stuck with no way out from either screen.
    expect(wouldCycle('clean', 'grass', indexById(all))).toBe(true);
  });

  it('spots one further down the chain', () => {
    expect(wouldCycle('clean', 'pots', indexById(garden()))).toBe(true);
  });

  it('lets a legitimate link through', () => {
    expect(wouldCycle('grass', 'bamboo', indexById(garden()))).toBe(false);
  });

  it('offers the options in the order the list is written', () => {
    // The pots may wait on any of the three, its current blocker included —
    // and they come back in written order, not in whatever order the database
    // handed them over.
    const options = possibleBlockers(garden()[3], garden()).map((t) => t.id);
    expect(options).toEqual(['clean', 'bamboo', 'grass']);
  });

  it('never offers itself, a loop, or something already done', () => {
    const all = garden();
    all[1] = { ...all[1], completedAt: '2026-09-02T09:00:00.000Z' };
    const options = possibleBlockers(all[0], all).map((t) => t.id);
    expect(options).not.toContain('clean'); // itself
    expect(options).not.toContain('grass'); // waits on it already
    expect(options).not.toContain('pots'); // waits on it further down
    expect(options).not.toContain('bamboo'); // done, so the link would do nothing
  });
});
