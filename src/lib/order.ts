import type { Todo } from './types';

/**
 * Which to-dos are waiting on another one, and what order that puts them in.
 *
 * Asked for with the garden: cleaning up, removing the bamboo, sowing grass,
 * installing pots — and you cannot sow before the garden is clear. So a to-do
 * can name ONE it comes after (`Todo.after`), which is enough to describe that
 * and cheap enough to read at a glance.
 *
 * WHAT THIS DOES AND DOES NOT DO. It changes what the app OFFERS: Free Time
 * never suggests something you cannot start yet, and a project's list puts
 * what is ready at the top. It never FORBIDS anything — the tick circle on a
 * blocked to-do still works, the same way nothing here is ever overdue. The
 * app is not the boss; it just stops handing you the impossible one.
 *
 * Every function takes an index of the to-dos rather than touching the
 * database, so all of it is pure and testable.
 */
export type TodoIndex = Map<string, Todo>;

export const indexById = (todos: Todo[]): TodoIndex =>
  new Map(todos.map((t) => [t.id, t]));

/**
 * The thing genuinely standing in the way, or undefined.
 *
 * THREE ways an `after` stops counting, and all three matter:
 *  - the blocker is DONE, which is the whole mechanic: finishing one thing
 *    unblocks the next with no second action anywhere;
 *  - the blocker was DELETED, so the link points at nothing;
 *  - the blocker is not in the index at all.
 * The last two are the same case in practice, and both resolve to "not
 * blocked" on purpose. The alternative — treating an unresolvable link as a
 * block — freezes a to-do forever with nothing on screen explaining why and no
 * way to fix it. Same lesson as the retired sticker that rendered as a broken
 * image: a dangling reference must fail towards visible, not towards gone.
 */
export function blockerOf(todo: Todo, byId: TodoIndex): Todo | undefined {
  if (!todo.after) return undefined;
  const b = byId.get(todo.after);
  if (!b || b.deletedAt || b.completedAt) return undefined;
  return b;
}

export const isBlocked = (todo: Todo, byId: TodoIndex): boolean => !!blockerOf(todo, byId);

/**
 * How many unfinished things stand between this and being startable. Zero
 * means ready. Used only for ordering, so a chain reads in the order it has to
 * happen instead of the order it was typed.
 */
export function chainDepth(todo: Todo, byId: TodoIndex): number {
  const seen = new Set<string>([todo.id]);
  let depth = 0;
  let cur = blockerOf(todo, byId);
  // The guard is not paranoia: a cycle can arrive from another device, where
  // two halves of it were each legal when they were written.
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth++;
    cur = blockerOf(cur, byId);
  }
  return depth;
}

/**
 * Would pointing `id` at `afterId` close a loop? Two to-dos each waiting on
 * the other are both blocked forever, and neither can be released from either
 * screen — a trap you can build in two taps and cannot get out of.
 *
 * Walks the RAW links, completed ones included: a cycle is a fact about the
 * links, not about what has been done.
 */
export function wouldCycle(id: string, afterId: string, byId: TodoIndex): boolean {
  if (id === afterId) return true;
  const seen = new Set<string>();
  let cur = byId.get(afterId);
  while (cur) {
    if (cur.id === id) return true;
    if (seen.has(cur.id)) return false; // a loop that was already there, not one we are adding
    seen.add(cur.id);
    cur = cur.after ? byId.get(cur.after) : undefined;
  }
  return false;
}

/**
 * What this to-do could legally be told to wait for, out of the list it lives
 * in — in the order that list is written, so the options read the way the
 * to-dos above them do rather than in whatever order the database returned.
 */
export function possibleBlockers(todo: Todo, siblings: Todo[]): Todo[] {
  const byId = indexById(siblings);
  return siblings
    .filter(
      (t) =>
        t.id !== todo.id &&
        !t.completedAt && // waiting on something already done is a link that does nothing
        !wouldCycle(todo.id, t.id, byId)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Ready first, then each chain in the order it has to happen.
 *
 * This is where "give them an order" actually gets answered: nobody arranges
 * the list, the links do it. Within one depth the order is the order they were
 * written, because a project's list is a plan you read down, not a feed.
 */
export function readyFirst(todos: Todo[]): Todo[] {
  const byId = indexById(todos);
  return [...todos].sort(
    (a, b) => chainDepth(a, byId) - chainDepth(b, byId) || a.createdAt.localeCompare(b.createdAt)
  );
}
