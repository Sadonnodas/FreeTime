<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Project, Todo, BuyItem, Memo, Widget, Energy } from '$lib/types';
  import { widgetsFor } from '$lib/widgets';
  import {
    createTodo, completeTodo, updateTodo, createBuyItem, saveNote, getNote,
    setProjectTagColor, projectTagColor, PROJECT_COLORS
  } from '$lib/store';
  import { memosForProject } from '$lib/memos';
  import { canRecord } from '$lib/audio';
  import Collapsible from '$lib/components/Collapsible.svelte';
  import WidgetBoard from '$lib/components/WidgetBoard.svelte';
  import BuyList from '$lib/components/BuyList.svelte';
  import MemoList from '$lib/components/MemoList.svelte';
  import MemoRecorder from '$lib/components/MemoRecorder.svelte';
  import Empty from '$lib/components/Empty.svelte';

  /**
   * A project inside an era: everything it holds, on one screen.
   *
   * WHY THIS REPLACED THE CHIPS AND THE THREE TABS. The era page had two
   * parallel systems doing overlapping jobs — blocks above, tabs below — and
   * nothing told you which of the two a photo or a to-do belonged to. Used on a
   * phone with several builds running at once it was, in the owner's word,
   * chaotic. This is fewer concepts rather than more: one screen, one add
   * button, and every kind of thing folded behind a header you can close.
   *
   * The old rule said a project was a chip and never a page, and this breaks it
   * deliberately. That rule was aimed at DEPTH, and the depth is unchanged —
   * era, then project, exactly as it was era, then chip, then tab. What is gone
   * is a whole concept, not a level.
   */
  const eraId = $derived(page.params.id!);
  const tag = $derived(decodeURIComponent(page.params.tag!));

  const eraQ = $derived(liveQuery(() => db.projects.get(eraId)));
  const era = $derived($eraQ as Project | undefined);
  const color = $derived(projectTagColor(era?.tags, era?.tagColors, tag));
  /** A project that has been renamed or removed out from under this URL. */
  const missing = $derived(!!era && !(era.tags ?? []).includes(tag));

  const todosQ = $derived(
    liveQuery(async () =>
      (await db.todos.where('projectId').equals(eraId).toArray())
        .filter((t) => !t.deletedAt && t.tag === tag)
    )
  );
  const buyQ = $derived(
    liveQuery(async () =>
      (await db.buyItems.where('projectId').equals(eraId).toArray())
        .filter((b) => !b.deletedAt && b.tag === tag)
    )
  );
  const memosQ = $derived(liveQuery(() => memosForProject(eraId)));
  const blocksQ = $derived(liveQuery(() => widgetsFor(eraId)));
  const blocks = $derived(
    (($blocksQ as Widget[] | undefined) ?? []).filter((w) => w.tag === tag)
  );

  const open = $derived(
    (($todosQ as Todo[] | undefined) ?? []).filter((t) => !t.completedAt)
  );
  const closed = $derived(
    (($todosQ as Todo[] | undefined) ?? [])
      .filter((t): t is Todo & { completedAt: string } => !!t.completedAt)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  );
  const buyItems = $derived(
    (($buyQ as BuyItem[] | undefined) ?? []).sort(
      (a, b) =>
        (a.purchasedAt ? 1 : 0) - (b.purchasedAt ? 1 : 0) ||
        (b.needed ? 1 : 0) - (a.needed ? 1 : 0) ||
        b.createdAt.localeCompare(a.createdAt)
    )
  );
  const memos = $derived(
    (($memosQ as Memo[] | undefined) ?? []).filter((m) => m.tag === tag)
  );

  // --- notes -----------------------------------------------------------------
  let noteText = $state('');
  let noteLoaded = $state('');
  $effect(() => {
    const id = eraId;
    const t = tag;
    void getNote(id, t).then((n) => {
      noteText = n?.markdown ?? '';
      noteLoaded = `${id}/${t}`;
    });
  });
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function onNote(value: string) {
    noteText = value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNote(eraId, value, tag), 600);
  }

  // --- adding ----------------------------------------------------------------
  /**
   * One button, every kind of thing.
   *
   * Picking a kind opens that section and puts the cursor in its field rather
   * than opening a form: the fast path is still type-and-Enter, and a sheet you
   * have to dismiss for every to-do would be worse than the tabs this replaced.
   */
  type AddKind = 'todo' | 'buy' | 'note' | 'photo' | 'recording';
  let adding = $state<AddKind | null>(null);
  let sheet = $state(false);
  let recording = $state(false);
  const recordable = canRecord();

  let newTodo = $state('');
  let newBuy = $state('');

  function choose(kind: AddKind) {
    sheet = false;
    if (kind === 'recording') {
      recording = true;
      return;
    }
    adding = kind;
  }

  const ENERGIES: { key: Energy; label: string; hint: string }[] = [
    { key: 'quick', label: 'Quick', hint: 'a few minutes' },
    { key: 'moderate', label: 'Moderate', hint: 'a sitting' },
    { key: 'focus', label: 'Focus', hint: 'a long block' }
  ];

  let openTodo = $state<string | null>(null);
  let picking = $state(false);

  const sectionId = (name: string) => `${eraId}/${tag}/${name}`;
