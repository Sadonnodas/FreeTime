<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The filter and order controls of a list, folded away by default.
   *
   * Brain used to open as a control panel: two or three selects and a toggle
   * sitting above every list, read past on every visit, competing with the
   * thing you came to look at. Asked for as decluttering — the same instinct,
   * and the same answer, as the add field that now starts closed behind a
   * button.
   *
   * THE SUMMARY IS THE LOAD-BEARING PART. A filtered list that does not say so
   * is how you come to believe the rest of your to-dos have gone, and hiding
   * the controls makes that failure easier to reach, not harder. So whenever
   * anything is on, the header says what — in the accent, so a filtered list
   * is obvious before you have read a word of it.
   *
   * State is per visit, deliberately not remembered: a filter you cannot see
   * and did not set today is exactly the trap above.
   */
  let {
    label = 'Filter',
    summary = '',
    children
  }: { label?: string; summary?: string; children: Snippet } = $props();

  let open = $state(false);
</script>

<div class="mb-3">
  <button
    class="press tap-h flex w-full items-center gap-2 text-left"
    onclick={() => (open = !open)}
    aria-expanded={open}
  >
    <span
      class="text-[11px] transition-transform duration-200 {open ? 'rotate-90' : ''}"
      style="color: var(--color-ink-400)"
      aria-hidden="true">▶</span
    >
    <span class="section-label">{label}</span>
    {#if summary}
      <span class="footnote min-w-0 flex-1 truncate text-accent">{summary}</span>
    {/if}
  </button>

  {#if open}
    <div class="mt-2">{@render children()}</div>
  {/if}
</div>
