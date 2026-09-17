import { db } from './db';
import { ensureDay } from './day';
import { now, today, updateBuyItem } from './store';
import type { BuyItem, Day } from './types';

/**
 * THE shopping list — one, in Brain → Buy.
 *
 * Toon's design, after the first attempt (a to-do marked as a trip that
 * opened a project's To buy list) came back as *"I'm not really following how
 * to make a shopping list. It must be easier otherwise I will never use it."*
 * That attempt needed a project, a to-do, a checkbox and a 🛒 to find — four
 * ideas for "things to get at the shop".
 *
 * Now: a to-buy is ON the list or not (`BuyItem.needed`, which used to be a
 * "needed soon" star — the same thing said twice, so they became one). The
 * list opens from a button beside the era filter; things are added to it
 * there or from any to-buy row, and it can be given a DAY, on which it shows
 * on Today. Every item still belongs to whatever era and project it did, so
 * the list is a VIEW across everything and not a new place things live — the
 * two-levels rule stays intact.
 *
 * The day is `Day.shopping` on the day record, because days already sync and
 * a shopping trip is a fact about a day. At most one day carries it: setting a
 * new one clears the rest. A day in the past is simply ignored — nothing
 * becomes an overdue shop.
 */

/** Still to get: on the list and not bought. */
export const onList = (b: BuyItem): boolean => !!b.needed && !b.purchasedAt && !b.deletedAt;

/**
 * What the list shows: everything on it, plus what was ticked off it TODAY —
 * so a tick in the shop does not make the row vanish from under your thumb,
 * and the basket is still visible at the till.
 */
export function listItems(items: BuyItem[], day: string = today()): BuyItem[] {
  return items.filter(
    (b) =>
      !b.deletedAt &&
      !!b.needed &&
      (!b.purchasedAt || localDay(b.purchasedAt) === day)
  );
}

const localDay = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export async function setOnList(id: string, on: boolean): Promise<void> {
  await updateBuyItem(id, { needed: on || undefined });
}

/** The day the list is planned for, if that day is today or later. */
export function shoppingDate(days: Day[], from: string = today()): string | undefined {
  return days
    .filter((d) => d.shopping && !d.deletedAt && d.date >= from)
    .map((d) => d.date)
    .sort()[0];
}

/** Plan the list for a day, or for no day. Clears every other day. */
export async function setShoppingDate(date?: string): Promise<void> {
  const at = now();
  const marked = (await db.days.toArray()).filter((d) => d.shopping && d.date !== date);
  for (const d of marked) await db.days.update(d.id, { shopping: undefined, updatedAt: at });
  if (!date) return;
  const day = await ensureDay(date);
  if (!day.shopping) await db.days.update(day.id, { shopping: true, updatedAt: at });
}
