<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import { onList, shoppingDate } from '$lib/shoppingList';
  import { dayLabel } from '$lib/days';
  import type { Day } from '$lib/types';
  import ShoppingList from './ShoppingList.svelte';

  /**
   * The way into the shopping list, with how much is on it.
   *
   * `chip` sits on Brain → Buy's filter row, beside the era filter — Toon's
   * placement. `row` is the line on Today on the day the list is planned for.
   */
  let { look = 'chip' }: { look?: 'chip' | 'row' | 'icon' } = $props();

  const countQ = liveQuery(async () => (await db.buyItems.toArray()).filter(onList).length);
  const daysQ = liveQuery(() => db.days.toArray());
  const count = $derived(($countQ as number | undefined) ?? 0);
  const planned = $derived(shoppingDate((($daysQ as Day[] | undefined) ?? []) as Day[]));
  let open = $state(false);
</script>

{#if look === 'chip'}
  <button
    type="button"
    class="press tap-h shrink-0 rounded-xl bg-accent/15 px-3 text-sm font-semibold text-accent"
    onclick={() => (open = true)}
  >
    🛒 Shopping list{count ? ` · ${count}` : ''}{planned ? ` · ${dayLabel(planned)}` : ''}
  </button>
{:else if look === 'icon'}
  <!-- Beside the Today title. The count is plain text in the button, never a
       red badge: a number of groceries is not something you are behind on. -->
  <button
    type="button"
    class="press relative flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full bg-surface-1 px-3 text-[20px]"
    onclick={() => (open = true)}
    aria-label={count ? `Shopping list, ${count} to get` : 'Shopping list'}
  >
    🛒{#if count}<span class="text-[13px] font-semibold text-ink-200 tabular-nums">{count}</span>{/if}
  </button>
{:else}
  <button
    type="button"
    class="card-flat press flex w-full items-center gap-3 px-3 py-3 text-left"
    onclick={() => (open = true)}
  >
    <span class="text-[22px]" aria-hidden="true">🛒</span>
    <span class="min-w-0 flex-1">
      <span class="block font-medium">Shopping list</span>
      <span class="footnote block">{count ? `${count} to get` : 'Nothing on it yet'}</span>
    </span>
    <span class="shrink-0 text-sm font-medium text-accent">Open</span>
  </button>
{/if}

{#if open}
  <ShoppingList onclose={() => (open = false)} />
{/if}
