<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import { createBuyItem, today } from '$lib/store';
  import { activeProjects } from '$lib/queries';
  import { listItems, onList, setOnList, setShoppingDate, shoppingDate } from '$lib/shoppingList';
  import { tomorrow, dayLabel } from '$lib/days';
  import { tintFor } from '$lib/colors';
  import { byRank } from '$lib/rank';
  import { money } from '$lib/format';
  import type { BuyItem, Day, Project } from '$lib/types';
  import { portal } from '$lib/portal';
  import BuyList from './BuyList.svelte';
  import ListExport from './ListExport.svelte';
  import ProjectSelect from './ProjectSelect.svelte';

  /**
   * The shopping list, full screen — it is held in one hand down an aisle.
   *
   * Top to bottom, in the order you use it: WHEN (a day, which puts it on
   * Today), ADD (a new thing, optionally for an era and project), the LIST
   * itself, and under it EVERYTHING ELSE you have noted to buy, one tap each
   * to put on. See shoppingList.ts for why it is a view and not a place.
   */
  let { onclose }: { onclose: () => void } = $props();

  const itemsQ = liveQuery(async () => (await db.buyItems.toArray()).filter((b) => !b.deletedAt));
  const daysQ = liveQuery(() => db.days.toArray());
  const erasQ = liveQuery(() => activeProjects());

  const eras = $derived(($erasQ as Project[] | undefined) ?? []);
  const all = $derived(($itemsQ as BuyItem[] | undefined) ?? []);
  const todayIso = today();
  const planned = $derived(shoppingDate(($daysQ as Day[] | undefined) ?? [], todayIso));

  /** Era order, then the era's project order, so each project's things sit
   *  together in its colour — the same arrangement as Brain → Buy. */
  function byPlace(a: BuyItem, b: BuyItem): number {
    const rank = (x: BuyItem): [number, number] => {
      const ei = eras.findIndex((e) => e.id === x.projectId);
      if (ei < 0) return [Infinity, 0];
      const ti = x.tag ? (eras[ei].tags ?? []).indexOf(x.tag) : -1;
      return [ei, ti < 0 ? Infinity : ti];
    };
    const [ae, at] = rank(a);
    const [be, bt] = rank(b);
    if (ae !== be) return ae < be ? -1 : 1;
    if (at !== bt) return at < bt ? -1 : 1;
    // Within one project: your own order, so a drag here or anywhere else holds.
    return byRank(a, b);
  }

  const list = $derived(
    listItems(all, todayIso).sort(
      (a, b) => (a.purchasedAt ? 1 : 0) - (b.purchasedAt ? 1 : 0) || byPlace(a, b)
    )
  );
  const left = $derived(list.filter(onList));
  const cost = $derived(left.reduce((sum, b) => sum + (b.priceCents ?? 0) * (b.qty ?? 1), 0));
  const others = $derived(all.filter((b) => !b.needed && !b.purchasedAt).sort(byPlace));

  // --- adding
  let draft = $state('');
  let newEra = $state('');
  let newTag = $state('');
  const newEraTags = $derived(eras.find((e) => e.id === newEra)?.tags ?? []);
  $effect(() => {
    if (!newEraTags.includes(newTag)) newTag = '';
  });

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    draft = '';
    const id = await createBuyItem(name, {
      projectId: newEra || undefined,
      tag: newTag || undefined
    });
    await setOnList(id, true);
  }

  // --- taking something off, with a way back
  /**
   * The last thing taken off, for a few seconds. One tap removes a row from
   * the list, which is the right speed for "not on this trip" and the wrong
   * speed for a thumb that landed on the wrong row — so the list says what
   * went and offers it back.
   */
  let takenOff = $state<BuyItem | null>(null);
  let takenTimer: ReturnType<typeof setTimeout> | undefined;
  function offered(item: BuyItem) {
    takenOff = item;
    clearTimeout(takenTimer);
    takenTimer = setTimeout(() => (takenOff = null), 5000);
  }
  async function undoTakeOff() {
    const item = takenOff;
    takenOff = null;
    clearTimeout(takenTimer);
    if (item) await setOnList(item.id, true);
  }

  // --- the others
  let showOthers = $state(false);
  let search = $state('');
  const shownOthers = $derived(
    search.trim()
      ? others.filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase()))
      : others
  );
  const placeLabel = (b: BuyItem) =>
    [eras.find((e) => e.id === b.projectId)?.name, b.tag].filter(Boolean).join(' · ');

  const title = $derived(planned ? `Shopping list — ${dayLabel(planned, todayIso)}` : 'Shopping list');
</script>

<div
  use:portal
  class="rise fixed inset-0 z-50 flex flex-col bg-ink-950 pt-safe pb-safe"
  role="dialog"
  aria-label="Shopping list"
