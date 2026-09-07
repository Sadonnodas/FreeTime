<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Todo, Habit, Day, Project } from '$lib/types';
  import { completeTodo, toggleHabitLog, today } from '$lib/store';
  import { allTodos, activeProjects } from '$lib/queries';
  import { ENERGIES, DURATIONS, energyLabel, durationLabel } from '$lib/sizes';
  import { indexById, blockerOf } from '$lib/order';
  import {
    ensureDay, addToDay, removeFromDay, maybeCloseDay,
    canUnlockOneMore, unlockOneMore, DayFullError
  } from '$lib/day';
  import CaptureBox from '$lib/components/CaptureBox.svelte';
  import DayClose from '$lib/components/DayClose.svelte';
  import MonthlySummary from '$lib/components/MonthlySummary.svelte';
  import CalendarStrip from '$lib/components/CalendarStrip.svelte';
  import { pendingMonthlySummary, type MonthlySummary as Summary } from '$lib/monthly';
  import { onMount } from 'svelte';
  import FreeTime from '$lib/components/FreeTime.svelte';
  import Dino from '$lib/components/Dino.svelte';
  import Burst from '$lib/components/Burst.svelte';
  import { pickScene, pickQuip } from '$lib/freeTimeScenes';

  /**
   * Dexie's liveQuery re-runs its callback whenever any table it touched
   * changes, and returns an Observable. Svelte's $ prefix works with anything
   * that has .subscribe(), so `$dayQ` stays current with no manual refresh
   * anywhere — including writes made from another tab.
   */
  const dayQ = liveQuery(() => ensureDay());
  const habitsQ = liveQuery(async () =>
    (await db.habits.toArray()).filter((h) => !h.deletedAt && h.state === 'active')
  );
  const logsTodayQ = liveQuery(async () =>
    (await db.habitLogs.where('date').equals(today()).toArray()).filter((l) => !l.deletedAt)
  );
  /**
   * Every live to-do, read once — the open ones to choose from, and the whole
   * set to resolve "comes after" against, since the thing standing in the way
   * of one of them may be a completed to-do the open list has filtered out.
   * One liveQuery over one table, so both stay current together.
   */
  /** Era names for the picker's headings and each row's footnote. */
  const projectsQ = liveQuery(() => activeProjects());

  const openQ = liveQuery(async () => {
    const all = await allTodos();
    return { all, open: all.filter((t) => !t.completedAt) };
  });

  /**
   * The day's three, resolved from their ids.
   *
   * This has to be a liveQuery that reads BOTH tables, not an effect keyed on
   * the day. It was the latter, and the bug was as central as bugs get: ticking
   * something off writes to `todos`, the day record does not change, so nothing
   * re-ran and the screen sat there unchanged — no tick, no count — until the
   * third completion happened to write `closedAt` and shake it loose. The one
   * interaction the whole app is built around did nothing visible.
   */
  const slotTodosQ = liveQuery(async () => {
    const day = await ensureDay();
    const rows = await db.todos.bulkGet(day.slots);
    return day.slots
      .map((id) => rows.find((r) => r?.id === id))
      .filter((t): t is Todo => !!t && !t.deletedAt);
  });

  /**
   * A different little scene each time the app opens. Chosen once, here, rather
   * than in the markup — re-rolling on every render would make the button
   * change identity while being looked at.
   */
  const scene = pickScene();
  const quip = pickQuip();

  /**
   * "Still here."
   *
   * ONE undone thing waves at a time, in turn, for a moment. The rules that
   * keep this on the right side of the no-nag line are in app.css next to the
   * keyframes, and they are not decoration: it never escalates with time, it
   * never picks out the oldest or most neglected item, and it says nothing in
   * words. Motion only — "don't forget about me" written on the screen would be
   * aimed at the reader, and the house rule is that the app's personality is
   * never at your expense.
   */
  const NUDGE_EVERY = 7000;
  const NUDGE_FOR = 1500;
  let nudged = $state<string | null>(null);
  let turn = 0;

  /** Which item is mid-celebration, so its burst renders exactly once. */
  let celebrating = $state<string | null>(null);
  function celebrate(id: string) {
    celebrating = id;
    // Fire and forget: nothing waits on this, and a second tick during it
    // simply replaces it rather than queueing.
    setTimeout(() => {
      if (celebrating === id) celebrating = null;
    }, 900);
  }

  let showClose = $state(false);
  let unlockAvailable = $state(false);
  let picking = $state(false);
  let freeTime = $state(false);

  // Arrives on the first open on or after the 1st, then never again that month.
  let monthly = $state<Summary | null>(null);
  onMount(async () => {
    monthly = await pendingMonthlySummary();
  });

  $effect(() => {
    void $dayQ;
    canUnlockOneMore().then((v) => (unlockAvailable = v));
  });

  async function onComplete(todo: Todo) {
    // Before the await: the burst is a response to the tap, and a celebration
    // that arrives after a round trip to the database reads as a glitch.
    celebrate(todo.id);
    await completeTodo(todo.id);
    // The day closes the instant the third slot is done — before any "one
    // more?" is offered. That ordering is the whole mechanic (spec 5.3).
    if (await maybeCloseDay()) showClose = true;
  }

  async function pick(todo: Todo) {
    try {
      await addToDay(todo.id);
      picking = false;
    } catch (err) {
      // A fourth item is impossible, not discouraged. If we land here the UI
      // should already have hidden the affordance, so this is a backstop.
      if (!(err instanceof DayFullError)) throw err;
    }
  }

  const slotTodos = $derived(($slotTodosQ as Todo[] | undefined) ?? []);
  const day = $derived($dayQ as Day | undefined);
  const roomLeft = $derived(day ? day.unlockedCount - day.slots.length : 0);
  const doneCount = $derived(slotTodos.filter((t) => t.completedAt).length);
  const todoIndex = $derived(indexById(($openQ as { all: Todo[] } | undefined)?.all ?? []));
  /**
   * Blocked to-dos are SHOWN here, with what they are waiting for, and are not
   * filtered out. Free Time is the app making a suggestion, so it withholds
   * them; this is you choosing your own three, and the app does not get a veto
   * on that. It just makes sure you can see what you are picking.
   */
  const habits = $derived(($habitsQ as Habit[] | undefined) ?? []);
  const habitsDone = $derived(
    new Set((($logsTodayQ as { habitId: string }[] | undefined) ?? []).map((l) => l.habitId))
  );

  /**
   * Everything on this screen that is still waiting, to-dos and habits in ONE
   * rotation. Separate rotations would mean two things waving at once, which
   * is a busy screen rather than a live one.
   */
  const waiting = $derived([
    ...slotTodos.filter((t) => !t.completedAt).map((t) => t.id),
    ...habits.filter((h) => !habitsDone.has(h.id)).map((h) => h.id)
  ]);

  onMount(() => {
    const timer = setInterval(() => {
      // Nothing animates in a tab nobody is looking at.
      if (document.visibilityState !== 'visible') return;
      // A closed day has nothing to wave about; so has a finished one.
      if (day?.closedAt || !waiting.length) {
        nudged = null;
        return;
      }
      nudged = waiting[turn % waiting.length] ?? null;
      turn++;
      setTimeout(() => (nudged = null), NUDGE_FOR);
    }, NUDGE_EVERY);
    return () => clearInterval(timer);
  });

  const candidates = $derived(
    (($openQ as { open: Todo[] } | undefined)?.open ?? [])
      .filter((t) => !day?.slots.includes(t.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  /**
   * How the picker is arranged.
   *
   * It was a flat list of bare titles, newest first — fine at five to-dos and
   * useless at fifty: nothing on a row said which era it belonged to or how big
   * it was, so choosing meant recognising every title from memory. These are
   * the three questions actually being asked at this moment — what am I working
   * on, what fits the time I have, what have I got the head for — plus the
   * order it always had.
   *
   * Local state, not stored: same as the buy list's grouping. Which way you
   * last sorted a picker is not worth a write or a sync.
   */
  type PickOrder = 'recent' | 'era' | 'time' | 'effort';
  const PICK_ORDERS = [
    { key: 'recent', label: 'Recent' },
    { key: 'era', label: 'Era' },
    { key: 'time', label: 'Time' },
    { key: 'effort', label: 'Head' }
  ] as const;
  let pickOrder = $state<PickOrder>('recent');

  const projectName = (id?: string) =>
    (($projectsQ as Project[] | undefined) ?? []).find((p) => p.id === id)?.name;

  /** The line under a title: where it lives and how big it is. */
  const pickFootnote = (t: Todo): string =>
    [
      projectName(t.projectId),
      t.tag,
      t.takes && durationLabel(t.takes),
      t.energy && energyLabel(t.energy)
    ]
      .filter(Boolean)
      .join(' · ');

  /**
   * The picker's rows, in groups with headings.
   *
   * Grouped rather than merely sorted, because a heading answers "what am I
   * looking at" without having to compare two rows to work it out — the same
   * reasoning as the buy list's shops. Recent keeps one unlabelled group, since
   * a heading over everything says nothing.
   *
   * Empty groups are dropped: a picker lists what you can choose, and a heading
   * with nothing under it is an invitation to wonder what is missing.
   */
  const pickGroups = $derived.by((): { key: string; label: string; todos: Todo[] }[] => {
    const all = candidates;
    if (pickOrder === 'recent') return [{ key: 'all', label: '', todos: all }];

    if (pickOrder === 'time') {
      return [
        ...DURATIONS.map((d) => ({
          key: d.key,
          label: d.label,
          todos: all.filter((t) => t.takes === d.key)
        })),
        { key: 'unsized', label: 'Length not set', todos: all.filter((t) => !t.takes) }
      ].filter((g) => g.todos.length);
    }

    if (pickOrder === 'effort') {
      return [
        ...ENERGIES.map((e) => ({
          key: e.key,
          label: e.label,
          todos: all.filter((t) => t.energy === e.key)
        })),
        { key: 'unsized', label: 'Size not set', todos: all.filter((t) => !t.energy) }
      ].filter((g) => g.todos.length);
    }

    // By era, in the order the eras are listed, with the loose ones last —
    // untagged to-dos are a pile to sort rather than a place to work.
    const eras = ($projectsQ as Project[] | undefined) ?? [];
    return [
      ...eras.map((p) => ({
        key: p.id,
        label: p.name,
        todos: all.filter((t) => t.projectId === p.id)
      })),
      { key: 'none', label: 'Not in an era', todos: all.filter((t) => !t.projectId) }
    ].filter((g) => g.todos.length);
  });
</script>

<div class="flex h-full flex-col">
  <div class="flex-1 overflow-y-auto px-4 pt-safe">
    <header class="pt-3 pb-5">
      <h1 class="large-title">Today</h1>
      <p class="footnote mt-1">
        {#if day?.closedAt}
          Day closed. {doneCount} done.
        {:else if slotTodos.length}
          {doneCount} of {slotTodos.length}
        {:else}
          Nothing planned yet.
        {/if}
      </p>
    </header>

    <!-- Hides itself entirely when there is nothing to show. -->
    <CalendarStrip />

    <!-- The three -->
    <section class="space-y-3">
      {#each slotTodos as todo (todo.id)}
        <div
          class="card rise p-4 transition-colors
                 {todo.completedAt ? 'border-good/30 bg-good/[0.06]' : ''}"
          class:nudge={nudged === todo.id}
        >
          <div class="flex items-start gap-3">
            <!-- relative, so the burst can be centred on the tick rather than
                 on the card: the tick is where the eye already is. -->
            <span class="relative flex shrink-0">
              {#if celebrating === todo.id}
                <Burst />
              {/if}
              <button
                class="press tap flex shrink-0 items-center justify-center rounded-full border-2
                       {todo.completedAt ? 'border-good bg-good text-ink-950' : 'border-ink-600'}"
                class:nudge-ring={nudged === todo.id}
                class:tick-pop={celebrating === todo.id}
                style="width:44px;height:44px"
                onclick={() => onComplete(todo)}
                disabled={!!todo.completedAt}
                aria-label={todo.completedAt ? 'Completed' : `Complete ${todo.title}`}
              >
                {#if todo.completedAt}✓{/if}
              </button>
            </span>
            <div class="min-w-0 flex-1 pt-2">
              <p class="body {todo.completedAt ? 'text-ink-400 line-through' : ''}">
                {todo.title}
              </p>
            </div>
            {#if !todo.completedAt}
              <!-- Skippable without ceremony: no confirm, no guilt copy. -->
              <button
                class="press tap px-2 text-ink-400"
                onclick={() => removeFromDay(todo.id)}
                aria-label="Remove from today"
              >
                ×
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </section>

    {#if !slotTodos.length && !picking}
      <!-- The single prominent button when the day is empty (spec 4.1). It
           opens the full flow; the smaller picker below is only for adding one
           more to a day that already exists. -->
      <!--
        The dinosaur asks. It is the same animal as the icon on the home screen,
        so the thing that got you here is the thing that greets you — and a
        question is a friendlier prompt than a label, given the answer is
        genuinely yours. It sits inside the circle as a silhouette rather than in
        full colour: three greens on an orange gradient is a fight, and at this
        size the shape is the recognisable part anyway.
      -->
      <div class="mt-8 flex justify-center">
        <button
          class="press relative flex aspect-square w-[64%] max-w-[264px] min-w-[200px]
                 items-center justify-center overflow-hidden rounded-full"
          style="background: linear-gradient(135deg, {scene.from}, {scene.to});
                 color: {scene.ink};
                 box-shadow: 0 10px 34px -12px {scene.to}"
          onclick={() => (freeTime = true)}
        >
          <!--
            Scenery: behind the dinosaur, then in front of it, both drawn in a
            100x100 space over the button.

            {@html} is safe here and only here: the markup is a constant in
            freeTimeScenes.ts, written by us and never touched by user input or
            anything off the network. If a scene ever becomes something a person
            can define, this has to stop being @html.
          -->
          {#if scene.behind}
            <svg viewBox="0 0 100 100" class="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true">{@html scene.behind}</svg>
          {/if}

          <!-- Nudged up, so the bottom of the circle is free for scenery at
               ground level without it running through the words. -->
          <span class="relative z-10 flex -translate-y-[6%] flex-col items-center gap-1">
            <span class="opacity-85"><Dino size={76} tone="mono" /></span>
            <span class="text-[1.375rem] font-semibold">Free time?</span>
          </span>

          {#if scene.front}
            <svg viewBox="0 0 100 100" class="pointer-events-none absolute inset-0 z-20 h-full w-full"
              aria-hidden="true">{@html scene.front}</svg>
          {/if}
        </button>
      </div>
      <!-- The dinosaur gets a line. Below the circle rather than inside it: the
           button has to stay one clear thing to press, and there is a screen
           full of room down here. -->
      <p class="mx-auto mt-5 max-w-[19rem] text-center text-[14px] italic text-ink-400">
        {quip}
      </p>

      <!--
        The other way in, for when you already know.
        Free Time asks how long you have and what your head is like before it
        suggests anything, which is the right tool for "what should I do?" and
        the wrong one for "today I am varnishing the campervan". Until this
        existed, an empty day had NO route into the three except that flow —
        the picker below only appears once the day already has something in it,
        so the one case where you most need to put something in was the one
        case you could not.
        Quiet and secondary on purpose: the button above is still the answer
        most days, and this is not a second hero.
      -->
      <div class="mt-5 flex justify-center">
        <!--
          A pill with accent text, NOT muted grey prose. The first version was
          grey and started with "Or", which made it read as a caption under the
          button above — found by accident rather than by looking, and reported
          that way. Quiet is right for a secondary action; invisible is not, and
          the difference is whether it looks like something you can press.
          Same lesson as the add button that had to stop being grey-on-grey.
        -->
        <button
          class="press tap rounded-full bg-surface-1 px-5 text-sm font-medium text-accent"
          onclick={() => (picking = true)}
        >
          Pick something yourself
        </button>
      </div>

    {:else if roomLeft > 0 && !picking}
      <button
        class="press mt-4 w-full rounded-2xl border border-dashed border-line-2 py-4 text-ink-400"
        onclick={() => (picking = true)}
      >
        {#if day?.closedAt}One more?{:else}Add ({roomLeft} left){/if}
      </button>
    {:else if unlockAvailable}
      <!-- Only reachable on an already-closed day, one at a time, never
           visible in advance. -->
      <button
        class="press mt-4 w-full rounded-2xl border border-good/40 py-4 text-good"
        onclick={() => unlockOneMore()}
      >
        One more?
      </button>
    {/if}

    {#if picking}
      <section class="card mt-4 p-3">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="section-label">Pick something</h2>
          <button class="press tap px-2 text-sm text-accent" onclick={() => (picking = false)}>Done</button>
        </div>
        {#if candidates.length}
          <!-- Four ways to look at the same list. Which one you want depends on
               the question in your head right now, and all four of those
               questions are real ones. -->
          <div class="segmented mb-2">
            {#each PICK_ORDERS as o (o.key)}
              <button
                class="press segment {pickOrder === o.key ? 'segment-on' : ''}"
                onclick={() => (pickOrder = o.key)}
              >
                {o.label}
              </button>
            {/each}
          </div>

          <div class="max-h-72 overflow-y-auto">
            {#each pickGroups as group (group.key)}
              {#if group.label}
                <p class="section-label mt-3 mb-1 first:mt-0">{group.label}</p>
              {/if}
              <ul class="space-y-1">
                {#each group.todos.slice(0, 50) as todo (todo.id)}
                  {@const waiting = blockerOf(todo, todoIndex)}
                  <li>
                    <button
                      class="press tap w-full rounded-xl px-3 py-2 text-left text-ink-50"
                      onclick={() => pick(todo)}
                    >
                      <span class={waiting ? 'text-ink-400' : ''}>{todo.title}</span>
                      <!-- Where it lives and how big it is. Without this the row
                           is a bare title, and choosing means recognising every
                           one of them from memory. -->
                      {#if waiting || pickFootnote(todo)}
                        <span class="footnote block">
                          {[waiting ? `after ${waiting.title}` : null, pickFootnote(todo)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/each}
          </div>
        {:else}
          <p class="px-2 py-3 text-sm text-ink-400">
            Nothing open yet. Capture something below — the box is always hungry.
          </p>
        {/if}
      </section>
    {/if}

    <!-- Active habits: large physical tap targets, immediate visual response.
         No streaks, no counts, no percentage. -->
    {#if ($habitsQ as Habit[] | undefined)?.length}
      <section class="mt-8">
        <h2 class="section-label mb-2">Habits</h2>
        <div class="flex flex-wrap gap-2">
          {#each habits as habit (habit.id)}
            {@const done = habitsDone.has(habit.id)}
            <button
              class="press tap relative rounded-2xl border px-4 py-3 text-[15px] font-medium transition-colors
                     {done
                ? 'border-good/50 bg-good/[0.14] text-good'
                : 'border-line-1 bg-surface-1 text-ink-200'}"
              class:nudge={nudged === habit.id}
              class:tick-pop={celebrating === habit.id}
              onclick={() => {
                // Only on the way IN. Unticking something is a correction, and
                // confetti for a correction is the app being pleased about the
                // wrong thing.
                if (!done) celebrate(habit.id);
                void toggleHabitLog(habit.id);
              }}
            >
              {#if celebrating === habit.id}
                <Burst size={108} />
              {/if}
              {done ? '✓ ' : ''}{habit.name}
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <div class="h-8"></div>
  </div>

  <CaptureBox />
</div>

{#if showClose}
  <DayClose onDismiss={() => (showClose = false)} />
{/if}

{#if freeTime}
  <FreeTime onDone={() => (freeTime = false)} />
{/if}

{#if monthly}
  <MonthlySummary summary={monthly} onDismiss={() => (monthly = null)} />
{/if}
