<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Todo, Habit, Day } from '$lib/types';
  import { completeTodo, toggleHabitLog, today } from '$lib/store';
  import { openTodos } from '$lib/queries';
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
  const openQ = liveQuery(() => openTodos());

  let slotTodos = $state<Todo[]>([]);
  let showClose = $state(false);
  let unlockAvailable = $state(false);
  let picking = $state(false);
  let freeTime = $state(false);

  // Arrives on the first open on or after the 1st, then never again that month.
  let monthly = $state<Summary | null>(null);
  onMount(async () => {
    monthly = await pendingMonthlySummary();
  });

  // Resolve the day's slot ids into actual todos, in slot order.
  $effect(() => {
    const day = $dayQ as Day | undefined;
    if (!day) return;
    const ids = day.slots;
    db.todos.bulkGet(ids).then((rows) => {
      slotTodos = ids
        .map((id) => rows.find((r) => r?.id === id))
        .filter((t): t is Todo => !!t && !t.deletedAt);
    });
  });

  $effect(() => {
    void $dayQ;
    canUnlockOneMore().then((v) => (unlockAvailable = v));
  });

  async function onComplete(todo: Todo) {
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

  const day = $derived($dayQ as Day | undefined);
  const roomLeft = $derived(day ? day.unlockedCount - day.slots.length : 0);
  const doneCount = $derived(slotTodos.filter((t) => t.completedAt).length);
  const candidates = $derived(
    (($openQ as Todo[] | undefined) ?? []).filter((t) => !day?.slots.includes(t.id))
  );
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
        >
          <div class="flex items-start gap-3">
            <button
              class="press tap flex shrink-0 items-center justify-center rounded-full border-2
                     {todo.completedAt ? 'border-good bg-good text-ink-950' : 'border-ink-600'}"
              style="width:44px;height:44px"
              onclick={() => onComplete(todo)}
              disabled={!!todo.completedAt}
              aria-label={todo.completedAt ? 'Completed' : `Complete ${todo.title}`}
            >
              {#if todo.completedAt}✓{/if}
            </button>
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
      <button
        class="btn-hero press mt-7 w-full px-6 py-9 text-[1.375rem] font-semibold"
        onclick={() => (freeTime = true)}
      >
        Free Time
      </button>
      <button
        class="press mt-4 w-full text-center text-[13px] text-ink-400"
        onclick={() => (picking = true)}
      >
        or just pick something yourself
      </button>
    {:else if roomLeft > 0 && !picking}
      <button
        class="press mt-4 w-full rounded-2xl border border-dashed border-white/12 py-4 text-ink-400"
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
          <ul class="max-h-72 space-y-1 overflow-y-auto">
            {#each candidates.slice(0, 50) as todo (todo.id)}
              <li>
                <button
                  class="press tap w-full rounded-xl px-3 py-2 text-left text-ink-50"
                  onclick={() => pick(todo)}
                >
                  {todo.title}
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="px-2 py-3 text-sm text-ink-400">
            Nothing open yet. Capture something below.
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
          {#each $habitsQ as Habit[] as habit (habit.id)}
            {@const done = (($logsTodayQ as { habitId: string }[] | undefined) ?? []).some(
              (l) => l.habitId === habit.id
            )}
            <button
              class="press tap rounded-2xl border px-4 py-3 text-[15px] font-medium transition-colors
                     {done
                ? 'border-good/50 bg-good/[0.14] text-good'
                : 'border-white/8 bg-white/[0.05] text-ink-200'}"
              onclick={() => toggleHabitLog(habit.id)}
            >
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
