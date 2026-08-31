<script lang="ts">
  import { liveQuery } from 'dexie';
  import { page } from '$app/state';
  import { db } from '$lib/db';
  import { base } from '$app/paths';
  import WidgetBoard from '$lib/components/WidgetBoard.svelte';
  import BuyList from '$lib/components/BuyList.svelte';
  import { money } from '$lib/format';
  import type { Todo, BuyItem } from '$lib/types';
  import {
    createTodo, completeTodo, updateTodo, createBuyItem, markPurchased, saveNote, getNote,
    setProjectImage, setProjectTags, removeProjectTag, renameProjectTag,
    archiveProject, projectTagColor
  } from '$lib/store';
  import { goto } from '$app/navigation';
  import { resizeImage, COVER_EDGE } from '$lib/images';
  import ProjectCover from '$lib/components/ProjectCover.svelte';
  import StickerPicker from '$lib/components/StickerPicker.svelte';
  import Collapsible from '$lib/components/Collapsible.svelte';


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

  /**
   * The cover photo. Set here rather than at creation time, because creating a
   * project has to stay one tap and one field — being asked for a picture up
   * front is exactly the kind of demand that makes people stop creating them.
   */
  let coverError = $state('');

  let pickingSticker = $state(false);

  async function onCover(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    coverError = '';
    try {
      await setProjectImage(id, await resizeImage(file, COVER_EDGE));
    } catch (err) {
      coverError = (err as Error).message;
    }
    // Clearing lets the same file be chosen twice in a row, which otherwise
    // fires no change event and looks like the app ignored the tap.
    input.value = '';
  }

  /**
   * The to-do whose "belongs to" row is open.
   *
   * A to-do could only be given a project at the moment it was written, which
   * made an era with no projects yet a trap: everything typed before the first
   * project existed stayed on the era for good. Blocks and shopping could both
   * be moved afterwards; this was the one that could not, and it is the one
   * there is most of.
   */
  let openTodo = $state<string | null>(null);
  let editingTags = $state(false);
  let newTagName = $state('');

  $effect(() => {
    void id;
    editingTags = false;
  });

  const tags = $derived($projectQ?.tags ?? []);

  async function addTag(e: SubmitEvent) {
    e.preventDefault();
    const name = newTagName.trim();
    if (!name || tags.includes(name)) return;
    newTagName = '';
    await setProjectTags(id, [...tags, name]);
  }

  /**
   * Archiving, which until now had no way in from the UI at all — the field
   * existed and nothing could set it, so a project once made was permanent.
   * Two taps rather than a dialog: the second tap is the confirmation and
   * walking away cancels it.
   *
   * Archive rather than delete, because a project is a container. Deleting one
   * would strand its to-dos, notes and recordings with no way back, and nothing
   * here is worth that. An archived project keeps everything and can be brought
   * back from the Projects screen.
   */
  let confirmArchive = $state(false);

  async function archive() {
    if (!confirmArchive) {
      confirmArchive = true;
      setTimeout(() => (confirmArchive = false), 4000);
      return;
    }
    await archiveProject(id, true);
    await goto(`${base}/projects`);
  }

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
    // Captured now, not read at fire time: navigating away mid-debounce would
    // otherwise write one era's note onto another's.
    const pid = id;
    const text = markdown;
    saveTimer = setTimeout(() => void saveNote(pid, text), 500);
  }

  const buyItems = $derived(
    (($buyQ as BuyItem[] | undefined) ?? [])
      .sort(
      (a, b) =>
        (a.purchasedAt ? 1 : 0) - (b.purchasedAt ? 1 : 0) ||
        (b.needed ? 1 : 0) - (a.needed ? 1 : 0) ||
        b.createdAt.localeCompare(a.createdAt)
    )
  );

  /**
   * What the rest of this project would cost, for the items that have a price.
   *
   * A plain sum, not a budget: there is no target to be over or under, which is
   * the same reason there are no progress bars anywhere. "The campervan needs
   * another 340 euros of parts" is a useful thing to know; "you are 40% through
   * your allowance" is the thing this app exists to avoid.
   */
  const outstanding = $derived(
    buyItems
      .filter((b) => !b.purchasedAt && b.priceCents != null)
      .reduce((sum, b) => sum + b.priceCents!, 0)
  );


  const open = $derived(
    (($todosQ as Todo[] | undefined) ?? []).filter((t) => !t.completedAt)
  );
  /** Open to-dos in one project inside this era. A count of what is waiting,
   *  never of what is done: there is no target here to fall short of. */
  const countFor = (t: string) => open.filter((todo) => todo.tag === t).length;

  /** Everything still sitting on the era rather than in one of its projects. */
  const looseTodos = $derived(open.filter((t) => !t.tag || !tags.includes(t.tag)));
  const looseBuy = $derived(buyItems.filter((b) => !b.tag || !tags.includes(b.tag)));

  // Closed items are shown, always. Never deleted, never hidden (principle 2).
  const closed = $derived(
    (($todosQ as Todo[] | undefined) ?? [])
      .filter((t): t is Todo & { completedAt: string } => !!t.completedAt)
      // Era-level only: a project's own closed list lives on its own page.
      .filter((t) => !t.tag || !tags.includes(t.tag))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  );
