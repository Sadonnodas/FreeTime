<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import type { HabitState } from '$lib/types';
  import { loadHabitDetail, heatmapWeeks, monthLabel, habitColor, ON_COLOR } from '$lib/habits';
  import {
    setHabitState, toggleHabitLog, today, setHabitColor, PROJECT_COLORS, renameHabit, softDelete
  } from '$lib/store';
  import { goto } from '$app/navigation';
  import RenameField from '$lib/components/RenameField.svelte';
  import RemoveButton from '$lib/components/RemoveButton.svelte';

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
    {@const hc = habitColor(habit)}

    <!-- Its name, which could not be changed at all until asked about. -->
    <p class="section-label mb-2">Name</p>
    <div class="mb-4">
      <RenameField value={habit.name} label="Name" onrename={(name) => renameHabit(habit.id, name)} />
    </div>

    <!-- Its colour, the same eight the projects use. Tapping one is the whole
         edit; there is nothing to save. -->
    <p class="section-label mb-2">Colour</p>
    <div class="mb-6 flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
      {#each PROJECT_COLORS as swatch (swatch)}
        <button
          class="press h-9 w-9 rounded-full transition-transform {swatch === hc ? 'scale-110' : ''}"
          style="background: {swatch}; box-shadow: {swatch === hc
            ? `0 0 0 3px var(--color-ink-950), 0 0 0 5px ${swatch}`
            : 'none'}"
          role="radio"
          aria-checked={swatch === hc}
          aria-label="Colour {swatch}"
          onclick={() => setHabitColor(habit.id, swatch)}
        ></button>
      {/each}
    </div>

    <button
      class="press tap mb-6 w-full rounded-2xl border py-4 text-[17px] font-medium transition-colors"
      style:background={loggedToday ? `color-mix(in srgb, ${hc} 30%, var(--color-surface-1))` : 'var(--color-surface-1)'}
      style:border-color={loggedToday ? hc : 'var(--color-line-1)'}
      style:color={'var(--color-ink-50)'}
      onclick={() => toggleHabitLog(habit.id)}
    >
      <!-- The same tick circle as on Today: colour says which habit, the
           circle says whether. -->
      <span class="inline-flex items-center gap-2.5">
        <span
          class="flex h-6 w-6 items-center justify-center rounded-full border-2 text-[13px] font-bold"
          style:border-color={hc}
          style:background={loggedToday ? hc : 'transparent'}
          style:color={ON_COLOR}
          aria-hidden="true">{loggedToday ? '✓' : ''}</span
        >
        {loggedToday ? 'Done today' : 'Log for today'}
      </span>
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
                  class="h-3 w-3 rounded-[2px] {day.on ? '' : 'bg-surface-2'}"
                  style:background={day.on ? hc : undefined}
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

    <!--
      DELETING, for a habit that should never have existed — added while
      testing, or a typo. Different from Retired, and said so: retiring keeps
      the history (the six months above, the cycles), deleting takes the habit
      and its history off every screen. Two taps, like every other delete.
    -->
    <section class="mt-8">
      <h2 class="section-label mb-2">Delete</h2>
      <p class="footnote mb-2">
        Removes the habit and its history from every screen. To stop without losing
        the history, choose Retired above.
      </p>
      <RemoveButton
        label="Delete this habit"
        confirm="Really delete it?"
        full
        onremove={async () => {
          await softDelete('habits', habit.id);
          await goto(`${base}/me`, { replaceState: true });
        }}
      />
    </section>
  {/if}
</div>
