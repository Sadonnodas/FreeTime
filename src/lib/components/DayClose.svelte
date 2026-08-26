<script lang="ts">
  import { onMount } from 'svelte';
  import { winsSince, startOfWeekIso, type Win } from '$lib/queries';

  /**
   * Day-close (spec 6.1). Fires on the third completion and shows this week's
   * closed items across every project.
   *
   * The old workspace only ever showed the backlog, so finished work vanished
   * and the system never gave anything back. This is the payback moment, and it
   * is dismissible rather than persistent — a screen you must clear becomes
   * another chore.
   */
  let { onDismiss }: { onDismiss: () => void } = $props();

  let wins = $state<Win[]>([]);

  onMount(async () => {
    wins = await winsSince(startOfWeekIso());
  });
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-ink-950/95 backdrop-blur">
  <div class="flex-1 overflow-y-auto px-6 pt-safe">
    <div class="py-10 text-center">
      <p class="text-5xl">✓</p>
      <h2 class="mt-4 text-2xl font-semibold">Day closed.</h2>
      <p class="mt-1 text-ink-400">That's a full day. Anything else is a bonus.</p>
    </div>

    {#if wins.length}
      <h3 class="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
        Closed this week — {wins.length}
      </h3>
      <ul class="space-y-1 pb-6">
        {#each wins as win (win.id)}
          <li class="rounded-xl bg-ink-900 px-4 py-3 text-ink-200">{win.text}</li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="p-6 pb-safe">
    <button
      class="w-full rounded-2xl bg-accent py-4 text-lg font-medium text-ink-950"
      onclick={onDismiss}
    >
      Nice
    </button>
  </div>
</div>
