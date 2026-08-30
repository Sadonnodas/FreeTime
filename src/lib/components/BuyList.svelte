<script lang="ts">
  import type { BuyItem, Project } from '$lib/types';
  import { markPurchased, updateBuyItem, softDelete, toggleBuyNeeded } from '$lib/store';
  import { money } from '$lib/format';

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
    showProject = true
  }: {
    items: BuyItem[];
    projects?: Project[];
    showProject?: boolean;
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

  let armed = $state<string | null>(null);
  async function remove(item: BuyItem) {
    if (armed !== item.id) {
      armed = item.id;
      setTimeout(() => (armed = armed === item.id ? null : armed), 4000);
      return;
    }
    armed = null;
    if (openId === item.id) openId = null;
    await softDelete('buyItems', item.id);
  }
</script>

<ul class="space-y-1">
  {#each items as item (item.id)}
    <li class="card-flat px-3 py-1">
      <div class="flex items-center gap-3">
        <button
          class="press tap shrink-0 {item.purchasedAt ? 'text-good' : 'text-ink-400'}"
          onclick={() => markPurchased(item.id, !item.purchasedAt)}
          aria-label={item.purchasedAt ? 'Mark not bought' : 'Mark bought'}
        >
          {item.purchasedAt ? '✓' : '○'}
        </button>

        <button
          class="min-w-0 flex-1 py-2 text-left"
          onclick={() => (openId = openId === item.id ? null : item.id)}
        >
          <p class={item.purchasedAt ? 'text-ink-400 line-through' : ''}>{item.name}</p>
          {#if showProject ? projectName(item.projectId) || host(item.url) : host(item.url)}
            <p class="footnote truncate">
              {[showProject ? projectName(item.projectId) : null, host(item.url)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          {/if}
        </button>

        {#if item.priceCents != null}
          <span class="shrink-0 text-sm tabular-nums text-ink-400">
            {money(item.priceCents, item.currency)}
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
              inputmode="decimal"
              value={priceText(item.priceCents)}
              onchange={(e) =>
                updateBuyItem(item.id, { priceCents: parsePrice(e.currentTarget.value) })}
              placeholder="Price"
              class="field w-28 shrink-0 text-sm"
            />
            <input
              value={item.url ?? ''}
              onchange={(e) =>
                updateBuyItem(item.id, { url: e.currentTarget.value.trim() || undefined })}
              placeholder="Where from — a link"
              class="field min-w-0 flex-1 text-sm"
            />
          </div>

          {#if showProject}
            <div class="flex flex-wrap gap-2">
              <button
                class="chip press {item.projectId ? '' : 'chip-on'}"
                onclick={() => updateBuyItem(item.id, { projectId: undefined })}
              >
                No project
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
            <button
              class="press tap-h rounded-lg px-3 text-sm {armed === item.id
                ? 'text-accent-2'
                : 'text-ink-400'}"
              onclick={() => remove(item)}
            >
              {armed === item.id ? 'Really remove?' : 'Remove'}
            </button>
          </div>
        </div>
      {/if}
    </li>
  {/each}
</ul>
