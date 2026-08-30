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
    <a href="{base}/me" class="press footnote inline-block">‹ Me</a>
    <h1 class="large-title mt-1">{$detailQ?.habit.name ?? ''}</h1>
  </header>

  {#if $detailQ}
    {@const habit = $detailQ.habit}

    <button
      class="press tap mb-6 w-full rounded-2xl border py-4 text-[17px] font-medium transition-colors
             {loggedToday
        ? 'border-good/50 bg-good/[0.14] text-good'
        : 'border-line-1 bg-surface-1 text-ink-200'}"
      onclick={() => toggleHabitLog(habit.id)}
    >
      {loggedToday ? '✓ Done today' : 'Log for today'}
    </button>

    <section class="mb-8">
      <h2 class="section-label mb-2">
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
                  class="h-3 w-3 rounded-[2px] {day.on ? 'bg-good' : 'bg-surface-2'}"
                  title={day.date}
                ></div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
      <p class="footnote mt-2">
        {$detailQ.logDates.length} logged, all time.
      </p>
    </section>

    <section class="mb-8">
      <h2 class="section-label mb-2">Cycles</h2>
      <ul class="space-y-1">
        {#each $detailQ.cycles as cycle, i (i)}
          <li class="card-flat flex items-center gap-3 px-4 py-3">
            <span
              class="h-2 w-2 shrink-0 rounded-full
                     {cycle.state === 'active' ? 'bg-good' : 'bg-ink-600'}"
            ></span>
            <div class="flex-1">
              <p class="capitalize">{cycle.state}</p>
              <p class="footnote">
                {monthLabel(cycle.from)} – {cycle.to ? monthLabel(cycle.to) : 'now'}
              </p>
            </div>
            <span class="text-xs text-ink-400">{cycle.logCount}</span>
          </li>
        {/each}
      </ul>
      {#if $detailQ.cycles.filter((c) => c.state === 'active').length > 1}
        <!-- The whole reason cycles exist rather than streaks. -->
        <p class="footnote mt-2">
          You've come back to this {$detailQ.cycles.filter((c) => c.state === 'active').length} times.
        </p>
      {/if}
    </section>

    <section>
      <h2 class="section-label mb-2">State</h2>
      <div class="space-y-2">
        {#each ['active', 'dormant', 'retired'] as const as state}
          <button
            class="press tap w-full rounded-2xl border px-4 py-3 text-left
                   {habit.state === state
              ? 'border-accent/60 bg-accent/[0.08]'
              : 'border-line-1 bg-surface-1'}"
            onclick={() => setHabitState(habit.id, state)}
          >
            <span class="block capitalize">{state}</span>
            <span class="block text-xs text-ink-400">{STATE_NOTE[state]}</span>
          </button>
        {/each}
      </div>
      <p class="footnote mt-2">
        Moving a habit is always your call — the app never decides you've stopped.
      </p>
    </section>
  {/if}
</div>
