<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Todo, Idea, BuyItem, Project, Energy, Memo } from '$lib/types';
  import {
    promoteIdea, completeTodo, createTodo, createIdea, createBuyItem,
    setIdeaGroup, toggleIdeaDone, renameIdeaGroup
  } from '$lib/store';
  import { activeProjects, ideaGroups } from '$lib/queries';
  import { allMemos, storageUse, mb, type StorageUse } from '$lib/memos';
  import MemoList from '$lib/components/MemoList.svelte';
  import MemoRecorder from '$lib/components/MemoRecorder.svelte';
  import MemoMap from '$lib/components/MemoMap.svelte';
  import BuyList from '$lib/components/BuyList.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import { canRecord } from '$lib/audio';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { base } from '$app/paths';

  /**
   * The memory bank. It should feel well-stocked, never overdue — so there are
   * no counts styled as warnings, no red badges, and nothing here is late.
   */
  /**
   * Four kinds, not six.
   *
   * Inbox and Lists both folded into Ideas, because all three were the same
   * shape: a thought with no action attached. An unfiled capture is one you
   * have not decided about; "read Sapiens" is one you never will. Keeping them
   * in separate tabs meant sorting needed two buttons where one does, and it
   * left an empty Lists tab looking like a feature you were failing to use.
   *
   * What is left is genuinely four different things: to do, thought, to get,
   * said out loud.
   */
  type Section = 'todos' | 'ideas' | 'buy' | 'memos';
  const SECTIONS: Section[] = ['todos', 'ideas', 'buy', 'memos'];

  /**
   * ?section= lets something else land you on the right tab — the assistant's
   * "Open the buy list" link, and any bookmark. The two retired names still
   * resolve, so an old link lands where its contents went rather than nowhere.
   */
  const RETIRED: Record<string, Section> = { inbox: 'ideas', lists: 'ideas' };
  const requested = page.url.searchParams.get('section') ?? '';
  let section = $state<Section>(
    SECTIONS.includes(requested as Section)
      ? (requested as Section)
      : (RETIRED[requested] ?? 'todos')
  );
  const todosQ = liveQuery(async () =>
    (await db.todos.toArray()).filter((t) => !t.deletedAt)
  );
  const ideasQ = liveQuery(async () =>
    (await db.ideas.toArray()).filter((i) => !i.deletedAt)
  );
  const groupsQ = liveQuery(() => ideaGroups());
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

  /**
   * The collection chips over Ideas — Books, Albums, Lyrics.
   *
   * Same mechanic as a project's sections: the chip is both the filter and the
   * destination, so anything added while one is lit joins it. Groups are
   * derived from the ideas themselves, so a collection nobody puts anything in
   * simply stops existing — the old Lists tab could accumulate empty lists that
   * had to be tidied by hand.
   */
  let activeGroup = $state<string | null>(null);
  /** Distinct from "no group": null is All, '' is the unfiled ones. */
  let unfiledOnly = $state(false);
  let namingGroup = $state(false);
  let newGroupName = $state('');

  const groups = $derived(($groupsQ as string[] | undefined) ?? []);

  function useGroup(name: string | null, unfiled = false) {
    activeGroup = name;
    unfiledOnly = unfiled;
  }

  function addGroup(e: SubmitEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    newGroupName = '';
    namingGroup = false;
    // Nothing is created: a group is a label, so it exists as soon as the first
    // idea carries it. Lighting it here means the next thing typed lands in it.
    useGroup(name);
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
    await createIdea(text, { group: activeGroup ?? undefined });
  }

  const visibleIdeas = $derived(
    (($ideasQ as Idea[] | undefined) ?? [])
      .filter((i) => (activeGroup ? i.group === activeGroup : true))
      .filter((i) => (unfiledOnly ? !i.group : true))
      // Finished wants stay — nothing here is ever deleted — but they sink.
      .sort(
        (a, b) =>
          (a.doneAt ? 1 : 0) - (b.doneAt ? 1 : 0) || b.createdAt.localeCompare(a.createdAt)
      )
  );

  /** Same rule as the to-do filter above: whatever project you are looking at
   *  is where a new one lands, so filing is a side effect of where you are. */
  let fBuyProject = $state('');

  /**
   * How the buy list is arranged.
   *
   * By shop is the one worth having: five things across three projects that all
   * come from the same place are one order and one delivery charge, which a
   * list sorted by when you wrote them down hides completely.
   */
  let buyGroup = $state<'none' | 'shop' | 'project'>('none');
  const BUY_GROUPS = [
    { key: 'none', label: 'Recent' },
    { key: 'shop', label: 'By shop' },
    { key: 'project', label: 'By project' }
  ] as const;

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
        (b.needed ? 1 : 0) - (a.needed ? 1 : 0) ||
        b.createdAt.localeCompare(a.createdAt)
      )
  );
</script>