</script>

<div class="px-4 pt-safe pb-8">
  <header class="pt-2 pb-4">
    <a href="{base}/projects/{eraId}" class="press footnote py-1">‹ {era?.name ?? 'Era'}</a>

    <!-- The colour is the point of this header: on a phone, switching between
         two builds in the same era is the moment you lose track of which one
         you are looking at. -->
    <div
      class="mt-2 flex items-center justify-between gap-3 rounded-[20px] px-4 py-3"
      style="background: color-mix(in srgb, {color} 22%, transparent);
             border-left: 4px solid {color}"
    >
      <h1 class="large-title min-w-0 truncate">{tag}</h1>
      <button
        class="press tap-h shrink-0 rounded-full px-2 text-[13px]"
        style="color: {color}"
        onclick={() => (picking = !picking)}
        aria-label="Change colour">●</button
      >
    </div>

    {#if picking}
      <div class="mt-2 flex flex-wrap gap-2">
        {#each PROJECT_COLORS as c (c)}
          <button
            class="press h-8 w-8 rounded-full border-2 {color === c
              ? 'border-ink-50'
              : 'border-transparent'}"
            style="background: {c}"
            onclick={() => {
              void setProjectTagColor(eraId, tag, c);
              picking = false;
            }}
            aria-label="Use this colour"
          ></button>
        {/each}
      </div>
    {/if}
  </header>

  {#if missing}
    <div class="card">
      <Empty
        line="This project is not in {era?.name ?? 'the era'} any more. It may have been renamed."
        quip="Even continents move."
      />
    </div>
  {:else}
    <button
      class="press tap mb-4 w-full rounded-xl border border-dashed border-line-2 text-sm text-ink-400"
      onclick={() => (sheet = true)}
    >
      + Add to {tag}
    </button>

    <!-- ---------------------------------------------------------------- to-dos -->
    <Collapsible id={sectionId('todo')} title="To-dos" count={open.length} {color} open={adding === 'todo'}>
      {#if adding === 'todo' || open.length === 0}
        <form
          onsubmit={async (e) => {
            e.preventDefault();
            if (!newTodo.trim()) return;
            await createTodo(newTodo, { projectId: eraId, tag });
            newTodo = '';
          }}
          class="mb-2 flex gap-2"
        >
          <!-- svelte-ignore a11y_autofocus -->
          <input
            bind:value={newTodo}
            autofocus={adding === 'todo'}
            placeholder="Add to {tag}"
            class="field min-w-0 flex-1"
          />
          <button class="btn btn-primary press">Add</button>
        </form>
      {/if}

      <ul class="space-y-1">
        {#each open as todo (todo.id)}
          <li class="card-flat px-3">
            <div class="flex items-center gap-3">
              <button
                class="press tap shrink-0 text-ink-400"
                onclick={() => completeTodo(todo.id)}
                aria-label="Complete">○</button
              >
              <button
                class="min-w-0 flex-1 py-3 text-left"
                onclick={() => (openTodo = openTodo === todo.id ? null : todo.id)}
              >
                <p>{todo.title}</p>
                {#if todo.energy}
                  <p class="footnote">{todo.energy}</p>
                {/if}
              </button>
            </div>

            {#if openTodo === todo.id}
              <div class="mt-1 border-t border-line-1 pt-3 pb-3">
                <!--
                  How big a job this is, which is what Free Time matches against
                  a window of time. It could not be set anywhere in the app
                  before — not on creation, not afterwards — so every to-do was
                  an unknown size.

                  Optional, and it stays optional: an unset energy always PASSES
                  the Free Time filter (see freetime.ts). An unknown size is not
                  a large size, and making this required would be a required
                  field, which principle 1 does not allow.
                -->
                <p class="section-label mb-2">How big is it?</p>
                <div class="flex flex-wrap gap-2">
                  <button
                    class="chip press {todo.energy ? '' : 'chip-on'}"
                    onclick={() => updateTodo(todo.id, { energy: undefined })}
                  >
                    Not sure
                  </button>
                  {#each ENERGIES as e (e.key)}
                    <button
                      class="chip press {todo.energy === e.key ? 'chip-on' : ''}"
                      onclick={() =>
                        updateTodo(todo.id, { energy: todo.energy === e.key ? undefined : e.key })}
                    >
                      {e.label}
                    </button>
                  {/each}
                </div>
                <p class="footnote mt-2">
                  {ENERGIES.find((e) => e.key === todo.energy)?.hint ??
                    'Left unset it still shows up in Free Time.'}
                </p>

                <button
                  class="press tap-h mt-2 rounded-lg text-sm text-ink-400"
                  onclick={() => updateTodo(todo.id, { tag: undefined })}
                >
                  Move out to {era?.name ?? 'the era'}
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if closed.length}
        <p class="footnote mt-3 mb-1">Closed — {closed.length}</p>
        <ul class="space-y-1">
          {#each closed.slice(0, 20) as todo (todo.id)}
            <li class="flex items-center gap-3 rounded-2xl bg-surface-1 px-3 text-ink-400">
              <span class="shrink-0 text-good">✓</span>
              <span class="flex-1 py-3">{todo.title}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Collapsible>

    <!-- ------------------------------------------------------------------- buy -->
    <Collapsible id={sectionId('buy')} title="To buy" count={buyItems.length} {color} defaultFolded={buyItems.length === 0} open={adding === 'buy'}>
      {#if adding === 'buy' || buyItems.length === 0}
        <form
          onsubmit={async (e) => {
            e.preventDefault();
            if (!newBuy.trim()) return;
            await createBuyItem(newBuy, { projectId: eraId, tag });
            newBuy = '';
          }}
          class="mb-2 flex gap-2"
        >
          <!-- svelte-ignore a11y_autofocus -->
          <input
            bind:value={newBuy}
            autofocus={adding === 'buy'}
            placeholder="Something for {tag}"
            class="field min-w-0 flex-1"
          />
          <button class="btn btn-primary press">Add</button>
        </form>
      {/if}
      <BuyList items={buyItems} showProject={false} groupBy="none" />
    </Collapsible>

    <!-- ------------------------------------------------------------------ note -->
    <Collapsible id={sectionId('note')} title="Notes" count={noteText.trim() ? 1 : 0} {color} defaultFolded open={adding === 'note'}>
      <textarea
        value={noteText}
        oninput={(e) => onNote(e.currentTarget.value)}
        placeholder="Notes for {tag}. Autosaves."
        class="field min-h-[30vh] w-full py-4 font-mono leading-relaxed"
      ></textarea>
    </Collapsible>

    <!-- ---------------------------------------------------------------- blocks -->
    <Collapsible id={sectionId('blocks')} title="Blocks" count={blocks.length} {color} defaultFolded={blocks.length === 0} open={adding === 'photo'}>
      <WidgetBoard projectId={eraId} section={tag} sections={era?.tags ?? []} />
    </Collapsible>

    <!-- ------------------------------------------------------------ recordings -->
    <Collapsible id={sectionId('memos')} title="Recordings" count={memos.length} {color} defaultFolded={memos.length === 0}>
      {#if memos.length}
        <MemoList {memos} grouped={false} showProject={false} />
      {:else}
        <p class="footnote">Nothing recorded for {tag} yet.</p>
      {/if}
      {#if recordable}
        <button
          class="press tap mt-2 flex w-full items-center justify-center gap-2 rounded-xl
                 bg-surface-2 text-sm text-ink-50"
          onclick={() => (recording = true)}
        >
          <span class="text-red-400">●</span> Record
        </button>
      {/if}
    </Collapsible>
  {/if}
</div>

{#if sheet}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="glass-strong rise fixed inset-0 z-50 flex flex-col justify-end p-4 pb-safe"
    onclick={() => (sheet = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card mx-auto w-full max-w-[520px] p-2" onclick={(e) => e.stopPropagation()}>
      {#each [['todo', 'To-do', 'Something to do'], ['buy', 'To buy', 'Something to get'], ['note', 'Note', 'Anything written down'], ['photo', 'Photo or block', 'A picture, a countdown, links'], ['recording', 'Recording', 'A voice memo']] as const as [kind, label, hint]}
        {#if kind !== 'recording' || recordable}
          <button class="press list-row w-full text-left" onclick={() => choose(kind)}>
            <span class="flex-1">
              <span class="block">{label}</span>
              <span class="footnote">{hint}</span>
            </span>
            <span class="text-ink-400">+</span>
          </button>
        {/if}
      {/each}
      <button class="press tap mt-1 w-full text-sm text-ink-400" onclick={() => (sheet = false)}>
        Cancel
      </button>
    </div>
  </div>
{/if}

{#if recording}
  <MemoRecorder onDone={() => (recording = false)} projectId={eraId} section={tag} />
{/if}
