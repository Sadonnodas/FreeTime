<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import { createBuyItem } from '$lib/store';
  import { listFor, stillToBuy } from '$lib/shopping';
  import type { BuyItem, Todo } from '$lib/types';
  import { portal } from '$lib/portal';
  import BuyList from './BuyList.svelte';

  /**
   * The list a shopping to-do opens — the To buy list of the place it lives
   * in, with nothing new holding the items (see shopping.ts).
   *
   * THE WHOLE SCREEN, because this is the thing held in one hand down a shop
   * aisle: a half-height sheet would spend the top of the phone on the page
   * behind it. Ticks, quantities and prices work exactly as they do in the
   * project, because it IS the project's list, drawn by the same component.
   *
   * There is an add field at the top, for the thing you remember standing in
   * front of the shelf. It files into the same place, so it is on the list the
   * next time too.
   *
   * Portalled to <body>, like the paper overlay: a Today card has `isolation`
   * and transforms on it for the walking dinosaur, and a fixed element inside
   * a transformed one is fixed to THAT, not to the screen.
   */
  let {
    todo,
    place,
    onclose
  }: { todo: Pick<Todo, 'projectId' | 'tag' | 'title'>; place: string; onclose: () => void } = $props();

  // Keyed on the ERA only, which re-files rarely; the project is narrowed
  // outside the query (the project screen's rename trap).
  const eraId = $derived(todo.projectId ?? '');
  const itemsQ = $derived.by(() => {
    const id = eraId;
    return liveQuery(async () => (id ? await db.buyItems.where('projectId').equals(id).toArray() : []));
  });
  const items = $derived(listFor(todo, ($itemsQ as BuyItem[] | undefined) ?? []));
  const left = $derived(stillToBuy(items));

  let draft = $state('');
  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!draft.trim() || !eraId) return;
    await createBuyItem(draft, { projectId: eraId, tag: todo.tag });
    draft = '';
  }
</script>

<div
  use:portal
  class="rise fixed inset-0 z-50 flex flex-col bg-ink-950 pt-safe pb-safe"
  role="dialog"
  aria-label="Shopping list for {place}"
>
  <header class="flex items-start gap-3 px-4 pt-3 pb-3">
    <div class="min-w-0 flex-1">
      <p class="section-label">Shopping list</p>
      <h2 class="mt-0.5 truncate text-[28px] leading-tight font-bold tracking-[-0.02em]">{place}</h2>
      <p class="footnote">
        {#if left}{left} still to buy{:else if items.length}All bought{:else}Nothing on it yet{/if}
        · for “{todo.title}”
      </p>
    </div>
    <button class="press tap shrink-0 px-2 text-[17px] font-semibold text-accent" onclick={onclose}>
      Done
    </button>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
    <form onsubmit={add} class="mb-3 flex gap-2">
      <input bind:value={draft} placeholder="Add to {place}" class="field min-w-0 flex-1" />
      <button class="btn btn-primary press">Add</button>
    </form>

    {#if items.length}
      <BuyList {items} showProject={false} groupBy="none" />
    {:else}
      <p class="footnote px-1">
        Write what you need here, or in the To buy section of {place}. It is the same list.
      </p>
    {/if}
  </div>
</div>
