<script lang="ts">
  import { liveQuery } from 'dexie';
  import { page } from '$app/state';
  import { db } from '$lib/db';
  import { base } from '$app/paths';
  import WidgetBoard from '$lib/components/WidgetBoard.svelte';
  import type { Todo, BuyItem } from '$lib/types';
  import { createTodo, completeTodo, createBuyItem, markPurchased, saveNote, getNote } from '$lib/store';

  // Exactly three tabs, and no fourth ever. Depth is what killed the last one.
  type Tab = 'notes' | 'todos' | 'buy';
  let tab = $state<Tab>('todos');

  const id = $derived(page.params.id!);
  const projectId = $derived(id);

  const projectQ = $derived(liveQuery(() => db.projects.get(id)));
  const todosQ = $derived(
    liveQuery(async () =>
      (await db.todos.where('projectId').equals(id).toArray()).filter((t) => !t.deletedAt)
    )
  );
  const buyQ = $derived(
    liveQuery(async () =>
      (await db.buyItems.where('projectId').equals(id).toArray()).filter((b) => !b.deletedAt)
    )
  );

  let newTodo = $state('');
  let newBuy = $state('');
  let markdown = $state('');
  let noteLoaded = $state(false);

  $effect(() => {
    const pid = id;
    noteLoaded = false;
    getNote(pid).then((n) => {
      markdown = n?.markdown ?? '';
      noteLoaded = true;
    });
  });

  // Autosave the note, debounced. There is no Save button because a Save button
  // is a thing you can forget to press, and losing a note is unrecoverable.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function onNoteInput() {
    if (!noteLoaded) return;
    clearTimeout(saveTimer);
    const pid = id;
    const text = markdown;
    saveTimer = setTimeout(() => void saveNote(pid, text), 500);
  }

  const open = $derived((($todosQ as Todo[] | undefined) ?? []).filter((t) => !t.completedAt));
  // Closed items are shown, always. Never deleted, never hidden (principle 2).
  const closed = $derived(
    (($todosQ as Todo[] | undefined) ?? [])
      .filter((t): t is Todo & { completedAt: string } => !!t.completedAt)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  );
</script>

<div class="px-4 pt-safe pb-8">
  <header class="py-4">
    <a href="{base}/projects" class="press footnote inline-block">‹ Projects</a>
    <h1 class="large-title mt-1">{$projectQ?.name ?? ''}</h1>
  </header>

  <!-- Blocks live above the tabs, not as a fourth one. -->
  <WidgetBoard {projectId} />

  <div class="segmented mb-4">
    {#each [['notes', 'Notes'], ['todos', 'To-dos'], ['buy', 'Buy']] as const as [key, label]}
      <button class="press segment {tab === key ? 'segment-on' : ''}" onclick={() => (tab = key)}>
        {label}
      </button>
    {/each}
  </div>

  {#if tab === 'notes'}
    <!-- Plain markdown. Syncs to Drive as a real .md file so the text is
         readable and editable without this app. -->
    <textarea
      bind:value={markdown}
      oninput={onNoteInput}
      placeholder="Markdown. Autosaves."
      class="field min-h-[60vh] w-full py-4 font-mono text-sm leading-relaxed"
    ></textarea>
  {:else if tab === 'todos'}
    <form
      onsubmit={async (e) => {
        e.preventDefault();
        if (!newTodo.trim()) return;
        await createTodo(newTodo, { projectId: id });
        newTodo = '';
      }}
      class="mb-4 flex gap-2"
    >
      <input
        bind:value={newTodo}
        placeholder="Add a to-do"
        class="field min-w-0 flex-1"
      />
      <button class="btn btn-primary press">Add</button>
    </form>

    <ul class="space-y-1">
      {#each open as todo (todo.id)}
        <li class="card-flat flex items-center gap-3 px-3">
          <button
            class="press tap shrink-0 text-ink-400"
            onclick={() => completeTodo(todo.id)}
            aria-label="Complete">○</button
          >
          <span class="flex-1 py-3">{todo.title}</span>
        </li>
      {/each}
    </ul>

    {#if closed.length}
      <h2 class="section-label mb-2 mt-6">
        Closed — {closed.length}
      </h2>
      <ul class="space-y-1">
        {#each closed as todo (todo.id)}
          <li class="flex items-center gap-3 rounded-2xl bg-white/[0.025] px-3 text-ink-400">
            <span class="shrink-0 text-good">✓</span>
            <span class="flex-1 py-3">{todo.title}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <form
      onsubmit={async (e) => {
        e.preventDefault();
        if (!newBuy.trim()) return;
        await createBuyItem(newBuy, { projectId: id });
        newBuy = '';
      }}
      class="mb-4 flex gap-2"
    >
      <input
        bind:value={newBuy}
        placeholder="Something to buy"
        class="field min-w-0 flex-1"
      />
      <button class="btn btn-primary press">Add</button>
    </form>

    <ul class="space-y-1">
      {#each ($buyQ as BuyItem[] | undefined) ?? [] as item (item.id)}
        <li class="card-flat flex items-center gap-3 px-3">
          <button
            class="tap shrink-0 {item.purchasedAt ? 'text-good' : 'text-ink-400'}"
            onclick={() => markPurchased(item.id, !item.purchasedAt)}
            aria-label="Toggle purchased">{item.purchasedAt ? '✓' : '○'}</button
          >
          <span class="flex-1 py-3 {item.purchasedAt ? 'text-ink-400 line-through' : ''}">
            {item.name}
          </span>
          {#if item.priceCents != null}
            <span class="text-sm text-ink-400">
              {(item.priceCents / 100).toFixed(2)}
              {item.currency ?? 'EUR'}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
