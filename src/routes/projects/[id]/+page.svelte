<script lang="ts">
  import { liveQuery } from 'dexie';
  import { page } from '$app/state';
  import { db } from '$lib/db';
  import type { Todo, BuyItem } from '$lib/types';
  import { createTodo, completeTodo, createBuyItem, markPurchased, saveNote, getNote } from '$lib/store';

  // Exactly three tabs, and no fourth ever. Depth is what killed the last one.
  type Tab = 'notes' | 'todos' | 'buy';
  let tab = $state<Tab>('todos');

  const id = $derived(page.params.id!);

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
    <a href="/projects" class="text-sm text-ink-400">← Projects</a>
    <h1 class="mt-1 text-2xl font-semibold tracking-tight">{$projectQ?.name ?? ''}</h1>
  </header>

  <div class="mb-4 flex gap-1 rounded-xl bg-ink-900 p-1">
    {#each [['notes', 'Notes'], ['todos', 'To-dos'], ['buy', 'Buy']] as const as [key, label]}
      <button
        class="tap flex-1 rounded-lg text-sm {tab === key
          ? 'bg-ink-700 text-ink-50'
          : 'text-ink-400'}"
        onclick={() => (tab = key)}
      >
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
      class="min-h-[60vh] w-full rounded-2xl border border-ink-700 bg-ink-900 p-4
             font-mono text-sm leading-relaxed outline-none focus:border-accent"
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
        class="tap flex-1 rounded-xl border border-ink-700 bg-ink-800 px-4 outline-none
               focus:border-accent"
      />
      <button class="tap rounded-xl bg-accent px-5 font-medium text-ink-950">Add</button>
    </form>

    <ul class="space-y-1">
      {#each open as todo (todo.id)}
        <li class="flex items-center gap-3 rounded-xl bg-ink-900 px-3">
          <button
            class="tap shrink-0 text-ink-400"
            onclick={() => completeTodo(todo.id)}
            aria-label="Complete">○</button
          >
          <span class="flex-1 py-3">{todo.title}</span>
        </li>
      {/each}
    </ul>

    {#if closed.length}
      <h2 class="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">
        Closed — {closed.length}
      </h2>
      <ul class="space-y-1">
        {#each closed as todo (todo.id)}
          <li class="flex items-center gap-3 rounded-xl bg-ink-900/50 px-3 text-ink-400">
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
        class="tap flex-1 rounded-xl border border-ink-700 bg-ink-800 px-4 outline-none
               focus:border-accent"
      />
      <button class="tap rounded-xl bg-accent px-5 font-medium text-ink-950">Add</button>
    </form>

    <ul class="space-y-1">
      {#each ($buyQ as BuyItem[] | undefined) ?? [] as item (item.id)}
        <li class="flex items-center gap-3 rounded-xl bg-ink-900 px-3">
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
