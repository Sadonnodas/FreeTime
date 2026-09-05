<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Todo, Idea, BuyItem, Project, Energy, TimeBucket, Memo } from '$lib/types';
  import {
    promoteIdea, completeTodo, createTodo, createIdea, createBuyItem,
    setIdeaProject, toggleIdeaDone, updateTodo, setTodoAfter, softDelete, today, updateIdea
  } from '$lib/store';
  import { indexById, blockerOf, possibleBlockers } from '$lib/order';
  import { tomorrow, dayLabel, dayPhrase } from '$lib/days';
  import { activeProjects } from '$lib/queries';
  import { allMemos, storageUse, mb, type StorageUse } from '$lib/memos';
  import MemoList from '$lib/components/MemoList.svelte';
  import MemoRecorder from '$lib/components/MemoRecorder.svelte';
  import MemoMap from '$lib/components/MemoMap.svelte';
  import BuyList from '$lib/components/BuyList.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import EnergyPicker from '$lib/components/EnergyPicker.svelte';
  import DurationPicker from '$lib/components/DurationPicker.svelte';
  import RemoveButton from '$lib/components/RemoveButton.svelte';
  import RenameField from '$lib/components/RenameField.svelte';
  import AfterPicker from '$lib/components/AfterPicker.svelte';
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

  /**
   * A list for one day — asked for as "just all the things I need to do that
   * day", belonging to no era and no project.
   *
   * It is a DATE, not a new kind of thing. A to-do already has `date`, so a day
   * list is that field used as both the filter and the destination — the same
   * shape as the Ideas project chips and the buy list, where whatever you are
   * looking at is where a new one lands. No table, no new concept, and nothing
   * deeper: the two levels are still era and project, and this cuts across them
   * rather than sitting under one.
   *
   * Distinct from the Today screen's three slots on purpose. Three is a hard
   * ceiling with an unlock behind it and the constraint IS the feature (spec
   * 5.3); "everything I have to do tomorrow" is a different question, and
   * pushing it through the three would either break that or lose the list.
   */
  let day = $state('');
  const todayIso = today();
  /** The date field is behind a chip: an empty dd/mm/yyyy box parked over the
   *  list is chrome you have to read past every visit, for the rarer case. */
  let pickingDay = $state(false);

  function useDay(iso: string) {
    day = day === iso ? '' : iso;
    openTodo = null;
  }

  const filteredTodos = $derived(
    (($todosQ as Todo[] | undefined) ?? [])
      .filter((t) => (showClosed ? true : !t.completedAt))
      .filter((t) => (day ? t.date === day : true))
      .filter((t) => (fProject ? t.projectId === fProject : true))
      .filter((t) => (fEnergy ? t.energy === fEnergy : true))
      .filter((t) => (day || !fDated ? true : fDated === 'yes' ? !!t.date : !t.date))
      // A day list reads top to bottom in the order it was written — it is a
      // plan for a day, not a feed. Everywhere else the newest is what you came
      // back for, so it stays on top.
      .sort((a, b) =>
        day ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)
      )
  );

  const allTodos = $derived(($todosQ as Todo[] | undefined) ?? []);
  const byId = $derived(indexById(allTodos));

  /**
   * What a to-do could be told to wait for: the ones it shares a list with.
   *
   * Brain shows every to-do in the app at once, and offering all of them would
   * be a scroll through other people's problems. A link is only meaningful
   * between two things you would see side by side, which is the same era and
   * the same project — including "no era and no project", where two loose
   * to-dos can still be sequenced.
   *
   * Deliberately NOT reordered here the way a project's list is: Brain is the
   * index of everything, not the plan for one thing, and re-sorting a
   * cross-cutting list by chains nobody can see the ends of would just look
   * like the order was wrong.
   */
  const siblingsOf = (t: Todo): Todo[] =>
    possibleBlockers(
      t,
      allTodos.filter((o) => o.projectId === t.projectId && o.tag === t.tag)
    );

  const projectName = (id?: string) =>
    (($projectsQ as Project[] | undefined) ?? []).find((p) => p.id === id)?.name;

  /**
   * Everything worth knowing about a to-do at a glance, in one line.
   *
   * The date is NAMED rather than printed — "Tomorrow" reads and 2026-09-06
   * does not — and it is left off entirely inside a day list, where it is the
   * heading over every row and repeating it is just noise down the page.
   */
  const footnote = (t: Todo): string =>
    [
      blockerOf(t, byId) ? `after ${blockerOf(t, byId)!.title}` : null,
      projectName(t.projectId),
      t.tag,
      t.takes,
      t.energy,
      t.date && t.date !== day ? dayLabel(t.date, todayIso) : null
    ]
      .filter(Boolean)
      .join(' · ');

  /**
   * Ideas are filed under PROJECTS, not under a taxonomy of their own.
   *
   * They used to have free-form collections with a "+" to invent names, which
   * was a second hierarchy sitting beside the one the rest of the app already
   * uses — and it was reported as exactly that confusing. An idea starts
   * unfiled, because you have the idea before you have anywhere to put it, and
   * moves to a project when one exists to hold it.
   *
   * The lit chip is both the filter and the destination, so adding while a
   * project is selected files it there, and an idea already on screen can be
   * dropped into it with one tap.
   */
  let activeProject = $state<string | null>(null);
  /** Distinct from "no project selected": null is All, this is the unfiled ones. */
  let unfiledOnly = $state(false);

  function useProject(id: string | null, unfiled = false) {
    activeProject = id;
    unfiledOnly = unfiled;
    openIdea = null;
  }

  /**
   * Which idea is expanded to show its project chips.
   *
   * Filing had been a "File here" button that appeared on ideas belonging
   * somewhere other than the lit project — which could never happen, because
   * the lit project also filters them out of view. Moving an idea has to work
   * from where you can actually see it, so it lives on the row: tap the text,
   * pick a project. Same shape as a buy item.
   */
  let openIdea = $state<string | null>(null);

  /**
   * Every section can be added to directly. Only Lists could before, which made
   * To-dos, Ideas and Buy read-only views of things captured somewhere else.
   *
   * One field each, same as the capture box — no required anything. The one bit
   * of cleverness: whatever filter is active is where a new one lands, because
   * that is unambiguously what you meant while looking at a filtered list.
   */
  let newTodoText = $state('');
  let newIdeaText = $state('');
  let newBuyText = $state('');

  /**
   * Where a to-do with everything on it gets written.
   *
   * The era page has no add field any more: a to-do written there had no
   * project and in practice no energy, so it reached Free Time as an unknown
   * size belonging nowhere, which is how "I have twenty minutes" hands back
   * half a day of work. So there are exactly two ways in — inside a project,
   * where the era and project are already known, and here, where all four are
   * on the form.
   *
   * Every field except the title is optional and none of them blocks Enter.
   * They appear once there is something to file, the same way the capture box
   * shows its project chips.
   */
  /** The to-do whose row is expanded, for setting a size or deleting it. */
  let openTodo = $state<string | null>(null);

  let newEnergy = $state<Energy | undefined>(undefined);
  let newTakes = $state<TimeBucket | undefined>(undefined);
  let newEra = $state('');
  let newTag = $state('');
  let newDate = $state('');

  /** The projects inside the chosen era, for the second picker. */
  const eraTags = $derived(
    (($projectsQ as Project[] | undefined) ?? []).find((p) => p.id === newEra)?.tags ?? []
  );

  // An era's projects are its own, so changing era has to drop a stale project
  // or a to-do lands under a name that era has never heard of.
  $effect(() => {
    void newEra;
    if (newTag && !eraTags.includes(newTag)) newTag = '';
  });

  async function addTodo(e: SubmitEvent) {
    e.preventDefault();
    const title = newTodoText.trim();
    if (!title) return;
    await createTodo(title, {
      projectId: newEra || undefined,
      tag: newTag || undefined,
      energy: newEnergy,
      takes: newTakes,
      // The lit day wins: while looking at tomorrow's list, "add" unambiguously
      // means tomorrow, and nothing else on the form says otherwise.
      date: day || newDate || undefined
    });
    // The title clears; the destination does not. Writing five things for the
    // same project should not mean setting the project five times.
    newTodoText = '';
  }

  async function addIdea(e: SubmitEvent) {
    e.preventDefault();
    const text = newIdeaText.trim();
    if (!text) return;
    newIdeaText = '';
    await createIdea(text, { projectId: activeProject ?? undefined });
  }

  const visibleIdeas = $derived(
    (($ideasQ as Idea[] | undefined) ?? [])
      .filter((i) => (activeProject ? i.projectId === activeProject : true))
      .filter((i) => (unfiledOnly ? !i.projectId : true))
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
    { key: 'project', label: 'By era' }
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
    <!--
      A list for a day. The lit chip is both the filter and the destination, so
      everything typed while it is on lands on that day — the same rule the
      Ideas chips and the buy list already use.
    -->
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <button
        class="chip press {day === todayIso ? 'chip-on' : ''}"
        onclick={() => useDay(todayIso)}>Today</button
      >
      <button
        class="chip press {day === tomorrow(todayIso) ? 'chip-on' : ''}"
        onclick={() => useDay(tomorrow(todayIso))}>Tomorrow</button
      >
      {#if pickingDay || (day && day !== todayIso && day !== tomorrow(todayIso))}
        <input
          type="date"
          bind:value={day}
          class="field press text-sm"
          aria-label="A list for another day"
          onchange={() => (pickingDay = false)}
        />
      {:else}
        <button class="chip press" onclick={() => (pickingDay = true)}>Another day</button>
      {/if}
      {#if day}
        <button
          class="press tap px-1 text-sm text-ink-400"
          onclick={() => {
            day = '';
            pickingDay = false;
          }}
        >
          Clear
        </button>
      {/if}
    </div>

    {#if day}
      <!-- Said out loud, because a filtered list that does not say so is how you
           come to believe the other things have gone. -->
      <p class="footnote mb-3">
        {dayLabel(day, todayIso)} — {filteredTodos.length}
        thing{filteredTodos.length === 1 ? '' : 's'}. Anything you add lands here, era or no era.
      </p>
    {/if}

    <form onsubmit={addTodo} class="mb-3">
      <div class="flex gap-2">
        <input
          bind:value={newTodoText}
          placeholder={day ? `Add to ${dayPhrase(day, todayIso)}` : 'Add a to-do'}
          class="field min-w-0 flex-1"
        />
        <button class="btn btn-primary press" disabled={!newTodoText.trim()}>Add</button>
      </div>

      {#if newTodoText.trim()}
        <!-- Shown only once there is something to file, so the fast path is
             still type-and-Enter and none of this is in the way of it. -->
        <div class="card mt-2 space-y-3 p-3">
          <div>
            <p class="section-label mb-2">How long will it take?</p>
            <DurationPicker value={newTakes} onpick={(v) => (newTakes = v)} unset={false} />
          </div>

          <div>
            <p class="section-label mb-2">How much head does it need?</p>
            <EnergyPicker
              value={newEnergy}
              onpick={(v) => (newEnergy = v)}
              unset={false}
              hint={false}
            />
          </div>

          <!-- Labelled, and the project one always present. It used to appear
               only once an era with projects was chosen, so "it asks the era
               but not the project" was a fair reading of a control that was
               not there yet. -->
          <div class="flex flex-wrap gap-2">
            <label class="min-w-0 flex-1">
              <span class="section-label mb-1 block">Era</span>
              <select bind:value={newEra} class="field press w-full text-sm">
                <option value="">No era</option>
                {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
              </select>
            </label>

            <label class="min-w-0 flex-1">
              <span class="section-label mb-1 block">Project</span>
              <select
                bind:value={newTag}
                class="field press w-full text-sm"
                disabled={!eraTags.length}
              >
                <option value="">
                  {newEra ? (eraTags.length ? 'No project' : 'None in this era') : 'Pick an era first'}
                </option>
                {#each eraTags as t (t)}
                  <option value={t}>{t}</option>
                {/each}
              </select>
            </label>
          </div>

          {#if day}
            <p class="footnote">Lands on {dayPhrase(day, todayIso)}.</p>
          {:else}
            <input type="date" bind:value={newDate} class="field w-full text-sm" />
          {/if}
        </div>
      {/if}
    </form>

    <div class="mb-3 flex flex-wrap gap-2 text-sm">
      <select
        bind:value={fProject}
        class="field press"
      >
        <option value="">All eras</option>
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
      {#if !day}
        <select
          bind:value={fDated}
          class="field press"
        >
          <option value="">Dated or not</option>
          <option value="yes">Has a date</option>
          <option value="no">No date</option>
        </select>
      {/if}
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
      {#if day}
        <Empty
          line="Nothing on the list for {dayPhrase(day, todayIso)} yet. Type it in above."
          quip="A whole day, unspoken for."
        />
      {:else}
        <Empty
          line={showClosed ? 'Nothing here yet.' : 'Nothing open right now.'}
          quip={showClosed ? 'Not even a fossil.' : 'Suspiciously peaceful. No asteroid in sight.'}
        />
      {/if}
    {/if}

    <ul class="space-y-1">
      {#each filteredTodos as t (t.id)}
        <li class="card-flat px-3">
          <div class="flex items-center gap-3">
            <button
              class="press tap shrink-0 {t.completedAt ? 'text-good' : 'text-ink-400'}"
              onclick={() => !t.completedAt && completeTodo(t.id)}
              aria-label="Complete">{t.completedAt ? '✓' : '○'}</button
            >
            <button
              class="min-w-0 flex-1 py-3 text-left"
              onclick={() => (openTodo = openTodo === t.id ? null : t.id)}
            >
              <p
                class={t.completedAt
                  ? 'text-ink-400 line-through'
                  : blockerOf(t, byId)
                    ? 'text-ink-400'
                    : ''}
              >
                {t.title}
              </p>
              {#if footnote(t)}
                <p class="text-xs text-ink-400">{footnote(t)}</p>
              {/if}
            </button>
          </div>

          {#if openTodo === t.id}
            <!--
              Brain is the one list that shows every to-do in the app, open and
              closed, so it is where a pile of things that should never have
              existed actually gets cleared. Deleting is per row and deliberate;
              there is no "clear completed", because finished work is what the
              wins feed is made of.
            -->
            <div class="mt-1 space-y-3 border-t border-line-1 pt-3 pb-3">
              <div>
                <p class="section-label mb-2">What it is</p>
                <RenameField
                  value={t.title}
                  label="What it is"
                  onrename={(title) => updateTodo(t.id, { title })}
                />
              </div>
              {#if !t.completedAt}
                <div>
                  <p class="section-label mb-2">Comes after</p>
                  <AfterPicker
                    value={t.after}
                    options={siblingsOf(t)}
                    onpick={(after) => setTodoAfter(t.id, after)}
                  />
                </div>
                <div>
                  <p class="section-label mb-2">When</p>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      class="chip press {t.date ? '' : 'chip-on'}"
                      onclick={() => updateTodo(t.id, { date: undefined })}>Someday</button
                    >
                    <button
                      class="chip press {t.date === todayIso ? 'chip-on' : ''}"
                      onclick={() => updateTodo(t.id, { date: todayIso })}>Today</button
                    >
                    <button
                      class="chip press {t.date === tomorrow(todayIso) ? 'chip-on' : ''}"
                      onclick={() => updateTodo(t.id, { date: tomorrow(todayIso) })}
                      >Tomorrow</button
                    >
                    <input
                      type="date"
                      value={t.date ?? ''}
                      class="field press text-sm"
                      aria-label="Another day"
                      onchange={(e) =>
                        updateTodo(t.id, { date: e.currentTarget.value || undefined })}
                    />
                  </div>
                </div>
                <div>
                  <p class="section-label mb-2">How long will it take?</p>
                  <DurationPicker value={t.takes} onpick={(takes) => updateTodo(t.id, { takes })} />
                </div>
                <div>
                  <p class="section-label mb-2">How much head does it need?</p>
                  <EnergyPicker value={t.energy} onpick={(energy) => updateTodo(t.id, { energy })} />
                </div>
              {/if}
              <div class="flex">
                <span class="flex-1"></span>
                <RemoveButton
                  label="Delete"
                  confirm="Really delete it?"
                  onremove={() => {
                    openTodo = null;
                    void softDelete('todos', t.id);
                  }}
                />
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if section === 'ideas'}
    <!--
      Projects, over one flat list. The lit chip is both the filter and the
      destination, so adding while one is selected files it there.
    -->
    <div class="no-bar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
      <button
        class="chip press shrink-0 {activeProject === null && !unfiledOnly ? 'chip-on' : ''}"
        onclick={() => useProject(null)}
      >
        All
      </button>
      <button
        class="chip press shrink-0 {unfiledOnly ? 'chip-on' : ''}"
        onclick={() => useProject(null, true)}
      >
        Unfiled
      </button>
      {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
        <button
          class="chip press shrink-0 {activeProject === p.id ? 'chip-on' : ''}"
          onclick={() => useProject(activeProject === p.id ? null : p.id)}
        >
          {p.name}
        </button>
      {/each}
    </div>

    <form onsubmit={addIdea} class="mb-3 flex gap-2">
      <input
        bind:value={newIdeaText}
        placeholder={activeProject
          ? `An idea for ${projectName(activeProject)}`
          : 'A thought, no action attached'}
        class="field min-w-0 flex-1"
      />
      <button class="btn btn-primary press" disabled={!newIdeaText.trim()}>Add</button>
    </form>

    <ul class="space-y-1">
      {#each visibleIdeas as i (i.id)}
        <li class="card-flat px-3">
          <div class="flex items-center gap-3">
          <!-- Finishing a want is a real thing — a book gets read — and it
               counts as a win without ever having been a task. -->
          <button
            class="press tap shrink-0 {i.doneAt ? 'text-good' : 'text-ink-400'}"
            onclick={() => toggleIdeaDone(i.id, !i.doneAt)}
            aria-label={i.doneAt ? 'Not done after all' : 'Done with it'}
          >
            {i.doneAt ? '✓' : '○'}
          </button>

          <button
            class="min-w-0 flex-1 py-3 text-left"
            onclick={() => (openIdea = openIdea === i.id ? null : i.id)}
          >
            <p class={i.doneAt ? 'text-ink-400 line-through' : ''}>{i.text}</p>
            <!-- `group` exists only on ideas migrated from the old Lists tab.
                 Shown so nothing from back then goes invisible; nothing creates
                 one any more. -->
            {#if (i.projectId && !activeProject) || i.group || i.promotedToTodoId}
              <p class="footnote">
                {[
                  i.projectId && !activeProject ? projectName(i.projectId) : null,
                  i.group,
                  i.promotedToTodoId ? '→ to-do' : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            {/if}
          </button>

          {#if !i.promotedToTodoId && !i.doneAt}
            <!-- The one sorting action left. An unfiled thought is already an
                 idea; the only decision worth a button is "this is a task". -->
            <button
              class="press tap-h shrink-0 rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
              onclick={() => promoteIdea(i.id)}>Make a to-do</button
            >
          {/if}
        </div>

        {#if openIdea === i.id}
          <!-- Where it belongs, decided whenever you know — which is usually
               not at the moment you had the thought. -->
          <div class="mt-1 border-t border-line-1 pt-3 pb-2">
            <p class="section-label mb-2">What it says</p>
            <RenameField
              value={i.text}
              label="What it says"
              onrename={(text) => updateIdea(i.id, { text })}
            />

            <p class="section-label mt-3 mb-2">Belongs to</p>
            <div class="flex flex-wrap gap-2">
              <button
                class="chip press {i.projectId ? '' : 'chip-on'}"
                onclick={() => setIdeaProject(i.id, undefined)}
              >
                Nowhere yet
              </button>
              {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
                <button
                  class="chip press {i.projectId === p.id ? 'chip-on' : ''}"
                  onclick={() => setIdeaProject(i.id, i.projectId === p.id ? undefined : p.id)}
                >
                  {p.name}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </li>
      {:else}
        {#if unfiledOnly}
          <Empty
            line="Nothing unfiled. Anything you type into the box on Today lands here."
            quip="A tidy nest, for once."
          />
        {:else if activeProject}
          <Empty
            line="No ideas for {projectName(activeProject)} yet."
            quip="Let the first one hatch."
          />
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
        <option value="">All eras</option>
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
