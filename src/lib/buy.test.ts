import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createBuyItem, updateBuyItem, markPurchased, createTodo, updateTodo } from './store';
import type { BuyItem } from './types';

/**
 * The unit price is stored, never the line total.
 *
 * Storing the line total was the alternative and it is a quiet trap: changing
 * the quantity afterwards would leave the total saying whatever it said before,
 * and nothing on screen would look wrong.
 */
const lineTotal = (b: BuyItem) => (b.priceCents ?? 0) * (b.qty ?? 1);
const outstanding = (rows: BuyItem[]) =>
  rows.filter((b) => !b.purchasedAt).reduce((sum, b) => sum + lineTotal(b), 0);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('a shopping list that adds up', () => {
  it('multiplies the unit price by the quantity', async () => {
    const id = await createBuyItem('Piezo discs', { priceCents: 250, qty: 8 });
    const item = (await db.buyItems.get(id))!;
    expect(lineTotal(item)).toBe(2000);
  });

  it('treats an unset quantity as one', async () => {
    const id = await createBuyItem('Soldering iron', { priceCents: 3499 });
    const item = (await db.buyItems.get(id))!;
    expect(item.qty).toBeUndefined();
    expect(lineTotal(item)).toBe(3499);
  });

  it('follows the quantity when it changes, rather than freezing a total', async () => {
    const id = await createBuyItem('M3 bolts', { priceCents: 15, qty: 10 });
    await updateBuyItem(id, { qty: 40 });
    expect(lineTotal((await db.buyItems.get(id))!)).toBe(600);
  });

  it('counts only what is still to buy', async () => {
    const a = await createBuyItem('Piezo discs', { priceCents: 250, qty: 8 });
    const b = await createBuyItem('Enclosure', { priceCents: 1200 });
    await markPurchased(b, true);

    const rows = await db.buyItems.toArray();
    expect(outstanding(rows)).toBe(2000);
    expect(rows.find((r) => r.id === a)!.qty).toBe(8);
  });

  it('costs nothing for an item with no price', async () => {
    await createBuyItem('Gaffer tape', { qty: 3 });
    expect(outstanding(await db.buyItems.toArray())).toBe(0);
  });
});

/**
 * A photo attaches to a to-do the same way it attaches to a shopping item, and
 * removing one has to actually remove it.
 *
 * Dexie's update() with undefined DELETES the property, which is what makes
 * "Remove photo" work at all — and if it ever stopped doing that, the row
 * would keep tens of kilobytes of image inside todos.json forever while the
 * screen showed no photo at all. The same assertion guards deleted memos'
 * audio; see memos.test.ts.
 */
describe('a photo on a row', () => {
  const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('attaches to a to-do and comes off again', async () => {
    const id = await createTodo('Fix the failing test');
    await updateTodo(id, { image: dataUrl });
    expect((await db.todos.get(id))!.image).toBe(dataUrl);

    await updateTodo(id, { image: undefined });
    const bare = (await db.todos.get(id))!;
    expect(bare.image).toBeUndefined();
    expect('image' in bare).toBe(false);
  });

  it('attaches to a buy item and comes off again', async () => {
    const id = await createBuyItem('That bracket');
    await updateBuyItem(id, { image: dataUrl });
    expect((await db.buyItems.get(id))!.image).toBe(dataUrl);

    await updateBuyItem(id, { image: undefined });
    expect('image' in (await db.buyItems.get(id))!).toBe(false);
  });
});
