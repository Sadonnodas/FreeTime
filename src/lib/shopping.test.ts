import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createBuyItem, createProject, createTodo, markPurchased, completeTodo } from './store';
import { listFor, stillToBuy, shoppingTripFor, placeName } from './shopping';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('a to-do that opens a shopping list', () => {
  it("opens its project's To buy list and nobody else's", async () => {
    const home = await createProject('Home');
    await createBuyItem('Milk', { projectId: home, tag: 'Groceries' });
    await createBuyItem('Eggs', { projectId: home, tag: 'Groceries' });
    await createBuyItem('Paint', { projectId: home, tag: 'Bedroom' });
    await createBuyItem('Loose', { projectId: home });
    const items = await db.buyItems.toArray();

    const list = listFor({ projectId: home, tag: 'Groceries' }, items);
    expect(list.map((b) => b.name).sort()).toEqual(['Eggs', 'Milk']);
    // On the era with no project: the era's own items only, never every project's.
    expect(listFor({ projectId: home }, items).map((b) => b.name)).toEqual(['Loose']);
    // With no era there is no place, so no list.
    expect(listFor({}, items)).toEqual([]);
  });

  it('counts what is still to buy and sinks what is bought', async () => {
    const home = await createProject('Home');
    const milk = await createBuyItem('Milk', { projectId: home, tag: 'Groceries' });
    await createBuyItem('Eggs', { projectId: home, tag: 'Groceries' });
    await markPurchased(milk, true);
    const list = listFor({ projectId: home, tag: 'Groceries' }, await db.buyItems.toArray());
    expect(stillToBuy(list)).toBe(1);
    expect(list.at(-1)!.name).toBe('Milk');
  });

  it('reuses the open trip rather than making a second one', async () => {
    const home = await createProject('Home');
    const first = await shoppingTripFor(home, 'Groceries');
    expect(await shoppingTripFor(home, 'Groceries')).toBe(first);
    const trip = (await db.todos.get(first))!;
    expect(trip.shopping).toBe(true);
    expect(trip.tag).toBe('Groceries');
    expect(placeName(trip, [{ id: home, name: 'Home' }])).toBe('Groceries');

    // Once that trip is done, next week's is a new one.
    await completeTodo(first);
    expect(await shoppingTripFor(home, 'Groceries')).not.toBe(first);
  });

  it('does not take over an ordinary to-do in the same project', async () => {
    const home = await createProject('Home');
    const plain = await createTodo('Clean the fridge', { projectId: home, tag: 'Groceries' });
    expect(await shoppingTripFor(home, 'Groceries')).not.toBe(plain);
  });
});