</script>

<div class="px-4 pt-safe pb-8">
  <header class="pt-2 pb-4">
    <div class="flex items-center justify-between">
      <a href="{base}/projects" class="press footnote py-1">‹ Eras</a>
      <div class="flex items-center gap-1">
        <!-- Two ways in, side by side rather than behind a menu. A dinosaur is
             one tap and always available; a photo needs one from the camera
             roll and is the slower path, so it goes second. -->
        <button
          class="press tap-h footnote px-2 text-accent"
          onclick={() => (pickingSticker = true)}
        >
          Dinosaur
        </button>
        <label class="press tap-h footnote inline-flex cursor-pointer items-center px-2 text-accent">
          <input type="file" accept="image/*" class="hidden" onchange={onCover} />
          Photo
        </label>
        {#if $projectQ?.image}
          <button class="press tap-h footnote px-2" onclick={() => setProjectImage(id, undefined)}>
            Remove
          </button>
        {/if}
      </div>
    </div>

    {#if $projectQ?.image}
      <div class="relative mt-2 h-40 overflow-hidden rounded-[20px] border border-line-1">
        <ProjectCover name={$projectQ.name} image={$projectQ.image} pad="p-3 pb-12" />
        <div
          class="absolute inset-x-0 bottom-0 px-4 pt-12 pb-3"
          style="background: linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,.3) 55%, transparent)"
        >
          <h1 class="large-title text-white">{$projectQ.name}</h1>
        </div>
      </div>
    {:else}
      <h1 class="large-title mt-1">{$projectQ?.name ?? ''}</h1>
    {/if}

    {#if pickingSticker}
      <StickerPicker
        current={$projectQ?.image}
        onpick={(image) => {
          setProjectImage(id, image);
          pickingSticker = false;
        }}
        onclose={() => (pickingSticker = false)}
      />
    {/if}

    {#if coverError}
      <p class="footnote mt-2 text-accent-2">{coverError}</p>
    {/if}
  </header>

  <!--
    The era's projects, as a list you go into rather than chips you filter with.
    Each carries its own colour, which is the thing that stops you working on
    the laser cutter thinking you are on the trigger pad.

    The counts are counts of open things, not progress: there is nothing to be
    behind on, and a project with nothing in it shows a dash rather than a zero
    dressed up as a failure.
  -->
  <h2 class="section-label mb-2 flex items-center justify-between">
    <span>Projects</span>
    <button class="press tap-h px-2 text-[13px] text-accent" onclick={() => (editingTags = !editingTags)}>
      {editingTags ? 'Done' : 'Edit'}
    </button>
  </h2>

  {#if tags.length}
    <ul class="mb-3 space-y-2">
      {#each tags as t (t)}
        {@const c = projectTagColor($projectQ?.tags, $projectQ?.tagColors, t)}
        <li>
          <a
            href="{base}/projects/{id}/{encodeURIComponent(t)}"
            class="press rise flex items-center gap-3 rounded-[18px] px-4 py-3"
            style="background: color-mix(in srgb, {c} 16%, transparent);
                   border-left: 4px solid {c}"
          >
            <span class="min-w-0 flex-1 truncate text-[17px]">{t}</span>
            <span class="footnote shrink-0 tabular-nums">{countFor(t) || '—'}</span>
            <span class="shrink-0 text-ink-400">›</span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="footnote mb-3">
      No projects yet. A project is one build, one song, one job — the thing you
      actually sit down to do.
    </p>
  {/if}

  {#if !editingTags}
    <button
      class="press tap mb-5 w-full rounded-xl border border-dashed border-line-2 text-sm text-ink-400"
      onclick={() => (editingTags = true)}
    >
      + New project
    </button>
  {/if}

  <!--
    Whatever is not in a project yet.

    An era is mostly an index of its projects, but the app must never require
    one before you can write something down (principle 1 has no required fields),
    so era-level items have to live somewhere visible. Same folding language as
    a project page rather than the tabs that used to be here: two different ways
    of showing the same five kinds of thing on two screens was the actual source
    of the chaos, not the amount of content.
  -->
  <h2 class="section-label mt-6 mb-2">Not in a project yet</h2>

  <Collapsible id="{id}/era/todo" title="To-dos" count={looseTodos.length}>
    <form
      onsubmit={async (e) => {
        e.preventDefault();
        if (!newTodo.trim()) return;
        await createTodo(newTodo, { projectId: id });
        newTodo = '';
      }}
      class="mb-2 flex gap-2"
    >
      <input bind:value={newTodo} placeholder="Add a to-do" class="field min-w-0 flex-1" />
      <button class="btn btn-primary press">Add</button>
    </form>

    <ul class="space-y-1">
      {#each looseTodos as todo (todo.id)}
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
            </button>
          </div>

          {#if openTodo === todo.id && tags.length}
            <div class="mt-1 border-t border-line-1 pt-3 pb-3">
              <p class="section-label mb-2">Move into</p>
              <div class="flex flex-wrap gap-2">
                {#each tags as t (t)}
                  <button
                    class="chip press"
                    onclick={() => {
                      void updateTodo(todo.id, { tag: t });
                      openTodo = null;
                    }}
                  >
                    {t}
                  </button>
                {/each}
              </div>
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

  <Collapsible id="{id}/era/buy" title="To buy" count={looseBuy.length} defaultFolded={looseBuy.length === 0}>
    <form
      onsubmit={async (e) => {
        e.preventDefault();
        if (!newBuy.trim()) return;
        await createBuyItem(newBuy, { projectId: id });
        newBuy = '';
      }}
      class="mb-2 flex gap-2"
    >
      <input bind:value={newBuy} placeholder="Something to buy" class="field min-w-0 flex-1" />
      <button class="btn btn-primary press">Add</button>
    </form>
    <BuyList items={looseBuy} showProject={false} groupBy="shop" sections={tags} />
    {#if outstanding > 0}
      <p class="footnote mt-3 text-right">{money(outstanding)} still to buy</p>
    {/if}
  </Collapsible>

  <Collapsible id="{id}/era/note" title="Notes" count={markdown.trim() ? 1 : 0} defaultFolded>
    <textarea
      bind:value={markdown}
      oninput={onNoteInput}
      placeholder="Markdown. Autosaves."
      class="field min-h-[30vh] w-full py-4 font-mono leading-relaxed"
    ></textarea>
  </Collapsible>

  <Collapsible id="{id}/era/blocks" title="Blocks" count={0} defaultFolded>
    <WidgetBoard {projectId} sections={tags} />
  </Collapsible>

  <!-- Right at the bottom, where a destructive-looking action belongs. -->
  <div class="mt-10 border-t border-line-1 pt-4">
    <button
      class="press tap w-full rounded-xl text-sm {confirmArchive ? 'text-accent-2' : 'text-ink-400'}"
      onclick={archive}
    >
      {confirmArchive ? 'Archive it — tap again' : 'Archive this era'}
    </button>
    <p class="footnote mt-1 text-center">
      Keeps everything in it. You can bring it back from Eras.
    </p>
  </div>
</div>
