<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Habit, HabitState } from '$lib/types';
  import { createHabit, setHabitState } from '$lib/store';
  import { winsSince } from '$lib/queries';
  import { base } from '$app/paths';

  const habitsQ = liveQuery(async () =>
    (await db.habits.toArray()).filter((h) => !h.deletedAt)
  );

  // The browsable full history (spec 6) — here for when the user wants it, not
  // pushed at them. Ninety days back is plenty without being a wall of text.
  const winsQ = liveQuery(() => {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    return winsSince(since.toISOString());
  });

  let newHabit = $state('');

  const byState = (s: HabitState) =>
    (($habitsQ as Habit[] | undefined) ?? []).filter((h) => h.state === s);

  /**
   * Cycle history (spec 3.6) instead of streaks. "Active since March" reframes
   * "I abandoned guitar again" as "this is the fourth cycle, and they always
   * come back". A streak counter can only ever tell you that you broke it.
   */
  const since = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
</script>

<div class="px-4 pt-safe pb-8">
  <header class="py-4">
    <h1 class="text-2xl font-semibold tracking-tight">Me</h1>
  </header>

  <section class="mb-8">
    <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Habits</h2>

    <form
      onsubmit={async (e) => {
        e.preventDefault();
        if (!newHabit.trim()) return;
        await createHabit(newHabit);
        newHabit = '';
      }}
      class="mb-3 flex gap-2"
    >
      <input
        bind:value={newHabit}
        placeholder="New habit"
        class="tap flex-1 rounded-xl border border-ink-700 bg-ink-800 px-4 outline-none
               focus:border-accent"
      />
      <button class="tap rounded-xl bg-accent px-5 font-medium text-ink-950">Add</button>
    </form>

    {#each ['active', 'dormant', 'retired'] as const as state}
      {#if byState(state).length}
        <h3 class="mb-1 mt-4 text-xs capitalize text-ink-400">{state}</h3>
        <ul class="space-y-1">
          {#each byState(state) as h (h.id)}
            <li class="flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-3">
              <div class="flex-1">
                <p>{h.name}</p>
                <!-- No streak. No percentage. Just which cycle you're in. -->
                <p class="text-xs text-ink-400">{state} since {since(h.stateChangedAt)}</p>
              </div>
              <select
                value={h.state}
                onchange={(e) => setHabitState(h.id, e.currentTarget.value as HabitState)}
                class="tap rounded-lg border border-ink-700 bg-ink-800 px-2 text-sm text-ink-200"
              >
                <option value="active">Active</option>
                <option value="dormant">Dormant</option>
                <option value="retired">Retired</option>
              </select>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </section>

  <section class="mb-8">
    <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
      Wins — last 90 days
    </h2>
    <ul class="space-y-1">
      {#each ($winsQ ?? []) as w (w.id)}
        <li class="flex gap-3 rounded-xl bg-ink-900 px-4 py-3">
          <span class="flex-1">{w.text}</span>
          <span class="shrink-0 text-xs text-ink-400">
            {new Date(w.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        </li>
      {:else}
        <li class="py-6 text-center text-sm text-ink-400">
          Nothing closed yet. It fills itself in.
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Settings</h2>
    <a
      href="{base}/me/settings"
      class="flex items-center justify-between rounded-xl bg-ink-900 px-4 py-4"
    >
      <span>Sync, Google, Gemini</span>
      <span class="text-ink-400">›</span>
    </a>
  </section>
</div>