<div class="px-4 pt-safe pb-8">
  <header class="pt-3 pb-5">
    <h1 class="large-title">Brain</h1>
  </header>

  <div class="segmented mb-4">
    {#each [['todos', 'To-dos'], ['ideas', 'Ideas'], ['buy', 'Buy'], ['memos', 'Memos']] as const as [key, label]}
      <button
        class="press segment {section === key ? 'segment-on' : ''}"
        onclick={() => (section = key)}
      >{label}</button>
    {/each}
  </div>

  {#if section === 'todos'}
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

    {#if !filteredTodos.length}
      <Empty
        line={showClosed ? 'Nothing here yet.' : 'Nothing open right now.'}
        quip={showClosed ? 'Not even a fossil.' : 'Suspiciously peaceful. No asteroid in sight.'}
      />
    {/if}

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
    <!-- Collections, over one flat list. Same mechanic as a project's sections:
         the lit chip is both the filter and where the next one lands. -->
    <div class="no-bar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
      <button
        class="chip press shrink-0 {activeGroup === null && !unfiledOnly ? 'chip-on' : ''}"
        onclick={() => useGroup(null)}
      >
        All
      </button>
      <button
        class="chip press shrink-0 {unfiledOnly ? 'chip-on' : ''}"
        onclick={() => useGroup(null, true)}
      >
        Unfiled
      </button>
      {#each groups as g (g)}
        <button
          class="chip press shrink-0 {activeGroup === g ? 'chip-on' : ''}"
          onclick={() => useGroup(activeGroup === g ? null : g)}
        >
          {g}
        </button>
      {/each}
      <button class="chip press shrink-0" onclick={() => (namingGroup = !namingGroup)}>
        {namingGroup ? 'Cancel' : '+'}
      </button>
    </div>

    {#if namingGroup}
      <form onsubmit={addGroup} class="mb-3 flex gap-2">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={newGroupName}
          autofocus
          placeholder="Books, Albums, Films…"
          class="field min-w-0 flex-1 text-sm"
        />
        <button class="btn btn-secondary press shrink-0" disabled={!newGroupName.trim()}>
          Use it
        </button>
      </form>
    {/if}

    {#if activeGroup}
      {@const current = activeGroup}
      <!-- Renaming carries the ideas with it, so fixing a typo is not a
           scattering. Same contract as renaming a project's section. -->
      <input
        value={current}
        onchange={(e) => {
          const next = e.currentTarget.value.trim();
          if (next && next !== current) {
            renameIdeaGroup(current, next);
            activeGroup = next;
          }
        }}
        class="field mb-3 w-full text-sm"
      />
    {/if}

    <form onsubmit={addIdea} class="mb-3 flex gap-2">
      <input
        bind:value={newIdeaText}
        placeholder={activeGroup ? `Add to ${activeGroup}` : 'A thought, no action attached'}
        class="field min-w-0 flex-1"
      />
      <button class="btn btn-primary press" disabled={!newIdeaText.trim()}>Add</button>
    </form>

    <ul class="space-y-1">
      {#each visibleIdeas as i (i.id)}
        <li class="card-flat flex items-center gap-3 px-3">
          <!-- Finishing a want is a real thing — a book gets read — and it
               counts as a win without ever having been a task. -->
          <button
            class="press tap shrink-0 {i.doneAt ? 'text-good' : 'text-ink-400'}"
            onclick={() => toggleIdeaDone(i.id, !i.doneAt)}
            aria-label={i.doneAt ? 'Not done after all' : 'Done with it'}
          >
            {i.doneAt ? '✓' : '○'}
          </button>

          <div class="min-w-0 flex-1 py-3">
            <p class={i.doneAt ? 'text-ink-400 line-through' : ''}>{i.text}</p>
            {#if (i.group && !activeGroup) || i.promotedToTodoId}
              <p class="footnote">
                {[i.group && !activeGroup ? i.group : null, i.promotedToTodoId ? '→ to-do' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            {/if}
          </div>

          {#if activeGroup && i.group !== activeGroup}
            <button
              class="press tap-h shrink-0 rounded-xl px-3 text-sm text-accent"
              onclick={() => setIdeaGroup(i.id, activeGroup ?? undefined)}
            >
              File here
            </button>
          {:else if !i.promotedToTodoId && !i.doneAt}
            <!-- The one sorting action left. An unfiled thought is already an
                 idea; the only decision worth a button is "this is a task". -->
            <button
              class="press tap-h shrink-0 rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
              onclick={() => promoteIdea(i.id)}>Make a to-do</button
            >
          {/if}
        </li>
      {:else}
        {#if unfiledOnly}
          <Empty
            line="Nothing unfiled. Anything you type into the box on Today lands here."
            quip="A tidy nest, for once."
          />
        {:else if activeGroup}
          <Empty line="Nothing in {activeGroup} yet." quip="Let the first one hatch." />
        {:else}
          <Empty
            line="Nothing yet. Anything you type into the box on Today lands here."
            quip="Go on, plant a seed. These things take an era."
          />
        {/if}
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
      <Empty line="Nothing recorded yet. Hum something." quip="Go on, give us a roar." />
    {/if}
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

    <div class="mb-3 flex flex-wrap gap-2">
      <select bind:value={fBuyProject} class="field press">
        <option value="">All projects</option>
        {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </div>

    <div class="segmented mb-3">
      {#each BUY_GROUPS as g (g.key)}
        <button
          class="press segment {buyGroup === g.key ? 'segment-on' : ''}"
          onclick={() => (buyGroup = g.key)}
        >
          {g.label}
        </button>
      {/each}
    </div>

    {#if !filteredBuy.length}
      <Empty line="Nothing to buy." quip="Your wallet is safely fossilised." />
    {/if}

    <BuyList
      items={filteredBuy}
      projects={($projectsQ as Project[] | undefined) ?? []}
      groupBy={buyGroup}
    />
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
