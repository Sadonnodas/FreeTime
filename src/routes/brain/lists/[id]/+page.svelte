<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { ListItem, ListItemState } from '$lib/types';
  import { addListItem, setListItemState, softDelete } from '$lib/store';

  /**
   * A list — books, albums, disc golf courses (spec 3.5).
   *
   * Structurally separate from to-dos, and nothing here ever appears on Today.
   * A book you want to read is a want, not a task; surfacing it as a task turns
   * it into a small debt. Reaching 'done' does still emit a win, because
   * finishing a book is genuinely finishing something.
   */
  const id = $derived(page.params.id!);

  const listQ = $derived(liveQuery(() => db.lists.get(id)));
  const itemsQ = $derived(
    liveQuery(async () =>
      (await db.listItems.where('listId').equals(id).toArray()).filter((i) => !i.deletedAt)
    )
  );

  let text = $state('');
  let url = $state('');
  let showUrl = $state(false);

  const STATES: { value: ListItemState; label: string }[] = [
    { value: 'want', label: 'Want' },
    { value: 'doing', label: 'Doing' },
    { value: 'done', label: 'Done' }
  ];

  const inState = (s: ListItemState) =>
    (($itemsQ as ListItem[] | undefined) ?? [])
      .filter((i) => i.state === s)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await addListItem(id, text, url.trim() || undefined);
    text = '';
    url = '';
    showUrl = false;
  }

  /** Cycles want → doing → done → want. One tap, no menu. */
  function nextState(s: ListItemState): ListItemState {
    return s === 'want' ? 'doing' : s === 'doing' ? 'done' : 'want';
  }
</script>

<div class="px-4 pt-safe pb-8">
  <header class="py-4">
    <a href="{base}/brain" class="press footnote inline-block">‹ Brain</a>
    <h1 class="large-title mt-1">
      {$listQ?.icon ?? ''}
      {$listQ?.name ?? ''}
    </h1>
  </header>

  <form onsubmit={add} class="mb-4">
    <div class="flex gap-2">
      <input
        bind:value={text}
        placeholder="Add something"
        class="field min-w-0 flex-1 "
      />
      <button
        type="button"
        class="press tap rounded-xl bg-white/8 px-3 text-sm text-ink-400"
        onclick={() => (showUrl = !showUrl)}
        aria-label="Add a link">🔗</button
      >
      <button class="btn btn-primary press">Add</button>
    </div>
    {#if showUrl}
      <input
        bind:value={url}
        placeholder="https://…"
        inputmode="url"
        class="field press mt-2 w-full "
      />
    {/if}
  </form>

  {#each STATES as group (group.value)}
    {@const items = inState(group.value)}
    {#if items.length}
      <section class="mb-6">
        <h2 class="section-label mb-2">
          {group.label} — {items.length}
        </h2>
        <ul class="space-y-1">
          {#each items as item (item.id)}
            <li class="card-flat flex items-center gap-2 px-3">
              <button
                class="press tap shrink-0 text-xs {item.state === 'done'
                  ? 'text-good'
                  : 'text-ink-400'}"
                onclick={() => setListItemState(item.id, nextState(item.state))}
                aria-label="Change state"
              >
                {item.state === 'done' ? '✓' : item.state === 'doing' ? '◐' : '○'}
              </button>
              <div class="min-w-0 flex-1 py-3">
                {#if item.url}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    class="block truncate text-accent"
                  >
                    {item.text}
                  </a>
                {:else}
                  <p class="truncate {item.state === 'done' ? 'text-ink-400' : ''}">
                    {item.text}
                  </p>
                {/if}
              </div>
              <button
                class="press tap shrink-0 px-1 text-ink-400"
                onclick={() => softDelete('listItems', item.id)}
                aria-label="Remove">×</button
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/each}

  {#if !(($itemsQ as ListItem[] | undefined) ?? []).length}
    <p class="footnote py-10 text-center">Nothing on this list yet.</p>
  {/if}
</div>
