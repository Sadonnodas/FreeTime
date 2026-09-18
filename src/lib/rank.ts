/**
 * Your own order, for to-dos, ideas and things to buy.
 *
 * Asked for as *"change the order of to-dos within projects as well as within
 * the Brain section. Maybe also the ideas, to-buys etc. Of course when we
 * filter the order should reflect the filter."* That last sentence decides the
 * design: there is ONE order per item, not one per screen, so Brain filtered
 * to a project shows exactly the order that project's own screen does.
 *
 * Each item has a number (`rank`); lower is higher up. An item nobody has
 * dragged takes its number from when it was written, NEWEST FIRST — so until
 * something is dragged, every list reads the way Brain always has, and a new
 * item appears at the top, right under the Add button it was written in.
 *
 * DRAGGING WRITES ONE ITEM. The moved item gets a number between its new
 * neighbours — the neighbours ON SCREEN, which is what makes a filtered list
 * behave: move "sand" above "varnish" in the Campervan list and only "sand"
 * changes, landing between those two wherever else they appear, while every
 * to-do the filter hid keeps its place. Only when two neighbours have no room
 * between them (the same number, or a list sorted by something else first)
 * is the whole visible list renumbered in the order shown.
 */

export interface Rankable {
  id: string;
  createdAt: string;
  rank?: number;
}

/** Where an item sits: its dragged number, or newest-first by default. */
export const rankOf = (x: Rankable): number => x.rank ?? -Date.parse(x.createdAt);

/** Your order, with the id as a last resort so a tie is identical everywhere. */
export const byRank = (a: Rankable, b: Rankable): number =>
  rankOf(a) - rankOf(b) || a.id.localeCompare(b.id);

const GAP = 1000;

/**
 * The rank writes that put `movedId` where it now sits in `ordered` — the
 * visible list, in its NEW order, each item still carrying its old rank.
 */
export function placement(ordered: Rankable[], movedId: string): { id: string; rank: number }[] {
  const i = ordered.findIndex((x) => x.id === movedId);
  if (i < 0 || ordered.length < 2) return [];
  const lo = i > 0 ? rankOf(ordered[i - 1]) : undefined;
  const hi = i < ordered.length - 1 ? rankOf(ordered[i + 1]) : undefined;

  const r = lo === undefined ? hi! - GAP : hi === undefined ? lo + GAP : (lo + hi) / 2;
  const fits = (lo === undefined || r > lo) && (hi === undefined || r < hi);
  if (fits) return [{ id: movedId, rank: r }];

  // No room: number the whole visible list in the order shown, starting from
  // the lowest rank among them so it stays roughly where it was among the
  // items the filter is hiding.
  const base = Math.min(...ordered.map(rankOf));
  return ordered.map((x, n) => ({ id: x.id, rank: base + n * GAP }));
}
