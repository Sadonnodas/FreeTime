<script lang="ts">
  import { page } from '$app/state';
  import { byRank } from '$lib/rank';
  import { rankedReorder } from '$lib/reorder.svelte';
  import { flip } from 'svelte/animate';
  import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Project, Todo, BuyItem, Memo, Widget, Energy, TimeBucket, Idea } from '$lib/types';
  import { widgetsFor } from '$lib/widgets';
  import {
    createTodo, completeTodo, uncompleteTodo, updateTodo, setTodoAfter, saveNote, getNote,
    projectTagColor, softDelete, createIdea, setProjectTagFinished
  } from '$lib/store';
  import { activeProjects } from '$lib/queries';
  import { memosForProject } from '$lib/memos';
  import { indexById, readyFirst, blockerOf, possibleBlockers } from '$lib/order';
  import { canRecord } from '$lib/audio';
  import Collapsible from '$lib/components/Collapsible.svelte';
  import WidgetBoard from '$lib/components/WidgetBoard.svelte';
  import BuyList from '$lib/components/BuyList.svelte';
  import BuyAddForm from '$lib/components/BuyAddForm.svelte';
  import OpenLink from '$lib/components/OpenLink.svelte';
  import MemoList from '$lib/components/MemoList.svelte';
  import MemoRecorder from '$lib/components/MemoRecorder.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import RemoveButton from '$lib/components/RemoveButton.svelte';
  import EnergyPicker from '$lib/components/EnergyPicker.svelte';
  import DurationPicker from '$lib/components/DurationPicker.svelte';
  import RenameField from '$lib/components/RenameField.svelte';
  import PhotoThumb from '$lib/components/PhotoThumb.svelte';
  import PhotoPicker from '$lib/components/PhotoPicker.svelte';
  import AddField from '$lib/components/AddField.svelte';
  import PlanToday from '$lib/components/PlanToday.svelte';
  import AfterPicker from '$lib/components/AfterPicker.svelte';
  import NoteEditor from '$lib/components/NoteEditor.svelte';
  import ProjectTagEditor from '$lib/components/ProjectTagEditor.svelte';
  import IdeaList from '$lib/components/IdeaList.svelte';
  import ExportSheet from '$lib/components/ExportSheet.svelte';
  import FinishProject from '$lib/components/FinishProject.svelte';
  import { goto } from '$app/navigation';

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

  /**
   * Every live to-do in the ERA, not just this project — then narrowed below.
   *
   * The wider set is what resolves "comes after": the thing standing in the way
   * may be completed (which openTodos-style filtering would hide) or may have
   * been moved out to the era since the link was made. Resolving against the
   * narrow list would silently drop the link in both cases.
   */
  const eraTodosQ = $derived(
    liveQuery(async () =>
      (await db.todos.where('projectId').equals(eraId).toArray()).filter((t) => !t.deletedAt)
    )
  );
  const eraTodos = $derived(($eraTodosQ as Todo[] | undefined) ?? []);
  const byId = $derived(indexById(eraTodos));
  const todosQ = $derived(eraTodos.filter((t) => t.tag === tag));
  /*
   * THE TAG IS FILTERED OUTSIDE THE LIVEQUERY, like its three siblings above
   * and below, and that is not a style choice.
   *
   * This one used to read `tag` INSIDE the query, which made the whole
   * liveQuery a dependency of it: change the tag and the `$derived` throws the
   * subscription away and builds a new one. That was invisible while the only
   * way to change the tag was to navigate to another project — a route change
   * remounts the component and everything is rebuilt anyway — and it surfaced
   * the moment a project could be RENAMED from inside itself, which changes
   * this page's tag without remounting it. The section went empty and stayed
   * empty until a reload, while the data was perfectly fine the whole time.
   *
   * Querying by era and filtering by tag in plain code keeps the subscription
   * alive across a rename, and costs nothing: it is the same rows either way.
   */
  const eraBuyQ = $derived(
    liveQuery(async () =>
      (await db.buyItems.where('projectId').equals(eraId).toArray()).filter((b) => !b.deletedAt)
    )
  );
  const buyQ = $derived((($eraBuyQ as BuyItem[] | undefined) ?? []).filter((b) => b.tag === tag));
  // Ideas, by era and then by tag in plain code — the same shape as buyQ above
  // and for the same reason: a tag read inside the query would drop the whole
  // subscription the moment this project is renamed from inside itself.
  const eraIdeasQ = $derived(
    liveQuery(async () =>
      (await db.ideas.where('projectId').equals(eraId).toArray()).filter((i) => !i.deletedAt)
    )
  );
  const ideas = $derived(
    (($eraIdeasQ as Idea[] | undefined) ?? [])
      .filter((i) => i.tag === tag)
      // Finished ones stay — nothing here is ever deleted by the app — but sink.
      .sort((a, b) => (a.doneAt ? 1 : 0) - (b.doneAt ? 1 : 0) || byRank(a, b))
  );
  /** Every era, for an idea's Belongs-to and for starting a project from one. */
  const erasQ = liveQuery(() => activeProjects());
  const eras = $derived(($erasQ as Project[] | undefined) ?? []);
  let addIdea = $state(false);
  const memosQ = $derived(liveQuery(() => memosForProject(eraId)));
  const blocksQ = $derived(liveQuery(() => widgetsFor(eraId)));
  const blocks = $derived(
    (($blocksQ as Widget[] | undefined) ?? []).filter((w) => w.tag === tag)
  );

  /**
   * Ready first, then each chain in the order it has to happen — the list
   * arranges itself from the links, so nobody has to drag anything.
   */
  const open = $derived(readyFirst(todosQ.filter((t) => !t.completedAt)));
  /** Hold and drag for your own order (rank.ts), shared with Brain. What waits
   *  on something still sits below it — readyFirst keeps chains readable. */
  const todoDrag = rankedReorder('todos', () => open);
  const closed = $derived(
    todosQ
      .filter((t): t is Todo & { completedAt: string } => !!t.completedAt)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  );
  const buyItems = $derived(
    [...buyQ].sort(
      (a, b) =>
        (a.purchasedAt ? 1 : 0) - (b.purchasedAt ? 1 : 0) ||
        // Your own order; what is on the shopping list no longer floats up,
        // since that would undo a drag — the 🛒 on the row says it.
        byRank(a, b)
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
  type AddKind = 'todo' | 'idea' | 'buy' | 'note' | 'photo' | 'recording';
  let adding = $state<AddKind | null>(null);
  let sheet = $state(false);
  let recording = $state(false);
  const recordable = canRecord();

  /** Whether the to-do field is open. Bound to AddField, and set by the sheet
   *  below so "+ Add to <project> → To-do" still lands the cursor in it. */
  let addTodo = $state(false);
  let newEnergy = $state<Energy | undefined>(undefined);
  let newTakes = $state<TimeBucket | undefined>(undefined);
  /** A photo for the to-do being written, before it exists. */
  let newImage = $state<string | undefined>(undefined);

  function choose(kind: AddKind) {
    sheet = false;
    if (kind === 'recording') {
      recording = true;
      return;
    }
    // Unfolds the section AND opens its field — picking a kind from the sheet
    // has to leave you typing, or the sheet is just a longer way in.
    if (kind === 'todo') addTodo = true;
    if (kind === 'idea') addIdea = true;
    adding = kind;
  }

  let openTodo = $state<string | null>(null);
  let picking = $state(false);
  let exporting = $state(false);
  let finishing = $state(false);
  /** When this project was finished, if it is. */
  const finishedAt = $derived(era?.finishedTags?.[tag]);
  const finishedLabel = $derived(
    finishedAt
      ? new Date(finishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : ''
  );

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
      <div class="min-w-0 flex-1">
        <h1 class="large-title truncate">{tag}</h1>
        {#if finishedAt}
          <!-- Said at the top, in the project's own colour: this is the first
               thing to know about a project you are opening again. -->
          <p class="text-[14px] font-semibold" style="color: {color}">✓ Finished {finishedLabel}</p>
        {/if}
        {#if era?.tagDescriptions?.[tag]}
          <p class="footnote">{era.tagDescriptions[tag]}</p>
        {/if}
      </div>
      <!--
        Its name, its line and its colour, edited from inside the thing itself.
        Only the colour used to be here — a lone dot — so renaming a project or
        writing its tagline meant going back out to the era list and finding the
        row you had just come from, which is a strange way round: you are stood
        in it.
      -->
      <div class="flex shrink-0 flex-col items-end">
        <button
          class="press tap-h rounded-full px-3 text-[13px]"
          style="color: {color}"
          onclick={() => (picking = !picking)}
        >
          {picking ? 'Done' : 'Edit'}
        </button>
        <!-- Taking the project out: as text to paste (Claude Code, notes, mail)
             or as a page to print. Beside Edit because both are about the
             project as a whole, not about any one thing inside it. -->
        <button
          class="press tap-h rounded-full px-3 text-[13px]"
          style="color: {color}"
          onclick={() => (exporting = true)}
        >
          Export
        </button>
      </div>
    </div>

    {#if picking}
      <div class="mt-3">
        <ProjectTagEditor
          {eraId}
          {tag}
          {color}
          description={era?.tagDescriptions?.[tag] ?? ''}
          onrenamed={(next) => {
            // The name is in this page's own URL, so staying put would show
            // "this project is gone" the instant it is renamed.
            picking = false;
            void goto(`${base}/projects/${eraId}/${encodeURIComponent(next)}`, {
              replaceState: true
            });
          }}
        />
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
      <!-- A button, not a bar. What sits over the list when you are not adding
           is one quiet line, and the to-dos start where the eye does. -->
      <AddField
        bind:open={addTodo}
        label="Add a to-do"
        placeholder="Add to {tag}"
        onadd={async (title) => {
          await createTodo(title, { projectId: eraId, tag, energy: newEnergy, takes: newTakes, image: newImage });
          // The photo was for this one to-do; the sizes stay for a run of them.
          newImage = undefined;
        }}
      >
        {#snippet extra(text)}
          {#if text.trim()}
            <!-- How long it will take, offered while writing it rather than only
                 afterwards. Free Time can only rule a job out of a short window
                 if the job says how long it is. -->
            <div class="card mt-2 space-y-3 p-3">
              <div>
                <p class="section-label mb-2">How long will it take?</p>
                <DurationPicker value={newTakes} onpick={(v) => (newTakes = v)} unset={false} />
              </div>
              <div>
                <p class="section-label mb-2">How much headspace does it need?</p>
                <EnergyPicker
                  value={newEnergy}
                  onpick={(v) => (newEnergy = v)}
                  unset={false}
                  hint={false}
                />
              </div>
              <!-- The photo, while writing it — not add, reopen, then add. -->
              <div>
                <p class="section-label mb-2">Photo</p>
                <PhotoPicker
                  image={newImage}
                  onpick={(image) => (newImage = image)}
                  onremove={() => (newImage = undefined)}
                />
                {#if newImage}
                  <!-- Which photo, before the to-do exists to show it on. -->
                  <img src={newImage} alt="" class="mt-2 h-20 rounded-lg object-cover" />
                {/if}
              </div>
            </div>
          {/if}
        {/snippet}
      </AddField>

      <ul class="space-y-1">
        {#each todoDrag.arrange(open) as todo (todo.id)}
          {@const waiting = blockerOf(todo, byId)}
          <li
            class="card-flat px-3"
            use:todoDrag.item={{ id: todo.id, off: openTodo === todo.id }}
            animate:flip={{ duration: todoDrag.dragging === todo.id ? 0 : 180 }}
          >
            <div class="flex items-center gap-3">
              <!--
                Still tappable while it waits, and deliberately so. Being
                blocked changes what the app OFFERS, never what you are allowed
                to do — the same reason nothing here is ever overdue. If you go
                and sow the grass anyway, that is your garden.
              -->
              <button
                class="press tap shrink-0 text-ink-400"
                onclick={() => completeTodo(todo.id)}
                aria-label="Complete">○</button
              >
              {#if todo.image}
                <PhotoThumb image={todo.image} label={todo.title} />
              {/if}
              <button
                class="min-w-0 flex-1 py-3 text-left"
                onclick={() => (openTodo = openTodo === todo.id ? null : todo.id)}
              >
                <p class={waiting ? 'text-ink-400' : ''}>{todo.title}</p>
                {#if waiting || todo.takes || todo.energy}
                  <p class="footnote">
                    {[waiting ? `after ${waiting.title}` : null, todo.takes, todo.energy]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                {/if}
              </button>
            </div>

            {#if openTodo === todo.id}
              <div class="mt-1 border-t border-line-1 pt-3 pb-3">
                <p class="section-label mb-2">What it is</p>
                <RenameField
                  value={todo.title}
                  label="What it is"
                  onrename={(title) => updateTodo(todo.id, { title })}
                />
                <OpenLink url={todo.url} />

                <p class="section-label mt-3 mb-2">Comes after</p>
                <AfterPicker
                  value={todo.after}
                  options={possibleBlockers(todo, todosQ)}
                  onpick={(after) => setTodoAfter(todo.id, after)}
                />

                <!--
                  TWO QUESTIONS, because they are two different things. How long
                  it takes is matched against the clock you have; how much head
                  it needs is matched against how your head is. A quick win can
                  eat an afternoon, and a twenty-minute decision can be the
                  hardest thing on the list.

                  Both optional, and both stay optional: unset PASSES either
                  filter (see freetime.ts). Making one required would be a
                  required field, which principle 1 does not allow.
                -->
                <p class="section-label mb-2">How long will it take?</p>
                <DurationPicker
                  value={todo.takes}
                  onpick={(takes) => updateTodo(todo.id, { takes })}
                />

                <p class="section-label mt-3 mb-2">How much headspace does it need?</p>
                <EnergyPicker
                  value={todo.energy}
                  onpick={(energy) => updateTodo(todo.id, { energy })}
                />

                <p class="section-label mt-3 mb-2">Photo</p>
                <PhotoPicker
                  image={todo.image}
                  onpick={(image) => updateTodo(todo.id, { image })}
                  onremove={() => updateTodo(todo.id, { image: undefined })}
                />

                <!-- The one you came into the project to do. Its own line:
                     the row below already carries two controls, and this is
                     not a variant of either of them. -->
                <div class="mt-3">
                  <PlanToday todoId={todo.id} />
                </div>

                <div class="mt-2 flex items-center gap-1">
                  <button
                    class="press tap-h rounded-lg px-3 text-sm text-ink-400"
                    onclick={() => updateTodo(todo.id, { tag: undefined })}
                  >
                    Move out to {era?.name ?? 'the era'}
                  </button>
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
              <!-- The tick undoes. A closed row used to be an inert ✓, so a
                   to-do ticked by accident could not be untitled from the one
                   screen that lists it. -->
              <button
                class="press tap shrink-0 text-good"
                onclick={() => uncompleteTodo(todo.id)}
                aria-label="Mark {todo.title} not done">✓</button
              >
              <span class="flex-1 py-3">{todo.title}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Collapsible>

    <!-- ----------------------------------------------------------------- ideas -->
    <!--
      Straight after the to-dos, because that is the comparison being drawn: an
      idea is the thing that is NOT a to-do yet, and might never be. Folded when
      empty so a project with no ideas does not carry an empty header's worth of
      guilt about not having any.
    -->
    <Collapsible id={sectionId('ideas')} title="Ideas" count={ideas.filter((i) => !i.doneAt).length} {color} defaultFolded={ideas.length === 0} open={adding === 'idea'}>
      <div class="mb-2">
        <AddField
          bind:open={addIdea}
          label="Add an idea"
          placeholder="An idea for {tag}"
          onadd={(text) => createIdea(text, { projectId: eraId, tag })}
        />
      </div>
      <IdeaList {ideas} {eras} showWhere={false}>
        {#snippet empty()}
          <p class="footnote px-1">
            Things worth thinking about, that are not ready to be to-dos. Or never will be.
          </p>
        {/snippet}
      </IdeaList>
    </Collapsible>

    <!-- ------------------------------------------------------------------- buy -->
    <Collapsible id={sectionId('buy')} title="To buy" count={buyItems.length} {color} defaultFolded={buyItems.length === 0} open={adding === 'buy'}>
      <BuyAddForm projectId={eraId} {tag} placeholder="Something for {tag}" focus={adding === 'buy'} />
      <BuyList items={buyItems} showProject={false} groupBy="none" />
    </Collapsible>

    <!-- ------------------------------------------------------------------ note -->
    <Collapsible id={sectionId('note')} title="Notes" count={noteText.trim() ? 1 : 0} {color} defaultFolded open={adding === 'note'}>
      <NoteEditor
        value={noteText}
        placeholder="Notes for {tag}. Autosaves."
        onchange={onNote}
      />
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

    <!--
      At the foot, below everything the project holds, because that is where
      you arrive having looked over it. Solid and in the project's colour, not a
      grey text link: finishing a closet is the best thing that can happen on
      this screen, and it should look like something you would want to press.
    -->
    <div class="mt-6">
      {#if finishedAt}
        <p class="footnote mb-2 text-center">Finished {finishedLabel}. Everything in it stays right here.</p>
        <button
          class="press tap w-full rounded-xl text-sm text-ink-400"
          onclick={() => setProjectTagFinished(eraId, tag, false)}
        >
          Not finished after all
        </button>
      {:else}
        <button
          class="press tap w-full rounded-xl text-[15px] font-semibold"
          style="background: color-mix(in srgb, {color} 18%, transparent); color: {color}"
          onclick={() => (finishing = true)}
        >
          ✓ Finish this project
        </button>
      {/if}
    </div>
  {/if}
</div>

{#if finishing}
  <FinishProject {eraId} {tag} {color} onclose={() => (finishing = false)} />
{/if}

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
      {#each [['todo', 'To-do', 'Something to do'], ['idea', 'Idea', 'Something to think about'], ['buy', 'To buy', 'Something to get'], ['note', 'Note', 'Anything written down'], ['photo', 'Photo or block', 'A picture, a countdown, links'], ['recording', 'Recording', 'A voice memo']] as const as [kind, label, hint]}
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

{#if exporting}
  <ExportSheet {eraId} {tag} onclose={() => (exporting = false)} />
{/if}
