import { db } from './db';
import { createTodo, updateTodo } from './store';
import type { BuyItem, Project, Todo } from './types';

/**
 * A to-do that opens a shopping list.
 *
 * Asked for as *"say I need to do groceries, those are things to buy. Can I
 * have a way to put them all under one list so that I can click that list on
 * the to-do page to open up what to buy?"* Groceries are a set of buy items
 * and a trip is a to-do, and until now the two could not see each other.
 *
 * The list is the To buy list of the PLACE the to-do lives in. Make a project
 * called Groceries, write the milk and the eggs into its To buy, and a
 * shopping to-do in that project opens exactly that. Nothing new holds the
 * items, so they still show up in Brain → Buy, in the era overview, in the
 * printed shopping list, and everywhere else they already did.
 *
 * Place is matched exactly: a to-do on the era with no project opens the
 * era's own unfiled-to-a-project items, not every project's, because "the
 * campervan's shopping" and "everything the campervan era will ever need"
 * are different lists.
 */

/** The same place: same era, and the same project or both without one. */
export const samePlace = (a: { projectId?: string; tag?: string }, b: { projectId?: string; tag?: string }) =>
  !!a.projectId && a.projectId === b.projectId && (a.tag ?? '') === (b.tag ?? '');

/** The list a shopping to-do opens, still-to-buy first. */
export function listFor(todo: Pick<Todo, 'projectId' | 'tag'>, items: BuyItem[]): BuyItem[] {
  return items
    .filter((b) => !b.deletedAt && samePlace(b, todo))
    .sort(
      (a, b) =>
        (a.purchasedAt ? 1 : 0) - (b.purchasedAt ? 1 : 0) ||
        (b.needed ? 1 : 0) - (a.needed ? 1 : 0) ||
        b.createdAt.localeCompare(a.createdAt)
    );
}

export const stillToBuy = (items: BuyItem[]) => items.filter((b) => !b.purchasedAt).length;

/** What the list is called on screen: the project, or the era. */
export function placeName(todo: Pick<Todo, 'projectId' | 'tag'>, eras: Pick<Project, 'id' | 'name'>[]): string {
  return todo.tag ?? eras.find((e) => e.id === todo.projectId)?.name ?? 'this list';
}

/**
 * The trip for a place's list: the open one if there already is one, or a new
 * one. Reusing it is what keeps "Shop today" from minting a second "Shopping"
 * to-do every time it is tapped in a week where the first never got done.
 */
export async function shoppingTripFor(eraId: string, tag?: string): Promise<string> {
  const existing = (await db.todos.where('projectId').equals(eraId).toArray()).find(
    (t) => !t.deletedAt && !t.completedAt && t.shopping && (t.tag ?? '') === (tag ?? '')
  );
  if (existing) return existing.id;
  const era = await db.projects.get(eraId);
  const id = await createTodo(`Shopping: ${tag ?? era?.name ?? 'list'}`, { projectId: eraId, tag });
  await updateTodo(id, { shopping: true });
  return id;
}
