<script lang="ts">
  import type { BuyItem, Project } from '$lib/types';
  import { markPurchased, updateBuyItem, softDelete, toggleBuyNeeded } from '$lib/store';
  import { money } from '$lib/format';
  import { resizeImage, THUMB_EDGE } from '$lib/images';
  import RemoveButton from './RemoveButton.svelte';

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
    groupBy = 'none'
  }: {
    items: BuyItem[];
    projects?: Project[];
    /** The projects inside an era, when this list is showing one era's parts. */
    sections?: string[];
    showProject?: boolean;
    groupBy?: GroupBy;
  } = $props();

  let openId = $state<string | null>(null);

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

  let uploadError = $state('');
  async function onPhoto(item: BuyItem, e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploadError = '';
    try {
      await updateBuyItem(item.id, { image: await resizeImage(file, THUMB_EDGE) });
    } catch (err) {
      uploadError = (err as Error).message;
    }
    // Lets the same file be picked twice running, which otherwise fires no
    // change event and looks like the app ignored the tap.
    input.value = '';
  }

  /** The photo opened full size. */
  let viewing = $state<BuyItem | null>(null);

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
  type GroupBy = 'none' | 'shop' | 'project';

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
    {#each group.items as item (item.id)}
    <li class="card-flat px-3 py-1">
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
          <button
            class="press h-10 w-10 shrink-0 overflow-hidden rounded-lg"
            onclick={() => (viewing = item)}
            aria-label="View photo of {item.name}"
          >
            <img src={item.image} alt="" class="h-full w-full object-cover" />
          </button>
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
              {[showProject ? projectName(item.projectId) : null, host(item.url)]
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
          Needed soon, as opposed to eventually. Deliberately a flag and not a
          priority: a scale is a second axis to maintain and feel bad about, and
          it always rots. This is on or off, it floats the item to the top, and
          never setting it costs nothing.
        -->
        <button
          class="press tap-h w-9 shrink-0 text-center {item.needed
            ? 'text-accent'
            : 'text-ink-600'}"
          onclick={() => toggleBuyNeeded(item.id, !item.needed)}
          aria-label={item.needed ? 'Not needed soon' : 'Needed soon'}
          aria-pressed={!!item.needed}
        >
          {item.needed ? '★' : '☆'}
        </button>
      </div>

      {#if openId === item.id}
        <div class="mt-1 space-y-2 border-t border-line-1 pt-3 pb-2">
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

          <div class="flex items-center gap-2">
            <label class="press tap flex flex-1 items-center justify-center rounded-xl bg-surface-2 text-sm">
              <input type="file" accept="image/*" class="hidden" onchange={(e) => onPhoto(item, e)} />
              <span class="text-accent">{item.image ? 'Change photo' : 'Add a photo'}</span>
            </label>
            {#if item.image}
              <button
                type="button"
                class="press tap-h rounded-lg px-3 text-sm text-ink-400"
                onclick={() => updateBuyItem(item.id, { image: undefined })}
              >
                Remove photo
              </button>
            {/if}
          </div>
          {#if uploadError}
            <p class="footnote text-accent-2">{uploadError}</p>
          {/if}

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
                      projectId: item.projectId === p.id ? undefined : p.id
                    })}
                >
                  {p.name}
                </button>
              {/each}
            </div>
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
            <RemoveButton
              onremove={() => {
                if (openId === item.id) openId = null;
                void softDelete('buyItems', item.id);
              }}
            />
          </div>
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

{#if viewing?.image}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="glass-strong rise fixed inset-0 z-50 flex flex-col"
    onclick={() => (viewing = null)}
  >
    <div class="flex items-center justify-between gap-3 px-4 pt-safe">
      <p class="section-label truncate py-3">{viewing.name}</p>
      <button
        class="press tap-h px-2 text-[22px] leading-none text-ink-400"
        onclick={() => (viewing = null)}
        aria-label="Close">×</button
      >
    </div>
    <div class="flex min-h-0 flex-1 items-center justify-center p-3 pb-safe">
      <img src={viewing.image} alt={viewing.name} class="max-h-full max-w-full object-contain" />
    </div>
  </div>
{/if}
