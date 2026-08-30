<script lang="ts">
  import type { MonthlySummary } from '$lib/monthly';
  import { markShown } from '$lib/monthly';

  /**
   * Arrives once a month, unasked (spec 6.2). Marked shown the moment it
   * renders, not when dismissed — see monthly.ts for why.
   */
  let { summary, onDismiss }: { summary: MonthlySummary; onDismiss: () => void } = $props();

  // Fire and forget. If this somehow failed, the worst case is seeing it twice,
  // which is much better than blocking the screen on a write.
  void markShown();

  const projects = $derived(summary.projectCount);
</script>

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex-1 overflow-y-auto px-6 pt-safe">
    <div class="py-10">
      <p class="section-label">{summary.label}</p>
      <h2 class="mt-3 text-[34px] font-bold leading-[1.08] tracking-[-0.03em]">
        {summary.wins.length}
        {summary.wins.length === 1 ? 'thing' : 'things'} closed{#if projects > 0}
          across {projects}
          {projects === 1 ? 'era' : 'eras'}{/if}.
      </h2>
      <!-- No comparison to the month before, no trend, no target. A number you
           can be down on is a number you can fail at. -->
    </div>

    <ul class="space-y-1 pb-6">
      {#each summary.wins as win (win.id)}
        <li class="card-flat px-4 py-3 text-ink-200">{win.text}</li>
      {/each}
    </ul>
  </div>

  <div class="p-6 pb-safe">
    <button
      class="btn btn-primary press w-full py-4 text-[17px]"
      onclick={onDismiss}
    >
      Good
    </button>
  </div>
</div>
