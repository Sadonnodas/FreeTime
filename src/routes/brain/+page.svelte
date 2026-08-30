<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Capture, Todo, Idea, List, BuyItem, Project, Energy, Memo } from '$lib/types';
  import {
    sortCaptureToTodo, sortCaptureToIdea, promoteIdea, createList, completeTodo,
    createTodo, createIdea, createBuyItem
  } from '$lib/store';
  import { activeProjects } from '$lib/queries';
  import { allMemos, storageUse, mb, type StorageUse } from '$lib/memos';
  import MemoList from '$lib/components/MemoList.svelte';
  import MemoRecorder from '$lib/components/MemoRecorder.svelte';
  import MemoMap from '$lib/components/MemoMap.svelte';
  import BuyList from '$lib/components/BuyList.svelte';
  import { canRecord } from '$lib/audio';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { base } from '$app/paths';

  /**
   * The memory bank. It should feel well-stocked, never overdue — so there are
   * no counts styled as warnings, no red badges, and nothing here is late.
   */
  type Section = 'inbox' | 'todos' | 'ideas' | 'lists' | 'buy' | 'memos';
  const SECTIONS: Section[] = ['inbox', 'todos', 'ideas', 'memos', 'lists', 'buy'];

  /**
   * ?section= lets something else land you on the right tab — the assistant's
   * "Open the buy list" link, and any bookmark. An unrecognised value falls
   * back to the inbox rather than showing nothing.
   */
  const requested = page.url.searchParams.get('section') as Section | null;
  let section = $state<Section>(
    requested && SECTIONS.includes(requested) ? requested : 'inbox'
  );

  const inboxQ = liveQuery(async () =>
    (await db.captures.toArray())
      .filter((c) => !c.deletedAt && !c.sortedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );
  const todosQ = liveQuery(async () =>
    (await db.todos.toArray()).filter((t) => !t.deletedAt)
  );
  const ideasQ = liveQuery(async () =>
    (await db.ideas.toArray()).filter((i) => !i.deletedAt)
  );
  const listsQ = liveQuery(async () => (await db.lists.toArray()).filter((l) => !l.deletedAt));
  const listItemsQ = liveQuery(async () =>
    (await db.listItems.toArray()).filter((i) => !i.deletedAt)
  );
  const buyQ = liveQuery(async () => (await db.buyItems.toArray()).filter((b) => !b.deletedAt));
  const projectsQ = liveQuery(() => activeProjects());
  const memosQ = liveQuery(() => allMemos());

  let recording = $state(false);
  const recordable = canRecord();

  // List or map. Kept local rather than in the URL: which way you were last
  // looking at your recordings is not worth a navigation entry.
  let memoView = $state<'list' | 'map'>('list');
  /** The pin that was tapped, shown as a sheet over the map. */
  let pinned = $state<Memo[] | null>(null);

  // Recordings are the only thing here big enough to be worth a number, and
  // only because the browser can evict them. Shown as plain information, never
  // as a bar or a warning.
  let storage = $state<StorageUse | null>(null);
  onMount(async () => {
    storage = await storageUse();
  });

  // Filters for All to-dos (spec 4.3): project, energy, has-date. No priority
  // filter, because there is no priority field.
  let fProject = $state('');
  let fEnergy = $state<'' | Energy>('');
  let fDated = $state<'' | 'yes' | 'no'>('');
  let showClosed = $state(false);

  const filteredTodos = $derived(
    (($todosQ as Todo[] | undefined) ?? [])
      .filter((t) => (showClosed ? true : !t.completedAt))
      .filter((t) => (fProject ? t.projectId === fProject : true))
      .filter((t) => (fEnergy ? t.energy === fEnergy : true))
      .filter((t) => (fDated === 'yes' ? !!t.date : fDated === 'no' ? !t.date : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  const projectName = (id?: string) =>
    (($projectsQ as Project[] | undefined) ?? []).find((p) => p.id === id)?.name;

  async function newList() {
    const name = prompt('List name');
    if (name?.trim()) await createList(name);
  }

  /**
   * Every section can be added to directly. Only Lists could before, which made
   * To-dos, Ideas and Buy read-only views of things you had to have captured
   * somewhere else first.
   *
   * One field each, same as the capture box — no project picker, no date, no
   * confirmation. The one bit of cleverness: if a project filter is active on
   * the To-dos section, a new to-do joins that project, because that is
   * unambiguously what you meant while looking at a filtered list.
   */
  let newTodoText = $state('');
  let newIdeaText = $state('');
  let newBuyText = $state('');

  async function addTodo(e: SubmitEvent) {
    e.preventDefault();
    const title = newTodoText.trim();
    if (!title) return;
    newTodoText = '';
    await createTodo(title, {
      projectId: fProject || undefined,
      energy: fEnergy || undefined
    });
  }

  async function addIdea(e: SubmitEvent) {
    e.preventDefault();
    const text = newIdeaText.trim();
    if (!text) return;
    newIdeaText = '';
    await createIdea(text);
  }

  /** Same rule as the to-do filter above: whatever project you are looking at
   *  is where a new one lands, so filing is a side effect of where you are. */
  let fBuyProject = $state('');

  async function addBuy(e: SubmitEvent) {
    e.preventDefault();
    const name = newBuyText.trim();
    if (!name) return;
    newBuyText = '';
    await createBuyItem(name, { projectId: fBuyProject || undefined });
  }

  const filteredBuy = $derived(
    (($buyQ as BuyItem[] | undefined) ?? [])
      .filter((b) => (fBuyProject ? b.projectId === fBuyProject : true))
      // Bought things stay, but they sink: the list is for what you still need.
      .sort((a, b) =>
        (a.purchasedAt ? 1 : 0) - (b.purchasedAt ? 1 : 0) ||
        b.createdAt.localeCompare(a.createdAt)
      )
  );
</script>

<div class="px-4 pt-safe pb-8">
  <header class="pt-3 pb-5">
    <h1 class="large-title">Brain</h1>
  </header>

  <div class="segmented no-bar mb-4 overflow-x-auto">
    {#each [['inbox', 'Inbox'], ['todos', 'To-dos'], ['ideas', 'Ideas'], ['memos', 'Memos'], ['lists', 'Lists'], ['buy', 'Buy']] as const as [key, label]}
      <button
        class="press segment shrink-0 px-2 {section === key ? 'segment-on' : ''}"
        onclick={() => (section = key)}
      >{label}</button>
    {/each}
  </div>

  {#if section === 'inbox'}
    <!-- Leaving things unsorted is not a failure state, so this list has no
         "clear inbox" goal and no count-down. It does say what it is, though:
         "inbox" on its own reads like email, which implies a queue to empty. -->
    <p class="footnote mb-3">
      Whatever you typed or said into the box at the bottom of Today lands here,
      unsorted. Give it a home when you feel like it — or don't.
    </p>
    {#each ($inboxQ as Capture[] | undefined) ?? [] as c (c.id)}
      <div class="card rise mb-2 p-4">
        <p class="mb-2">{c.text}</p>
        <div class="flex gap-2">
          <button
            class="press tap rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
            onclick={() => sortCaptureToTodo(c.id)}>→ To-do</button
          >
          <button
            class="press tap rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
            onclick={() => sortCaptureToIdea(c.id)}>→ Idea</button
          >
        </div>
      </div>
    {:else}
      <p class="py-8 text-center text-sm text-ink-400">Nothing waiting.</p>
    {/each}
  {:else if section === 'todos'}
    <form onsubmit={addTodo} class="mb-3 flex gap-2">
      <input bind:value={newTodoText} placeholder="Add a to-do" class="field min-w-0 flex-1" />
      <button class="btn btn-primary press" disabled={!newTodoText.trim()}>Add</button>
    </form>

    <div class="mb-3 flex flex-wrap gap-2 text-sm">
      <select
        bind:value={fProject}
        class="field press"
      >
        <option value="">All projects</option>
        {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      <select
        bind:value={fEnergy}
        class="field press"
      >
        <option value="">Any energy</option>
        <option value="quick">Quick</option>
        <option value="moderate">Moderate</option>
        <option value="focus">Focus</option>
      </select>
      <select
        bind:value={fDated}
        class="field press"
      >
        <option value="">Dated or not</option>
        <option value="yes">Has a date</option>
        <option value="no">No date</option>
      </select>
      <button
        class="press tap rounded-xl border border-line-1 px-3 text-sm {showClosed
          ? 'text-good'
          : 'text-ink-400'}"
        onclick={() => (showClosed = !showClosed)}
      >
        {showClosed ? 'Showing closed' : 'Show closed'}
      </button>
    </div>

    <ul class="space-y-1">
      {#each filteredTodos as t (t.id)}
        <li class="card-flat flex items-center gap-3 px-3">
          <button
            class="press tap shrink-0 {t.completedAt ? 'text-good' : 'text-ink-400'}"
            onclick={() => !t.completedAt && completeTodo(t.id)}
            aria-label="Complete">{t.completedAt ? '✓' : '○'}</button
          >
          <div class="flex-1 py-3">
            <p class={t.completedAt ? 'text-ink-400 line-through' : ''}>{t.title}</p>
            {#if projectName(t.projectId) || t.tag || t.energy || t.date}
              <p class="text-xs text-ink-400">
                {[projectName(t.projectId), t.tag, t.energy, t.date].filter(Boolean).join(' · ')}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {:else if section === 'ideas'}
    <form onsubmit={addIdea} class="mb-3 flex gap-2">
      <input bind:value={newIdeaText} placeholder="A thought, no action attached" class="field min-w-0 flex-1" />
      <button class="btn btn-primary press" disabled={!newIdeaText.trim()}>Add</button>
    </form>

    <ul class="space-y-1">
      {#each ($ideasQ as Idea[] | undefined) ?? [] as i (i.id)}
        <li class="card-flat flex items-center gap-3 px-3">
          <span class="flex-1 py-3">{i.text}</span>
          {#if i.promotedToTodoId}
            <span class="text-xs text-good">→ to-do</span>
          {:else}
            <button
              class="press tap rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
              onclick={() => promoteIdea(i.id)}>Promote</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else if section === 'memos'}
    <!-- The whole library. Grouped by month, because "somewhere in August" is
         how a recording actually gets remembered. -->
    {#if recordable}
      <button
        class="press tap mb-3 flex w-full items-center justify-center gap-2 rounded-2xl
               bg-surface-2 text-[15px] font-medium text-ink-50"
        onclick={() => (recording = true)}
      >
        <span class="text-red-400">●</span> Record
      </button>
    {/if}

    {#if (($memosQ as Memo[] | undefined) ?? []).length}
      <div class="segmented mb-4">
        <button
          class="press segment {memoView === 'list' ? 'segment-on' : ''}"
          onclick={() => (memoView = 'list')}>List</button
        >
        <button
          class="press segment {memoView === 'map' ? 'segment-on' : ''}"
          onclick={() => (memoView = 'map')}>Map</button
        >
      </div>

      {#if memoView === 'map'}
        <MemoMap
          memos={($memosQ as Memo[] | undefined) ?? []}
          projects={($projectsQ as Project[] | undefined) ?? []}
          onPick={(picked) => (pinned = picked)}
        />
      {:else}
        <MemoList
          memos={($memosQ as Memo[] | undefined) ?? []}
          projects={($projectsQ as Project[] | undefined) ?? []}
        />
      {/if}
      {#if storage}
        <p class="footnote mt-6">
          {mb(storage.usedBytes)} used on this device{storage.persisted
            ? ', kept safe from cleanup'
            : ''}.
        </p>
      {/if}
    {:else}
      <p class="py-8 text-center text-sm text-ink-400">
        Nothing recorded yet. Hum something.
      </p>
    {/if}
  {:else if section === 'lists'}
    <button class="press tap mb-3 rounded-xl bg-surface-2 px-4 text-[15px] text-ink-200" onclick={newList}>
      + New list
    </button>
    <ul class="space-y-1">
      {#each ($listsQ as List[] | undefined) ?? [] as l (l.id)}
        {@const items = (($listItemsQ as { listId: string; state: string }[] | undefined) ?? [])
          .filter((i) => i.listId === l.id)}
        <li>
          <a href="{base}/brain/lists/{l.id}" class="card-flat flex items-center gap-3 px-4 py-3">
            <span class="flex-1">{l.icon ?? '•'} {l.name}</span>
            <span class="text-xs text-ink-400">
              {items.filter((i) => i.state !== 'done').length} open
            </span>
            <span class="text-ink-400">›</span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <form onsubmit={addBuy} class="mb-3 flex gap-2">
      <input
        bind:value={newBuyText}
        placeholder={fBuyProject
          ? `Buy for ${projectName(fBuyProject)}`
          : 'Something to buy'}
        class="field min-w-0 flex-1"
      />
      <button class="btn btn-primary press" disabled={!newBuyText.trim()}>Add</button>
    </form>

    <div class="mb-3">
      <select bind:value={fBuyProject} class="field press">
        <option value="">All projects</option>
        {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </div>

    <BuyList items={filteredBuy} projects={($projectsQ as Project[] | undefined) ?? []} />
  {/if}
</div>

{#if recording}
  <MemoRecorder onDone={() => (recording = false)} />
{/if}

{#if pinned}
  <!-- What was recorded at one place. The same list rows as everywhere else, so
       playing, sharing and renaming all work without a second implementation. -->
  <div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
    <div class="flex items-center justify-between px-4 pt-safe">
      <span class="section-label py-3">
        {pinned.length} recording{pinned.length === 1 ? '' : 's'} here
      </span>
      <button
        class="press tap px-2 text-[22px] leading-none text-ink-400"
        onclick={() => (pinned = null)}
        aria-label="Close">×</button
      >
    </div>
    <div class="flex-1 overflow-y-auto px-4 pb-safe">
      <MemoList memos={pinned} projects={($projectsQ as Project[] | undefined) ?? []} />
      <div class="h-6"></div>
    </div>
  </div>
{/if}
