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
    createTodo, completeTodo, createBuyItem, markPurchased, saveNote, getNote,
    setProjectImage, setProjectTags, removeProjectTag, renameProjectTag,
    archiveProject
  } from '$lib/store';
  import { goto } from '$app/navigation';
  import { resizeImage, COVER_EDGE } from '$lib/images';
  import ProjectCover from '$lib/components/ProjectCover.svelte';
  import StickerPicker from '$lib/components/StickerPicker.svelte';

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
   * Sections, as a row of chips over one flat list (see Project.tags).
   *
   * `activeTag` is both the filter and the destination: anything added while a
   * chip is lit joins that section, so filing is a side effect of where you
   * already are rather than a second decision. null means All, and adding from
   * All files nothing — undecided stays a valid state here as everywhere else.
   */
  let activeTag = $state<string | null>(null);
  let editingTags = $state(false);
  let newTagName = $state('');

  // The chips belong to the project, so switching projects has to reset the
  // selection — otherwise Music's "Mixing" filter silently follows you into
  // Coding and the list looks mysteriously empty.
  $effect(() => {
    void id;
    activeTag = null;
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
    const section = activeTag ?? undefined;
    noteLoaded = false;
    getNote(pid, section).then((n) => {
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
    // Captured now, not read at fire time: switching section mid-debounce would
    // otherwise write one song's lyrics onto another's.
    const pid = id;
    const section = activeTag ?? undefined;
    const text = markdown;
    saveTimer = setTimeout(() => void saveNote(pid, text, section), 500);
  }

  const buyItems = $derived(
    (($buyQ as BuyItem[] | undefined) ?? []).sort(
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

  let buyGroup = $state<'none' | 'shop'>('none');

  const inSection = (t: Todo) => (activeTag ? t.tag === activeTag : true);

  const open = $derived(
    (($todosQ as Todo[] | undefined) ?? []).filter((t) => !t.completedAt).filter(inSection)
  );
  // Closed items are shown, always. Never deleted, never hidden (principle 2).
  const closed = $derived(
    (($todosQ as Todo[] | undefined) ?? [])
      .filter((t): t is Todo & { completedAt: string } => !!t.completedAt)
      .filter(inSection)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  );
</script>

<div class="px-4 pt-safe pb-8">
  <header class="pt-2 pb-4">
    <div class="flex items-center justify-between">
      <a href="{base}/projects" class="press footnote py-1">‹ Projects</a>
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
    The section chips, above the tabs rather than inside one.

    A section is a view of the whole project, not a filter on its to-dos: pick a
    song and you get that song's to-dos, that song's lyrics and that song's
    recordings. That is what the original brief asked for — "a section for a
    specific song where I can have my lyrics and my audio recordings" — and it
    only works if the chips sit outside the tabs.

    Still one row, still never a page you go into. It scrolls sideways only when
    there are more sections than fit, which is the one honest use of that.
  -->
  {#if tags.length || editingTags}
    <div class="no-bar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
      <button
        class="chip shrink-0 press {activeTag === null ? 'chip-on' : ''}"
        onclick={() => (activeTag = null)}
      >
        All
      </button>
      {#each tags as t (t)}
        <button
          class="chip shrink-0 press {activeTag === t ? 'chip-on' : ''}"
          onclick={() => (activeTag = activeTag === t ? null : t)}
        >
          {t}
        </button>
      {/each}
      <button
        class="chip shrink-0 press {editingTags ? 'chip-on' : ''}"
        onclick={() => (editingTags = !editingTags)}
        aria-label="Edit sections"
      >
        {editingTags ? 'Done' : '+'}
      </button>
    </div>
  {:else}
    <button
      class="press footnote mb-3 rounded-xl border border-dashed border-line-2 px-3 py-2"
      onclick={() => (editingTags = true)}
    >
      + Sections
    </button>
  {/if}

  {#if editingTags}
    <div class="card mb-3 p-3">
      <p class="footnote mb-2">
        Sections split this project's to-dos without adding a screen. Removing one
        keeps its to-dos and just unfiles them.
      </p>
      {#each tags as t (t)}
        <div class="mb-1 flex items-center gap-2">
          <input
            value={t}
            onchange={(e) => renameProjectTag(id, t, e.currentTarget.value)}
            class="field min-w-0 flex-1 text-sm"
          />
          <button
            class="press tap-h w-11 shrink-0 rounded-lg text-ink-400"
            onclick={() => removeProjectTag(id, t)}
            aria-label="Remove {t}">✕</button
          >
        </div>
      {/each}
      <form onsubmit={addTag} class="mt-2 flex gap-2">
        <input
          bind:value={newTagName}
          placeholder="New section"
          class="field min-w-0 flex-1 text-sm"
        />
        <button class="btn btn-secondary press shrink-0" disabled={!newTagName.trim()}>Add</button>
      </form>
    </div>
  {/if}

  <WidgetBoard {projectId} section={activeTag ?? undefined} />

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
      placeholder={activeTag ? `Notes and lyrics for ${activeTag}. Autosaves.` : 'Markdown. Autosaves.'}
      class="field min-h-[60vh] w-full py-4 font-mono text-sm leading-relaxed"
    ></textarea>
  {:else if tab === 'todos'}

    <form
      onsubmit={async (e) => {
        e.preventDefault();
        if (!newTodo.trim()) return;
        // Whatever chip is lit is where this lands. Still one field.
        await createTodo(newTodo, { projectId: id, tag: activeTag ?? undefined });
        newTodo = '';
      }}
      class="mb-4 flex gap-2"
    >
      <input
        bind:value={newTodo}
        placeholder={activeTag ? `Add to ${activeTag}` : 'Add a to-do'}
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
          <div class="min-w-0 flex-1 py-3">
            <p>{todo.title}</p>
            <!-- Only worth showing from All; inside a section it would repeat
                 the chip on every single row. -->
            {#if todo.tag && !activeTag}
              <p class="footnote">{todo.tag}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>

    {#if closed.length}
      <h2 class="section-label mb-2 mt-6">
        Closed — {closed.length}
      </h2>
      <ul class="space-y-1">
        {#each closed as todo (todo.id)}
          <li class="flex items-center gap-3 rounded-2xl bg-surface-1 px-3 text-ink-400">
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

    <!-- Grouping by shop matters here too: a campervan's parts come from three
         different places, and that is three deliveries or one. -->
    <div class="segmented mb-3">
      {#each [['none', 'Recent'], ['shop', 'By shop']] as const as [key, label]}
        <button
          class="press segment {buyGroup === key ? 'segment-on' : ''}"
          onclick={() => (buyGroup = key)}
        >
          {label}
        </button>
      {/each}
    </div>

    <!-- No project chips here: everything on this tab already belongs to this
         project, so showing them would only be a way to file it away. -->
    <BuyList items={buyItems} showProject={false} groupBy={buyGroup} />

    {#if outstanding > 0}
      <p class="footnote mt-3 text-right">
        {money(outstanding)} still to buy
      </p>
    {/if}
  {/if}

  <!-- Right at the bottom, where a destructive-looking action belongs. -->
  <div class="mt-10 border-t border-line-1 pt-4">
    <button
      class="press tap w-full rounded-xl text-sm {confirmArchive ? 'text-accent-2' : 'text-ink-400'}"
      onclick={archive}
    >
      {confirmArchive ? 'Archive it — tap again' : 'Archive this project'}
    </button>
    <p class="footnote mt-1 text-center">
      Keeps everything in it. You can bring it back from Projects.
    </p>
  </div>
</div>
