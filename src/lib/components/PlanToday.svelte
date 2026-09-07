<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import { addToDay, removeFromDay, DayFullError } from '$lib/day';
  import { today } from '$lib/store';
  import type { Day } from '$lib/types';

  /**
   * "Today I want to varnish the wood in my campervan."
   *
   * You already know what the job is — it is written down — and the only thing
   * missing was a way to say "that one, today". Until now the ONLY route into
   * Today's three was the Free Time flow, which asks how long you have and what
   * your head is like before it suggests something. That is the right tool when
   * you are looking for an answer and the wrong one when you already have it.
   *
   * This writes to `Day.slots`, the real mechanic, and not to `Todo.date`.
   * A date is an obligation marker — the thing you promised someone — and it
   * feeds the obligation slot rather than putting anything on the screen. What
   * was asked for is "I see it there in the today section", which is the slots.
   *
   * THE THREE ARE STILL THREE. addToDay throws once the day is full, which is
   * the whole unlock mechanic (spec 5.3): a fourth is impossible in advance,
   * not discouraged. So a full day says so plainly and offers nothing, rather
   * than quietly failing or growing a fourth slot here.
   */
  let { todoId }: { todoId: string } = $props();

  // Read-only: getDay rather than ensureDay, so looking at a to-do never
  // creates a day record. An untouched day is absent, not an empty plan.
  const dayQ = liveQuery(async () => db.days.where('date').equals(today()).first());
  const day = $derived($dayQ as Day | undefined);

  const on = $derived(!!day?.slots.includes(todoId));
  const full = $derived(!!day && day.slots.length >= day.unlockedCount);

  let refused = $state(false);

  async function plan() {
    refused = false;
    try {
      await addToDay(todoId);
    } catch (err) {
      // The cap is enforced in data, so this is reachable even though the
      // button is hidden when it is known to be full — two devices, one day.
      if (err instanceof DayFullError) refused = true;
      else throw err;
    }
  }
</script>

{#if on}
  <button
    class="press tap-h rounded-lg px-3 text-sm text-good"
    onclick={() => removeFromDay(todoId)}
  >
    ✓ On today — take it off
  </button>
{:else if full}
  <!-- A statement, not a refusal to be argued with. The fourth is earned by
       finishing the three, which the day-close screen offers. -->
  <p class="footnote">Today already has its three.</p>
{:else}
  <button class="press tap-h rounded-lg px-3 text-sm text-accent" onclick={plan}>
    Do it today
  </button>
{/if}

{#if refused}
  <p class="footnote mt-1">Today filled up. Three is the day.</p>
{/if}
