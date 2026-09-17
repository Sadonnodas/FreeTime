<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import { listFor, stillToBuy } from '$lib/shopping';
  import type { BuyItem, Todo } from '$lib/types';
  import ShoppingSheet from './ShoppingSheet.svelte';

  /**
   * "🛒 5 to buy" on a shopping to-do, opening its list.
   *
   * A sibling of the row's own button wherever it sits, never inside it: every
   * row here is one big button that opens its editor, and a button inside a
   * button silently stops working — the PhotoThumb rule.
   *
   * Says the count rather than "Open list", because the number is the thing
   * you want to know before you go.
   */
  let {
    todo,
    place,
    size = 'sm'
  }: { todo: Pick<Todo, 'projectId' | 'tag' | 'title'>; place: string; size?: 'sm' | 'xs' } = $props();

  // Keyed on the ERA only, which re-files rarely; the project is narrowed
  // outside the query (the project screen's rename trap).
  const eraId = $derived(todo.projectId ?? '');
  const itemsQ = $derived.by(() => {
    const id = eraId;
    return liveQuery(async () => (id ? await db.buyItems.where('projectId').equals(id).toArray() : []));
  });
  const left = $derived(stillToBuy(listFor(todo, ($itemsQ as BuyItem[] | undefined) ?? [])));
  let open = $state(false);
</script>

{#if eraId}
  <button
    class="press tap-h shrink-0 rounded-full bg-surface-2 px-3 font-medium text-accent
           {size === 'xs' ? 'text-xs' : 'text-sm'}"
    onclick={() => (open = true)}
    aria-label="Open the shopping list for {place}"
  >
    🛒 {left ? `${left} to buy` : 'List'}
  </button>
  {#if open}
    <ShoppingSheet {todo} {place} onclose={() => (open = false)} />
  {/if}
{/if}
