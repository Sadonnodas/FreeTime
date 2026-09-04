<script lang="ts">
  import { liveQuery } from 'dexie';
  import { page } from '$app/state';
  import { db } from '$lib/db';
  import { base } from '$app/paths';
  import WidgetBoard from '$lib/components/WidgetBoard.svelte';
  import BuyList from '$lib/components/BuyList.svelte';
  import type { Todo, BuyItem, Note } from '$lib/types';
  import {
    createTodo, completeTodo, updateTodo, createBuyItem, markPurchased, saveNote, getNote,
    setProjectImage, setProjectTags, removeProjectTag, renameProjectTag,
    setProjectTagColor, setProjectTagDescription, PROJECT_COLORS,
    archiveProject, projectTagColor, softDelete
  } from '$lib/store';
  import { goto } from '$app/navigation';
  import { resizeImage, COVER_EDGE } from '$lib/images';
  import ProjectCover from '$lib/components/ProjectCover.svelte';
  import StickerPicker from '$lib/components/StickerPicker.svelte';
  import Collapsible from '$lib/components/Collapsible.svelte';
  import EnergyPicker from '$lib/components/EnergyPicker.svelte';
  import DurationPicker from '$lib/components/DurationPicker.svelte';
  import RemoveButton from '$lib/components/RemoveButton.svelte';
  import NoteEditor from '$lib/components/NoteEditor.svelte';


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
  let newTagName = $state('');

  // Switching era closes whatever was open, or a panel from the last one
  // reappears over a project this era has never heard of.
  $effect(() => {
    void id;
    adding = false;
    editingTag = null;
    openTodo = null;
  });

  const tags = $derived($projectQ?.tags ?? []);

  /**
   * Making a project inside an era.
   *
   * The name is the only thing needed — the description and the colour are
   * both optional, and a colour is assigned automatically if none is picked, so
   * this is still one field and one tap if that is all you want it to be.
   */
  let adding = $state(false);
  let newTagDesc = $state('');
  let newTagColor = $state<string | undefined>(undefined);
  let editingTag = $state<string | null>(null);

  /** The next colour the palette would hand out, shown pre-selected so the
   *  swatch row is never blank and picking one is a change, not a chore. */
  const suggestedColor = $derived(
    PROJECT_COLORS.find((c) => !Object.values($projectQ?.tagColors ?? {}).includes(c)) ??
      PROJECT_COLORS[tags.length % PROJECT_COLORS.length]
  );

  async function addTag(e: SubmitEvent) {
    e.preventDefault();
    const name = newTagName.trim();
    if (!name || tags.includes(name)) return;

    await setProjectTags(id, [...tags, name]);
    if (newTagColor) await setProjectTagColor(id, name, newTagColor);
    if (newTagDesc.trim()) await setProjectTagDescription(id, name, newTagDesc);

    newTagName = '';
    newTagDesc = '';
    newTagColor = undefined;
    adding = false;
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



  const open = $derived(
    (($todosQ as Todo[] | undefined) ?? []).filter((t) => !t.completedAt)
  );
  /**
   * Every note in the era, including each project's.
   *
   * The section used to show the era's OWN note and nothing else while sitting
   * under a heading that said "Everything in Crafting" — so looking here for a
   * note written inside a project found nothing, and the page gave no hint that
   * it was not showing everything. That is the whole bug: not a missing label,
   * a missing list.
   */
  const notesQ = $derived(
    liveQuery(async () =>
      (await db.notes.where('projectId').equals(id).toArray()).filter(
        (n) => !n.deletedAt && n.markdown.trim()
      )
    )
  );
  const projectNotes = $derived(
    (($notesQ as Note[] | undefined) ?? [])
      .filter((n) => n.tag && tags.includes(n.tag))
      .sort((a, b) => tags.indexOf(a.tag!) - tags.indexOf(b.tag!))
  );

  /** The first line worth showing, for a note you are deciding whether to open. */
  const firstLine = (markdown: string) =>
    markdown
      .split('\n')
      .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
      .find(Boolean) ?? '';

  /** Open to-dos in one project inside this era. A count of what is waiting,
   *  never of what is done: there is no target here to fall short of. */
  const countFor = (t: string) => open.filter((todo) => todo.tag === t).length;

  /**
   * The era's to-dos, grouped under the project each belongs to.
   *
   * Every project with something open gets a heading, and the ones belonging to
   * no project come last — they are a pile to file rather than a project to
   * work on. This is the whole point of the era page now: one place to see what
   * is outstanding across a build, a shelf and the garden at once.
   */
  const openGrouped = $derived.by(() => {
    const buckets = new Map<string, Todo[]>();
    for (const t of open) {
      const key = t.tag && tags.includes(t.tag) ? t.tag : '';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(t);
      else buckets.set(key, [t]);
    }
    return [...buckets]
      .map(([tag, todos]) => ({ tag, todos }))
      .sort((a, b) => (!a.tag ? 1 : !b.tag ? -1 : tags.indexOf(a.tag) - tags.indexOf(b.tag)));
  });


  // Closed items are shown, always. Never deleted, never hidden (principle 2).
  const closed = $derived(
    (($todosQ as Todo[] | undefined) ?? [])
      .filter((t): t is Todo & { completedAt: string } => !!t.completedAt)
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
  <h2 class="section-label mb-2">Projects</h2>

  {#if tags.length}
    <ul class="mb-3 space-y-2">
      {#each tags as t (t)}
        {@const c = projectTagColor($projectQ?.tags, $projectQ?.tagColors, t)}
        {@const desc = $projectQ?.tagDescriptions?.[t]}
        <li>
          <div
            class="rise overflow-hidden rounded-[18px]"
            style="background: color-mix(in srgb, {c} 16%, transparent);
                   border-left: 4px solid {c}"
          >
            <div class="flex items-center gap-1 pr-2">
              <a
                href="{base}/projects/{id}/{encodeURIComponent(t)}"
                class="press min-w-0 flex-1 px-4 py-3"
              >
                <span class="block truncate text-[17px]">{t}</span>
                {#if desc}<span class="footnote block truncate">{desc}</span>{/if}
              </a>
              <span class="footnote shrink-0 tabular-nums">{countFor(t) || '—'}</span>
              <button
                class="press tap-h w-9 shrink-0 text-center text-[13px] text-ink-400"
                onclick={() => (editingTag = editingTag === t ? null : t)}
                aria-label="Edit {t}">⋯</button
              >
            </div>

            {#if editingTag === t}
              <!-- Name, description and colour, in the same order as the form
                   that made it, so editing one is not a different screen. -->
              <div class="space-y-3 px-4 pt-1 pb-4">
                <input
                  value={t}
                  onchange={(e) => renameProjectTag(id, t, e.currentTarget.value)}
                  placeholder="Name"
                  class="field w-full"
                />
                <input
                  value={desc ?? ''}
                  onchange={(e) => setProjectTagDescription(id, t, e.currentTarget.value)}
                  placeholder="What is it, in a line? (optional)"
                  class="field w-full"
                />
                <div class="flex flex-wrap gap-2">
                  {#each PROJECT_COLORS as swatch (swatch)}
                    <button
                      type="button"
                      class="press h-8 w-8 rounded-full border-2 {c === swatch
                        ? 'border-ink-50'
                        : 'border-transparent'}"
                      style="background: {swatch}"
                      onclick={() => setProjectTagColor(id, t, swatch)}
                      aria-label="Use this colour"
                    ></button>
                  {/each}
                </div>
                <div class="flex">
                  <span class="flex-1"></span>
                  <RemoveButton
                    label="Remove project"
                    confirm="Remove it? Its things stay."
                    onremove={() => {
                      editingTag = null;
                      void removeProjectTag(id, t);
                    }}
                  />
                </div>
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {:else if !adding}
    <p class="footnote mb-3">
      No projects yet. A project is one build, one song, one job — the thing you
      actually sit down to do.
    </p>
  {/if}

  {#if adding}
    <form onsubmit={addTag} class="card mb-5 space-y-3 p-4">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={newTagName}
        autofocus
        placeholder="Name of the project"
        class="field w-full"
      />
      <input
        bind:value={newTagDesc}
        placeholder="What is it, in a line? (optional)"
        class="field w-full"
      />

      <div>
        <p class="section-label mb-2">Colour</p>
        <div class="flex flex-wrap gap-2">
          {#each PROJECT_COLORS as swatch (swatch)}
            <button
              type="button"
              class="press h-8 w-8 rounded-full border-2 {(newTagColor ?? suggestedColor) === swatch
                ? 'border-ink-50'
                : 'border-transparent'}"
              style="background: {swatch}"
              onclick={() => (newTagColor = swatch)}
              aria-label="Use this colour"
            ></button>
          {/each}
        </div>
      </div>

      <div class="flex gap-2">
        <button class="btn btn-primary press flex-1" disabled={!newTagName.trim()}>Add</button>
        <button
          type="button"
          class="press tap rounded-xl px-4 text-sm text-ink-400"
          onclick={() => {
            adding = false;
            newTagName = '';
            newTagDesc = '';
            newTagColor = undefined;
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  {:else}
    <button
      class="press tap mb-5 w-full rounded-xl border border-dashed border-line-2 text-sm text-ink-400"
      onclick={() => (adding = true)}
    >
      + New project
    </button>
  {/if}

  <!--
    The overview, and it has to be honest about being one.

    "Everything in Crafting" was read literally, which is fair, and it was not
    true: to-dos and shopping listed every project's, while Notes showed only
    the era's own. Looking here for a note written inside a project found an
    empty box that looked like the answer. Every section below now spans the
    whole era, and every row says which project it belongs to.
  -->
  <h2 class="section-label mt-6 mb-1">Across every project</h2>
  <p class="footnote mb-3">
    Everything in {$projectQ?.name ?? 'this era'}, wherever it lives. Tap a
    project above to work inside one.
  </p>

  <!--
    Every to-do in the era, grouped under the project it belongs to, and READ
    ONLY as far as creating goes.

    There is deliberately no add field here. A to-do written at era level had no
    project, and in practice no energy either, so it arrived in Free Time as an
    unknown size belonging nowhere — which is exactly the thing that makes "I
    have twenty minutes" hand you back half a day of work. To-dos are written
    inside a project, or from Brain where the era, the project, the size and the
    date are all on the form. This screen is the overview.
  -->
  <Collapsible id="{id}/era/todo" title="To-dos" count={open.length} defaultFolded={open.length === 0}>
    {#if open.length === 0}
      <p class="footnote">
        Nothing open. To-dos are written inside a project, or from Brain.
      </p>
    {/if}

    {#each openGrouped as group (group.tag)}
      {#if group.tag}
        <a
          href="{base}/projects/{id}/{encodeURIComponent(group.tag)}"
          class="press mt-3 mb-1 flex items-center gap-2 first:mt-0"
        >
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            style="background: {projectTagColor($projectQ?.tags, $projectQ?.tagColors, group.tag)}"
          ></span>
          <span class="section-label">{group.tag}</span>
          <span class="text-ink-400">›</span>
        </a>
      {:else}
        <p class="section-label mt-3 mb-1 first:mt-0">Not in a project yet</p>
      {/if}

      <ul class="space-y-1">
        {#each group.todos as todo (todo.id)}
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
                {#if todo.energy || todo.date}
                  <p class="footnote">{[todo.takes, todo.energy, todo.date].filter(Boolean).join(' · ')}</p>
                {/if}
              </button>
            </div>

            {#if openTodo === todo.id}
              <div class="mt-1 space-y-3 border-t border-line-1 pt-3 pb-3">
                <div>
                  <p class="section-label mb-2">How long will it take?</p>
                  <DurationPicker
                    value={todo.takes}
                    onpick={(takes) => updateTodo(todo.id, { takes })}
                  />
                </div>

                <div>
                  <p class="section-label mb-2">How much head does it need?</p>
                  <EnergyPicker
                    value={todo.energy}
                    onpick={(energy) => updateTodo(todo.id, { energy })}
                  />
                </div>

                <div class="flex">
                  <span class="flex-1"></span>
                  <RemoveButton
                    label="Delete"
                    confirm="Really delete it?"
                    onremove={() => {
                      openTodo = null;
                      void softDelete('todos', todo.id);
                    }}
                  />
                </div>

                {#if tags.length}
                  <div>
                    <p class="section-label mb-2">Belongs to</p>
                    <div class="flex flex-wrap gap-2">
                      <button
                        class="chip press {todo.tag ? '' : 'chip-on'}"
                        onclick={() => updateTodo(todo.id, { tag: undefined })}
                      >
                        No project
                      </button>
                      {#each tags as t (t)}
                        <button
                          class="chip press {todo.tag === t ? 'chip-on' : ''}"
                          onclick={() => updateTodo(todo.id, { tag: todo.tag === t ? undefined : t })}
                        >
                          {t}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}

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

  <Collapsible id="{id}/era/buy" title="To buy" count={buyItems.length} defaultFolded={buyItems.length === 0}>
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
    <!-- Grouped by the project it is for, not by shop. On the era page the
         question is "what does this build still need", and a part with no
         project shown is the thing that made the whole overview ambiguous. -->
    <BuyList items={buyItems} showProject={false} groupBy="tag" sections={tags} />
  </Collapsible>

  <Collapsible
    id="{id}/era/note"
    title="Notes"
    count={(markdown.trim() ? 1 : 0) + projectNotes.length}
    defaultFolded
  >
    {#if projectNotes.length}
      <!-- Each project's note, so looking for one here finds it instead of
           finding an empty box that looked like the answer. -->
      <ul class="mb-3 space-y-1">
        {#each projectNotes as n (n.id)}
          {@const c = projectTagColor($projectQ?.tags, $projectQ?.tagColors, n.tag!)}
          <li>
            <a
              href="{base}/projects/{id}/{encodeURIComponent(n.tag!)}"
              class="press card-flat flex items-center gap-3 px-3 py-3"
            >
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {c}"></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[15px]">{n.tag}</span>
                <span class="footnote block truncate">{firstLine(n.markdown)}</span>
              </span>
              <span class="shrink-0 text-ink-400">›</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="section-label mb-2">Not in a project</p>
    <NoteEditor
      value={markdown}
      placeholder="Notes for the era itself. Autosaves."
      onchange={(text) => {
        markdown = text;
        onNoteInput();
      }}
    />
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
