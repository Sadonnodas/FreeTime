<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Capture, Todo, Idea, List, BuyItem, Project, Energy } from '$lib/types';
  import { sortCaptureToTodo, sortCaptureToIdea, promoteIdea, createList, completeTodo } from '$lib/store';
  import { activeProjects } from '$lib/queries';

  /**
   * The memory bank. It should feel well-stocked, never overdue — so there are
   * no counts styled as warnings, no red badges, and nothing here is late.
   */
  type Section = 'inbox' | 'todos' | 'ideas' | 'lists' | 'buy';
  let section = $state<Section>('inbox');

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
  const buyQ = liveQuery(async () => (await db.buyItems.toArray()).filter((b) => !b.deletedAt));
  const projectsQ = liveQuery(() => activeProjects());

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
</script>

<div class="px-4 pt-safe pb-8">
  <header class="py-4">
    <h1 class="text-2xl font-semibold tracking-tight">Brain</h1>
  </header>

  <div class="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-ink-900 p-1">
    {#each [['inbox', 'Inbox'], ['todos', 'To-dos'], ['ideas', 'Ideas'], ['lists', 'Lists'], ['buy', 'Buy']] as const as [key, label]}
      <button
        class="tap shrink-0 rounded-lg px-3 text-sm {section === key
          ? 'bg-ink-700 text-ink-50'
          : 'text-ink-400'}"
        onclick={() => (section = key)}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if section === 'inbox'}
    <!-- Leaving things unsorted is not a failure state, so this list has no
         "clear inbox" goal and no count-down. -->
    {#each ($inboxQ as Capture[] | undefined) ?? [] as c (c.id)}
      <div class="mb-2 rounded-2xl border border-ink-700 bg-ink-900 p-3">
        <p class="mb-2">{c.text}</p>
        <div class="flex gap-2">
          <button
            class="tap rounded-lg bg-ink-800 px-3 text-sm text-ink-200"
            onclick={() => sortCaptureToTodo(c.id)}>→ To-do</button
          >
          <button
            class="tap rounded-lg bg-ink-800 px-3 text-sm text-ink-200"
            onclick={() => sortCaptureToIdea(c.id)}>→ Idea</button
          >
        </div>
      </div>
    {:else}
      <p class="py-8 text-center text-sm text-ink-400">Inbox is clear.</p>
    {/each}
  {:else if section === 'todos'}
    <div class="mb-3 flex flex-wrap gap-2 text-sm">
      <select
        bind:value={fProject}
        class="tap rounded-lg border border-ink-700 bg-ink-800 px-2 text-ink-200"
      >
        <option value="">All projects</option>
        {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      <select
        bind:value={fEnergy}
        class="tap rounded-lg border border-ink-700 bg-ink-800 px-2 text-ink-200"
      >
        <option value="">Any energy</option>
        <option value="quick">Quick</option>
        <option value="moderate">Moderate</option>
        <option value="focus">Focus</option>
      </select>
      <select
        bind:value={fDated}
        class="tap rounded-lg border border-ink-700 bg-ink-800 px-2 text-ink-200"
      >
        <option value="">Dated or not</option>
        <option value="yes">Has a date</option>
        <option value="no">No date</option>
      </select>
      <button
        class="tap rounded-lg border border-ink-700 px-3 {showClosed
          ? 'text-good'
          : 'text-ink-400'}"
        onclick={() => (showClosed = !showClosed)}
      >
        {showClosed ? 'Showing closed' : 'Show closed'}
      </button>
    </div>

    <ul class="space-y-1">
      {#each filteredTodos as t (t.id)}
        <li class="flex items-center gap-3 rounded-xl bg-ink-900 px-3">
          <button
            class="tap shrink-0 {t.completedAt ? 'text-good' : 'text-ink-400'}"
            onclick={() => !t.completedAt && completeTodo(t.id)}
            aria-label="Complete">{t.completedAt ? '✓' : '○'}</button
          >
          <div class="flex-1 py-3">
            <p class={t.completedAt ? 'text-ink-400 line-through' : ''}>{t.title}</p>
            {#if projectName(t.projectId) || t.energy || t.date}
              <p class="text-xs text-ink-400">
                {[projectName(t.projectId), t.energy, t.date].filter(Boolean).join(' · ')}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {:else if section === 'ideas'}
    <ul class="space-y-1">
      {#each ($ideasQ as Idea[] | undefined) ?? [] as i (i.id)}
        <li class="flex items-center gap-3 rounded-xl bg-ink-900 px-3">
          <span class="flex-1 py-3">{i.text}</span>
          {#if i.promotedToTodoId}
            <span class="text-xs text-good">→ to-do</span>
          {:else}
            <button
              class="tap rounded-lg bg-ink-800 px-3 text-sm text-ink-200"
              onclick={() => promoteIdea(i.id)}>Promote</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else if section === 'lists'}
    <button class="tap mb-3 rounded-xl bg-ink-800 px-4 text-ink-200" onclick={newList}>
      + New list
    </button>
    <ul class="space-y-1">
      {#each ($listsQ as List[] | undefined) ?? [] as l (l.id)}
        <li class="rounded-xl bg-ink-900 px-4 py-3">{l.icon ?? '•'} {l.name}</li>
      {/each}
    </ul>
  {:else}
    <ul class="space-y-1">
      {#each ($buyQ as BuyItem[] | undefined) ?? [] as b (b.id)}
        <li class="flex items-center gap-3 rounded-xl bg-ink-900 px-4 py-3">
          <span class="flex-1 {b.purchasedAt ? 'text-ink-400 line-through' : ''}">{b.name}</span>
          <span class="text-xs text-ink-400">{projectName(b.projectId) ?? ''}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
