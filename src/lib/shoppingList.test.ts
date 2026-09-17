import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createBuyItem, markPurchased, today } from './store';
import { shiftDay } from './days';
import { listItems, onList, setOnList, setShoppingDate, shoppingDate } from './shoppingList';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('the shopping list', () => {
  it('holds what is put on it, and keeps today’s ticks visible', async () => {
    const milk = await createBuyItem('Milk');
    const eggs = await createBuyItem('Eggs');
    await createBuyItem('Drill');
    await setOnList(milk, true);
    await setOnList(eggs, true);
    await markPurchased(eggs, true);

    const all = await db.buyItems.toArray();
    expect(all.filter(onList).map((b) => b.name)).toEqual(['Milk']);
    expect(listItems(all).map((b) => b.name).sort()).toEqual(['Eggs', 'Milk']);
    // Bought on an earlier day: gone from the list.
    expect(listItems(all, shiftDay(today(), 1)).map((b) => b.name)).toEqual(['Milk']);

    await setOnList(milk, false);
    expect((await db.buyItems.get(milk))!.needed).toBeUndefined();
  });

  it('is planned for one day at a time, and never for the past', async () => {
    const tomorrow = shiftDay(today(), 1);
    const later = shiftDay(today(), 4);
    await setShoppingDate(tomorrow);
    expect(shoppingDate(await db.days.toArray())).toBe(tomorrow);

    await setShoppingDate(later);
    const days = await db.days.toArray();
    expect(days.filter((d) => d.shopping).map((d) => d.date)).toEqual([later]);
    expect(shoppingDate(days)).toBe(later);
    // Seen from after that day, there is no planned shop.
    expect(shoppingDate(days, shiftDay(later, 1))).toBeUndefined();

    await setShoppingDate(undefined);
    expect((await db.days.toArray()).some((d) => d.shopping)).toBe(false);
  });
});
