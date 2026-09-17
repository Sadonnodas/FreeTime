<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import { addToDay, DayFullError } from '$lib/day';
  import { today } from '$lib/store';
  import { shoppingTripFor } from '$lib/shopping';
  import type { Day, Todo } from '$lib/types';

  /**
   * "Go shopping today", under a project's To buy list.
   *
   * The whole groceries flow in one tap: it finds this list's open shopping
   * to-do (or writes one) and puts it in today's three, so the list is on
   * Today behind a 🛒 when you leave the house. The three are still three —
   * a full day says so, as PlanToday does.
   */
  let { eraId, tag }: { eraId: string; tag?: string } = $props();

  const dayQ = liveQuery(async () => db.days.where('date').equals(today()).first());
  const day = $derived($dayQ as Day | undefined);
  const full = $derived(!!day && day.slots.length >= day.unlockedCount);

  /** Whether this list's open trip is already among today's three — read,
   *  not remembered, so a trip planned elsewhere says so here too. */
  const tripsQ = $derived.by(() => {
    const id = eraId;
    return liveQuery(async () =>
      (await db.todos.where('projectId').equals(id).toArray()).filter(
        (t) => !t.deletedAt && !t.completedAt && t.shopping
      )
    );
  });
  const onToday = $derived(
    (($tripsQ as Todo[] | undefined) ?? []).some(
      (t) => (t.tag ?? '') === (tag ?? '') && !!day?.slots.includes(t.id)
    )
  );

  let refused = $state(false);

  async function go() {
    refused = false;
    const id = await shoppingTripFor(eraId, tag);
    try {
      await addToDay(id);
    } catch (err) {
      if (err instanceof DayFullError) refused = true;
      else throw err;
    }
  }
</script>

{#if onToday}
  <p class="footnote mt-3 text-good">✓ On Today, with this list behind it.</p>
{:else if full || refused}
  <p class="footnote mt-3">Today already has its three. The list is still right here.</p>
{:else}
  <button class="press tap-h mt-3 rounded-lg px-3 text-sm text-accent" onclick={go}>
    🛒 Go shopping today
  </button>
{/if}
