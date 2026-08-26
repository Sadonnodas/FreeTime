<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import type { HabitState } from '$lib/types';
  import { loadHabitDetail, heatmapWeeks, monthLabel } from '$lib/habits';
  import { setHabitState, toggleHabitLog, today } from '$lib/store';

  /**
   * Habit detail (spec 3.6): a calendar heatmap and a cycle history.
   *
   * No streak. No percentage. No target. The two things shown are "when did you
   * actually do this" and "which cycle are you in" — both descriptive, neither
   * a score you can fall behind on.
   */
  const id = $derived(page.params.id!);

  const detailQ = $derived(liveQuery(() => loadHabitDetail(id)));

  const grid = $derived(heatmapWeeks($detailQ?.logDates ?? []));
  const loggedToday = $derived(($detailQ?.logDates ?? []).includes(today()));

  const STATE_NOTE: Record<HabitState, string> = {
    active: 'Showing on Today.',
    dormant: 'Resting. History is kept, and it can come back any time.',
    retired: 'Put away for good. History is still kept.'
  };
</script>

<div class="px-4 pt-safe pb-8">
  <header class="py-4">
    <a href="{base}/me" class="text-sm text-ink-400">← Me</a>
    <h1 class="mt-1 text-2xl font-semibold tracking-tight">{$detailQ?.habit.name ?? ''}</h1>
  </header>

  {#if $detailQ}
    {@const habit = $detailQ.habit}

    <button
      class="tap mb-6 w-full rounded-2xl border py-4 text-lg transition-colors
             {loggedToday
        ? 'border-good bg-good/15 text-good'
        : 'border-ink-700 bg-ink-900 text-ink-200'}"
      onclick={() => toggleHabitLog(habit.id)}
    >
      {loggedToday ? '✓ Done today' : 'Log for today'}
    </button>

    <section class="mb-8">
      <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
        Last six months
      </h2>
      <!-- Each cell is on or off. Nothing is shaded by intensity, because
           shading against a goal is a completion percentage in a costume. -->
      <div class="overflow-x-auto">
        <div class="flex gap-[3px]">
          {#each grid as week, w (w)}
            <div class="flex flex-col gap-[3px]">
              {#each week as day (day.date)}
                <div
                  class="h-3 w-3 rounded-[2px] {day.on ? 'bg-good' : 'bg-ink-800'}"
                  title={day.date}
                ></div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
      <p class="mt-2 text-xs text-ink-400">
        {$detailQ.logDates.length} logged, all time.
      </p>
    </section>

    <section class="mb-8">
      <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Cycles</h2>
      <ul class="space-y-1">
        {#each $detailQ.cycles as cycle, i (i)}
          <li class="flex items-center gap-3 rounded-xl bg-ink-900 px-4 py-3">
            <span
              class="h-2 w-2 shrink-0 rounded-full
                     {cycle.state === 'active' ? 'bg-good' : 'bg-ink-600'}"
            ></span>
            <div class="flex-1">
              <p class="capitalize">{cycle.state}</p>
              <p class="text-xs text-ink-400">
                {monthLabel(cycle.from)} – {cycle.to ? monthLabel(cycle.to) : 'now'}
              </p>
            </div>
            <span class="text-xs text-ink-400">{cycle.logCount}</span>
          </li>
        {/each}
      </ul>
      {#if $detailQ.cycles.filter((c) => c.state === 'active').length > 1}
        <!-- The whole reason cycles exist rather than streaks. -->
        <p class="mt-2 text-xs text-ink-400">
          You've come back to this {$detailQ.cycles.filter((c) => c.state === 'active').length} times.
        </p>
      {/if}
    </section>

    <section>
      <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">State</h2>
      <div class="space-y-2">
        {#each ['active', 'dormant', 'retired'] as const as state}
          <button
            class="tap w-full rounded-xl border px-4 py-3 text-left
                   {habit.state === state
              ? 'border-accent bg-ink-900'
              : 'border-ink-800 bg-ink-900/50'}"
            onclick={() => setHabitState(habit.id, state)}
          >
            <span class="block capitalize">{state}</span>
            <span class="block text-xs text-ink-400">{STATE_NOTE[state]}</span>
          </button>
        {/each}
      </div>
      <p class="mt-2 text-xs text-ink-400">
        Moving a habit is always your call — the app never decides you've stopped.
      </p>
    </section>
  {/if}
</div>
