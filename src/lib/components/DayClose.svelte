<script lang="ts">
  import { onMount } from 'svelte';
  import { winsSince, startOfWeekIso, type Win } from '$lib/queries';
  import Dino from './Dino.svelte';

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

  /**
   * The one place the dinosaur gets to be pleased.
   *
   * Rotated so closing a day twice in a week does not produce the same line
   * twice — a canned response stops reading as congratulations the second time
   * you see it. Every one of them is about the day being done, never about how
   * much was done or what is left, which is the difference between a payback
   * moment and a scoreboard.
   */
  const CHEERS = [
    'You absolutely stomped it.',
    'Three down. Positively Jurassic.',
    'A roaring success.',
    'Well done — that is one for the fossil record.',
    'Mesozoic levels of productivity.',
    'Dino-mite.'
  ];
  const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)];
</script>

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex-1 overflow-y-auto px-6 pt-safe">
    <div class="py-10 text-center">
      <span class="inline-block text-good"><Dino size={96} tone="mono" /></span>
      <h2 class="large-title mt-3">Day closed.</h2>
      <p class="footnote mt-1">That's a full day. Anything else is a bonus.</p>
      <p class="footnote mt-2 italic opacity-75">{cheer}</p>
    </div>

    {#if wins.length}
      <h3 class="section-label mb-3">
        Closed this week — {wins.length}
      </h3>
      <ul class="space-y-1 pb-6">
        {#each wins as win (win.id)}
          <li class="card-flat px-4 py-3 text-ink-200">{win.text}</li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="p-6 pb-safe">
    <button
      class="btn btn-primary press w-full py-4 text-[17px]"
      onclick={onDismiss}
    >
      Nice
    </button>
  </div>
</div>
