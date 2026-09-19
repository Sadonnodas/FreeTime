<script lang="ts">
  import type { BuyItem, Project } from '$lib/types';
  import { markPurchased, updateBuyItem, softDelete } from '$lib/store';
  import { setOnList } from '$lib/shoppingList';
  import RenameField from '$lib/components/RenameField.svelte';
  import { money } from '$lib/format';
  import PhotoThumb from './PhotoThumb.svelte';
  import PhotoPicker from './PhotoPicker.svelte';
  import RemoveButton from './RemoveButton.svelte';
  import { tintFor } from '$lib/colors';
  import { rankedReorder } from '$lib/reorder.svelte';
  import { flip } from 'svelte/animate';

  /**
   * The buy list, shared by Brain and by a project's Buy tab so the two cannot
   * drift apart.
   *
   * ADD WITH ONE FIELD, ENRICH LATER. The price, the shop and the project are
   * all optional and all live behind a tap on the row — the same shape as a
   * voice memo, which saves the instant you stop and asks for a name
   * afterwards. Putting three fields in the add form would make writing down
   * "gaffer tape" a small chore, and a list that is a chore to add to stops
   * getting added to.
   */
  let {
    items,
    projects = [],
    sections = [],
    showProject = true,
    groupBy = 'none',
    tinted = false,
    inList = false,
    ontakeoff
  }: {
    items: BuyItem[];
    projects?: Project[];
    /** The projects inside an era, when this list is showing one era's parts. */
    sections?: string[];
    showProject?: boolean;
    groupBy?: GroupBy;
    /**
     * Wash each row in its project's colour with its era's colour down the
     * edge — the same two colours, from the same helper, as Brain's to-dos, so
     * "the campervan's things" is a patch of one colour before a word is read.
     * Only where the list MIXES projects: inside one project every row would
     * wear the same colour, which says nothing. Needs `projects` to know the
     * eras.
     */
    tinted?: boolean;
    /**
     * Drawn INSIDE the shopping list. Removing a row there means "not on this
     * trip", never "this thing does not exist": the row's button becomes ✕
     * (take it off the list — it stays in its project), and Delete is offered
     * only for things that belong to no era, like groceries typed straight
     * into the list. A to-buy filed under a project can be deleted from that
     * project, not from here — *"it should not be so easy to remove to-buys
     * from other projects from within the shopping list."*
     */
    inList?: boolean;
    /** Told when a row is taken off the list, so the list can offer Undo. */
    ontakeoff?: (item: BuyItem) => void;
  } = $props();

  function takeOff(item: BuyItem) {
    if (openId === item.id) openId = null;
    void setOnList(item.id, false);
    ontakeoff?.(item);
  }

  const placeOf = (item: BuyItem) =>
    [projectName(item.projectId), item.projectId ? item.tag : undefined].filter(Boolean).join(' · ');

  const tintOf = (item: BuyItem) =>
    tinted ? tintFor(projects.find((p) => p.id === item.projectId), item.tag) : undefined;

  let openId = $state<string | null>(null);

  /**
   * Hold and drag to put them in your own order (rank.ts). Only in an
   * UNGROUPED list: grouped by shop or project, a row dragged into another
   * group would snap back to its own, since what decides the group is where
   * it is bought, not where it was dropped.
   */
  const drag = rankedReorder('buyItems', () => items);

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name;

  /** Accepts "12.50", "12,50" and "12". Anything else leaves the price unset
   *  rather than guessing — a wrong number is worse than no number. */
  function parsePrice(raw: string): number | undefined {
    const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '').trim();
    if (!cleaned) return undefined;
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? Math.round(value * 100) : undefined;
  }

  const priceText = (cents?: number) => (cents == null ? '' : (cents / 100).toFixed(2));

  function parseQty(raw: string): number | undefined {
    const n = Number.parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n > 1 ? n : undefined;
  }


  /** The shop, shown as its domain — "bol.com" is more use at a glance than
   *  eighty characters of tracking parameters. */
  function host(url?: string): string | null {
    if (!url) return null;
    try {
      return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  const href = (url: string) => (url.startsWith('http') ? url : `https://${url}`);

  /**
   * Grouping by shop is the one that earns its keep.
   *
   * Five things across three projects that all come from the same shop are one
   * order and one delivery charge, not five — but that is invisible in a list
   * sorted by when you wrote them down. Grouping by shop makes the basket
   * obvious, and the subtotal beside it is what tells you whether you have
   * cleared the free-delivery threshold.
   *
   * Grouping by project answers the other question: what is this campervan
   * still going to cost me.
   */
  type GroupBy = 'none' | 'shop' | 'project' | 'tag';

  interface Group {
    key: string;
    label: string;
    items: BuyItem[];
    outstanding: number;
  }

  /**
   * What one line costs: the price of one, times how many.
   *
   * Storing the line total instead of the unit price was the alternative and it
   * is a trap — changing the quantity afterwards would leave the total saying
   * whatever it said before, and nothing on screen would look wrong.
   */
  export const lineTotal = (b: BuyItem) => (b.priceCents ?? 0) * (b.qty ?? 1);

  const outstandingOf = (rows: BuyItem[]) =>
    rows.filter((b) => !b.purchasedAt).reduce((sum, b) => sum + lineTotal(b), 0);

  /** Everything still to buy, across every group. */
  const total = $derived(outstandingOf(items));

  const grouped = $derived.by<Group[]>(() => {
    if (groupBy === 'none') {
      return [{ key: '', label: '', items, outstanding: 0 }];
    }

    const buckets = new Map<string, BuyItem[]>();
    for (const item of items) {
      const key =
        groupBy === 'shop'
          ? (host(item.url) ?? '')
          : groupBy === 'tag'
            ? (item.tag ?? '')
            : (projectName(item.projectId) ?? '');
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }

    return [...buckets]
      .map(([key, rows]) => ({
        key,
        label: key || (groupBy === 'shop' ? 'No shop yet' : 'No era'),
        items: rows,
        outstanding: outstandingOf(rows)
      }))
      .sort((a, b) => {
        // Unbucketed last: it is the pile still to be sorted, not a destination.
        if (!a.key !== !b.key) return a.key ? -1 : 1;
        // Then the fullest basket first, because that is where a combined
        // order actually saves something.
        const left = a.items.filter((i) => !i.purchasedAt).length;
        const right = b.items.filter((i) => !i.purchasedAt).length;
        return right - left || a.label.localeCompare(b.label);
      });
  });

</script>

{#each grouped as group (group.key)}
  {#if group.label}
    <div class="mt-4 mb-2 flex items-baseline justify-between gap-3">
      <h3 class="section-label truncate">{group.label}</h3>
      {#if group.outstanding > 0}
        <span class="footnote shrink-0 tabular-nums">{money(group.outstanding)}</span>
      {/if}
    </div>
  {/if}

  <ul class="space-y-1">
    {#each groupBy === 'none' ? drag.arrange(group.items) : group.items as item (item.id)}
    {@const tint = tintOf(item)}
    <li
      class="card-flat px-3 py-1 {tint ? 'row-tint' : ''}"
      style:--row={tint?.fill}
      style:--edge={tint?.edge}
      use:drag.item={{ id: item.id, off: groupBy !== 'none' || openId === item.id }}
      animate:flip={{ duration: drag.dragging === item.id ? 0 : 180 }}
    >
      <div class="flex items-center gap-3">
        <button
          class="press tap shrink-0 {item.purchasedAt ? 'text-good' : 'text-ink-400'}"
          onclick={() => markPurchased(item.id, !item.purchasedAt)}
          aria-label={item.purchasedAt ? 'Mark not bought' : 'Mark bought'}
        >
          {item.purchasedAt ? '✓' : '○'}
        </button>

        {#if item.image}
          <!-- A thumbnail, because "the bracket" and "the other bracket" are
               the same six words and not the same part. -->
          <PhotoThumb image={item.image} label={item.name} />
        {/if}

        <button
          class="min-w-0 flex-1 py-2 text-left"
          onclick={() => (openId = openId === item.id ? null : item.id)}
        >
          <p class={item.purchasedAt ? 'text-ink-400 line-through' : ''}>
            {item.name}{#if (item.qty ?? 1) > 1}<span class="text-ink-400">&nbsp;×{item.qty}</span>{/if}
          </p>
          {#if showProject ? projectName(item.projectId) || host(item.url) : host(item.url)}
            <p class="footnote truncate">
              {[showProject ? projectName(item.projectId) : null, showProject ? item.tag : null, host(item.url)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          {/if}
        </button>

        {#if item.priceCents != null}
          <!-- The LINE total, with the unit price under it only when there is
               more than one — otherwise the same number twice. -->
          <span class="shrink-0 text-right text-sm tabular-nums text-ink-400">
            {money(lineTotal(item), item.currency)}
            {#if (item.qty ?? 1) > 1}
              <span class="footnote block">{money(item.priceCents, item.currency)} ea</span>
            {/if}
          </span>
        {/if}

        <!--
          ON THE SHOPPING LIST, or not. This was a "needed soon" star, and
          "needed soon" is what a shopping list is — two controls for one idea
          is how the first shopping list became something nobody could follow.
          Still a flag and never a priority: on or off, and never setting it
          costs nothing. A basket rather than a star so it says what it does.
        -->
        {#if inList}
          <!-- In the list itself the question is "on this trip or not", and
               ✕ says remove where a basket would say nothing. Bought rows keep
               their tick and have nothing to take off. -->
          {#if !item.purchasedAt}
            <button
              class="press tap-h w-10 shrink-0 text-center text-[17px] text-ink-400"
              onclick={() => takeOff(item)}
              aria-label="Take {item.name} off the shopping list"
            >
              ✕
            </button>
          {/if}
        {:else}
        <button
          class="press tap-h w-10 shrink-0 text-center text-[18px] transition-[filter,opacity]
                 {item.needed ? '' : 'opacity-35 grayscale'}"
          onclick={() => setOnList(item.id, !item.needed)}
          aria-label={item.needed ? `Take ${item.name} off the shopping list` : `Put ${item.name} on the shopping list`}
          aria-pressed={!!item.needed}
        >
          🛒
        </button>
        {/if}
      </div>

      {#if openId === item.id}
        <div class="mt-1 space-y-2 border-t border-line-1 pt-3 pb-2">
          <!-- "the bracket" was the right name for about an hour. Everything
               here is written in one field at speed, so the name is the thing
               most likely to need fixing, and it was the one thing that set
               permanently on Add. -->
          <RenameField
            value={item.name}
            label="What to buy"
            onrename={(name) => updateBuyItem(item.id, { name })}
          />

          <div class="flex gap-2">
            <input
              inputmode="numeric"
              value={item.qty && item.qty > 1 ? String(item.qty) : ''}
              onchange={(e) => updateBuyItem(item.id, { qty: parseQty(e.currentTarget.value) })}
              placeholder="Qty"
              class="field w-20 shrink-0 text-sm"
            />
            <input
              inputmode="decimal"
              value={priceText(item.priceCents)}
              onchange={(e) =>
                updateBuyItem(item.id, { priceCents: parsePrice(e.currentTarget.value) })}
              placeholder="Price each"
              class="field min-w-0 flex-1 text-sm"
            />
          </div>

          <input
            value={item.url ?? ''}
            onchange={(e) =>
              updateBuyItem(item.id, { url: e.currentTarget.value.trim() || undefined })}
            placeholder="Where from — a link"
            class="field w-full text-sm"
          />

          <PhotoPicker
            image={item.image}
            onpick={(image) => updateBuyItem(item.id, { image })}
            onremove={() => updateBuyItem(item.id, { image: undefined })}
          />

          {#if showProject}
            <div class="flex flex-wrap gap-2">
              <button
                class="chip press {item.projectId ? '' : 'chip-on'}"
                onclick={() => updateBuyItem(item.id, { projectId: undefined })}
              >
                No era
              </button>
              {#each projects as p (p.id)}
                <button
                  class="chip press {item.projectId === p.id ? 'chip-on' : ''}"
                  onclick={() =>
                    updateBuyItem(item.id, {
                      projectId: item.projectId === p.id ? undefined : p.id,
                      // A project name belongs to ONE era; carrying it across
                      // would point at a project that does not exist there.
                      tag: undefined
                    })}
                >
                  {p.name}
                </button>
              {/each}
            </div>
            {@const eraTags = projects.find((p) => p.id === item.projectId)?.tags ?? []}
            {#if eraTags.length}
              <!-- And the project inside it. Items could only be filed to an
                   era from here, so a thing for the bedroom sat on "Home". -->
              <div class="flex flex-wrap gap-2">
                <button
                  class="chip press {item.tag ? '' : 'chip-on'}"
                  onclick={() => updateBuyItem(item.id, { tag: undefined })}
                >
                  No project
                </button>
                {#each eraTags as t (t)}
                  <button
                    class="chip press {item.tag === t ? 'chip-on' : ''}"
                    onclick={() => updateBuyItem(item.id, { tag: item.tag === t ? undefined : t })}
                  >
                    {t}
                  </button>
                {/each}
              </div>
            {/if}
          {/if}

          <div class="flex items-center gap-1">
            {#if item.url}
              <a
                href={href(item.url)}
                target="_blank"
                rel="noreferrer"
                class="press tap-h flex items-center rounded-lg px-3 text-sm text-accent"
              >
                Open shop
              </a>
            {/if}
            <span class="flex-1"></span>
            {#if inList && !item.purchasedAt}
              <button
                class="press tap-h rounded-lg px-3 text-sm text-accent"
                onclick={() => takeOff(item)}
              >
                Take off the list
              </button>
            {/if}
            {#if !inList || !item.projectId}
              <RemoveButton
                onremove={() => {
                  if (openId === item.id) openId = null;
                  void softDelete('buyItems', item.id);
                }}
              />
            {/if}
          </div>
          {#if inList && item.projectId}
            <!-- Why there is no Delete here: this belongs to a project, and
                 the list is only a view of it. -->
            <p class="footnote">
              Part of {placeOf(item)}. Taking it off the list keeps it there; to delete it
              altogether, open that project.
            </p>
          {/if}
        </div>
        {/if}
      </li>
    {/each}
  </ul>
{/each}

{#if total > 0}
  <!-- What the rest of this costs. A plain sum and never a budget: there is no
       target to be over, which is the same reason there are no progress bars
       anywhere in the app. -->
  <div class="mt-3 flex items-baseline justify-between gap-3 border-t border-line-1 pt-3">
    <span class="section-label">Still to buy</span>
    <span class="tabular-nums">{money(total)}</span>
  </div>
{/if}

