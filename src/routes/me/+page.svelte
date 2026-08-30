<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import type { Habit, HabitState } from '$lib/types';
  import { createHabit } from '$lib/store';
  import { winsSince } from '$lib/queries';
  import { base } from '$app/paths';
  import { onDestroy } from 'svelte';
  import { buildLabel, onUpdateStatus, checkAndApply, type UpdateStatus } from '$lib/pwa';

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

  /**
   * Which build is running, and the way to get a newer one.
   *
   * This lived inside Settings, under Google Drive and Gemini — so the answer to
   * "am I on the new version?" sat below the fold on a phone, inside a screen
   * that is otherwise entirely about connecting accounts. It read as sync
   * configuration, which it is not, and it got missed twice. It belongs here,
   * at the foot of the profile screen, which is where every app puts it.
   */
  let updateStatus = $state<UpdateStatus>('idle');
  const stopUpdate = onUpdateStatus((s) => (updateStatus = s));
  onDestroy(stopUpdate);

  const busyChecking = $derived(updateStatus === 'checking' || updateStatus === 'updating');

  const updateLine = $derived.by(() => {
    switch (updateStatus) {
      case 'checking':
        return 'Looking…';
      case 'current':
        return 'This is the latest version.';
      case 'ready':
        return 'A newer version is ready.';
      case 'updating':
        return 'Updating…';
      case 'failed':
        return "Couldn't check just now — you may be offline.";
      default:
        return 'Tap to check for updates.';
    }
  });
</script>

<div class="px-4 pt-safe pb-8">
  <header class="pt-3 pb-5">
    <h1 class="large-title">Me</h1>
  </header>

  <section class="mb-8">
    <h2 class="section-label mb-2">Habits</h2>

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
        class="field min-w-0 flex-1"
      />
      <button class="btn btn-primary press">Add</button>
    </form>

    {#each ['active', 'dormant', 'retired'] as const as state}
      {#if byState(state).length}
        <h3 class="footnote mb-1 mt-4 capitalize">{state}</h3>
        <ul class="space-y-1">
          {#each byState(state) as h (h.id)}
            <li>
              <a
                href="{base}/me/habits/{h.id}"
                class="card-flat press flex items-center gap-2 px-4 py-3"
              >
                <div class="flex-1">
                  <p>{h.name}</p>
                  <!-- No streak. No percentage. Just which cycle you're in. -->
                  <p class="text-xs text-ink-400">{state} since {since(h.stateChangedAt)}</p>
                </div>
                <span class="text-ink-400">›</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </section>

  <section class="mb-8">
    <h2 class="section-label mb-2">
      Wins — last 90 days
    </h2>
    <ul class="space-y-1">
      {#each ($winsQ ?? []) as w (w.id)}
        <li class="card-flat flex gap-3 px-4 py-3">
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
    <h2 class="section-label mb-2">Settings</h2>
    <a
      href="{base}/me/settings"
      class="list-group list-row press"
    >
      <span>Sync, Google, Gemini</span>
      <span class="text-ink-400">›</span>
    </a>

    <a
      href="{base}/me/import"
      class="list-group list-row press mt-2"
    >
      <span>Import from Notion</span>
      <span class="text-ink-400">›</span>
    </a>
  </section>

  <section class="mt-6">
    <h2 class="section-label mb-2">Version</h2>
    <button
      class="list-group list-row press w-full text-left"
      onclick={checkAndApply}
      disabled={busyChecking}
    >
      <span class="min-w-0 flex-1">
        <span class="block">Built {buildLabel()}</span>
        <span class="footnote">{updateLine}</span>
      </span>
    </button>
  </section>
</div>