>
  <header class="flex items-start gap-3 px-4 pt-3 pb-2">
    <div class="min-w-0 flex-1">
      <h2 class="truncate text-[28px] leading-tight font-bold tracking-[-0.02em]">🛒 Shopping list</h2>
      <p class="footnote mt-0.5">
        {#if left.length}
          {left.length} to get{cost ? ` · ${money(cost)}` : ''}
        {:else if list.length}
          All in the basket.
        {:else}
          Nothing on it yet.
        {/if}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1 pt-1">
      <ListExport kind="buy" {title} rows={left} {eras} />
      <button class="press tap px-2 text-[17px] font-semibold text-accent" onclick={onclose}>
        Done
      </button>
    </div>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
    <!-- WHEN. A day puts the list on Today for that day; no day is fine. -->
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span class="section-label mr-1">When</span>
      <button
        class="chip press {planned ? '' : 'chip-on'}"
        onclick={() => setShoppingDate(undefined)}>No day</button
      >
      <button
        class="chip press {planned === todayIso ? 'chip-on' : ''}"
        onclick={() => setShoppingDate(todayIso)}>Today</button
      >
      <button
        class="chip press {planned === tomorrow(todayIso) ? 'chip-on' : ''}"
        onclick={() => setShoppingDate(tomorrow(todayIso))}>Tomorrow</button
      >
      <input
        type="date"
        min={todayIso}
        value={planned && planned > tomorrow(todayIso) ? planned : ''}
        class="field press text-sm {planned && planned > tomorrow(todayIso) ? 'ring-2 ring-accent' : ''}"
        aria-label="Another day"
        onchange={(e) => setShoppingDate(e.currentTarget.value || undefined)}
      />
    </div>

    <!-- ADD. One field; where it belongs is optional and only shows once
         there is something to file. -->
    <form onsubmit={add} class="mb-3">
      <div class="flex gap-2">
        <input bind:value={draft} placeholder="Add to the list" class="field min-w-0 flex-1" />
        <button class="btn btn-primary press" disabled={!draft.trim()}>Add</button>
      </div>
      {#if draft.trim()}
        <div class="mt-2 flex gap-2">
          <select bind:value={newEra} class="field press min-w-0 flex-1 text-sm" aria-label="Era">
            <option value="">No era</option>
            {#each eras as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
          <div class="min-w-0 flex-1">
            <ProjectSelect
              {eras}
              eraId={newEra || undefined}
              tag={newTag || undefined}
              noneLabel="Project"
              onpick={(era, tag) => {
                newEra = era ?? '';
                newTag = tag ?? '';
              }}
            />
          </div>
        </div>
      {/if}
    </form>

    {#if list.length}
      <BuyList items={list} projects={eras} tinted inList ontakeoff={offered} />
    {:else}
      <p class="footnote px-1 py-2">
        Add things above, or tap 🛒 on anything in Brain → Buy or a project's To buy.
      </p>
    {/if}

    <!-- EVERYTHING ELSE you have written down to buy, to put on in one tap. -->
    {#if others.length}
      <button
        class="press tap mt-6 flex w-full items-center gap-2 text-left"
        onclick={() => (showOthers = !showOthers)}
        aria-expanded={showOthers}
      >
        <span class="text-ink-400">{showOthers ? '▾' : '▸'}</span>
        <span class="section-label">Add from your to-buys</span>
        <span class="footnote">{others.length}</span>
      </button>
      {#if showOthers}
        {#if others.length > 8}
          <input bind:value={search} placeholder="Find one" class="field mb-2 w-full" />
        {/if}
        <ul class="space-y-1">
          {#each shownOthers as b (b.id)}
            {@const tint = tintFor(eras.find((e) => e.id === b.projectId), b.tag)}
            <li>
              <button
                class="card-flat press flex w-full items-center gap-3 px-3 py-2.5 text-left {tint ? 'row-tint' : ''}"
                style:--row={tint?.fill}
                style:--edge={tint?.edge}
                onclick={() => setOnList(b.id, true)}
              >
                <span class="min-w-0 flex-1">
                  <span class="block">{b.name}{#if (b.qty ?? 1) > 1}<span class="text-ink-400">&nbsp;×{b.qty}</span>{/if}</span>
                  {#if placeLabel(b)}<span class="footnote block">{placeLabel(b)}</span>{/if}
                </span>
                <span class="shrink-0 text-sm font-medium text-accent">+ Add</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  {#if takenOff}
    <div class="flex items-center gap-3 border-t border-line-1 px-4 py-3" role="status">
      <span class="min-w-0 flex-1 truncate text-sm">Took <b>{takenOff.name}</b> off the list</span>
      <button class="press tap-h shrink-0 px-2 text-sm font-semibold text-accent" onclick={undoTakeOff}>
        Undo
      </button>
    </div>
  {/if}
</div>
