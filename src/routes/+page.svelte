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
    <header class="py-4">
      <h1 class="text-2xl font-semibold tracking-tight">Today</h1>
      <p class="text-sm text-ink-400">
        {#if day?.closedAt}
          Day closed. {doneCount} done.
        {:else if slotTodos.length}
          {doneCount} of {slotTodos.length}
        {:else}
          Nothing planned yet.
        {/if}
      </p>
    </header>

    <!-- Calendar strip (spec 4.1) is hidden entirely until Calendar is
         connected in phase 8 — an empty strip would just be noise. -->

    <!-- The three -->
    <section class="space-y-3">
      {#each slotTodos as todo (todo.id)}
        <div
          class="rounded-2xl border p-4 transition-colors
                 {todo.completedAt ? 'border-good/40 bg-good/5' : 'border-ink-700 bg-ink-900'}"
        >
          <div class="flex items-start gap-3">
            <button
              class="tap flex items-center justify-center rounded-full border-2 shrink-0
                     {todo.completedAt ? 'border-good bg-good text-ink-950' : 'border-ink-600'}"
              style="width:44px;height:44px"
              onclick={() => onComplete(todo)}
              disabled={!!todo.completedAt}
              aria-label={todo.completedAt ? 'Completed' : `Complete ${todo.title}`}
            >
              {#if todo.completedAt}✓{/if}
            </button>
            <div class="min-w-0 flex-1 pt-2">
              <p class="text-lg leading-snug {todo.completedAt ? 'text-ink-400 line-through' : ''}">
                {todo.title}
              </p>
            </div>
            {#if !todo.completedAt}
              <!-- Skippable without ceremony: no confirm, no guilt copy. -->
              <button
                class="tap px-2 text-ink-400"
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
      <button
        class="mt-6 w-full rounded-2xl bg-accent px-6 py-8 text-xl font-semibold text-ink-950"
        onclick={() => (picking = true)}
      >
        Free Time
      </button>
      <p class="mt-3 text-center text-xs text-ink-400">
        Three is a full day. Two is a complete one.
      </p>
    {:else if roomLeft > 0 && !picking}
      <button
        class="mt-4 w-full rounded-2xl border border-dashed border-ink-700 py-4 text-ink-400"
        onclick={() => (picking = true)}
      >
        {#if day?.closedAt}One more?{:else}Add ({roomLeft} left){/if}
      </button>
    {:else if unlockAvailable}
      <!-- Only reachable on an already-closed day, one at a time, never
           visible in advance. -->
      <button
        class="mt-4 w-full rounded-2xl border border-good/50 py-4 text-good"
        onclick={() => unlockOneMore()}
      >
        One more?
      </button>
    {/if}

    {#if picking}
      <section class="mt-4 rounded-2xl border border-ink-700 bg-ink-900 p-3">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-medium text-ink-200">Pick something</h2>
          <button class="tap px-2 text-ink-400" onclick={() => (picking = false)}>Done</button>
        </div>
        {#if candidates.length}
          <ul class="max-h-72 space-y-1 overflow-y-auto">
            {#each candidates.slice(0, 50) as todo (todo.id)}
              <li>
                <button
                  class="tap w-full rounded-xl px-3 py-2 text-left text-ink-50 hover:bg-ink-800"
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
        <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Habits</h2>
        <div class="flex flex-wrap gap-2">
          {#each $habitsQ as Habit[] as habit (habit.id)}
            {@const done = (($logsTodayQ as { habitId: string }[] | undefined) ?? []).some(
              (l) => l.habitId === habit.id
            )}
            <button
              class="tap rounded-2xl border px-4 py-3 text-sm transition-colors
                     {done
                ? 'border-good bg-good/15 text-good'
                : 'border-ink-700 bg-ink-900 text-ink-200'}"
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
