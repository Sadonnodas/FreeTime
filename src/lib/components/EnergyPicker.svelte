<script lang="ts">
  import type { Energy } from '$lib/types';

  /**
   * How big a job this is — what Free Time matches against the time you have.
   *
   * An unset energy always PASSES the Free Time filter (freetime.ts), so a
   * to-do without one is never hidden. It is also never ruled out, which is the
   * real cost: with twenty minutes free you can be handed something that takes
   * half a day. The filter is only as good as how many to-dos carry a size, and
   * nobody goes back through a list to add them afterwards — so this is offered
   * where to-dos are written, not only where they are edited.
   *
   * Still optional. Ignoring it writes the to-do anyway.
   */
  export const ENERGIES: { key: Energy; label: string; hint: string }[] = [
    { key: 'quick', label: 'Quick', hint: 'a few minutes' },
    { key: 'moderate', label: 'Moderate', hint: 'a sitting' },
    { key: 'focus', label: 'Focus', hint: 'a long block' }
  ];

  let {
    value,
    onpick,
    unset = true,
    hint = true
  }: {
    value?: Energy;
    onpick: (energy?: Energy) => void;
    /** An explicit "Not sure", for clearing one already set. */
    unset?: boolean;
    hint?: boolean;
  } = $props();
</script>

<!--
  type="button" on every one of these, and it is load-bearing.

  A <button> inside a <form> is type="submit" by default, so in the Brain add
  form choosing a size SUBMITTED it: the to-do was written the instant you said
  how big it was, before you could pick its era, its project or its date.
-->
<div class="flex flex-wrap gap-2">
  {#if unset}
    <button
      type="button"
      class="chip press {value ? '' : 'chip-on'}"
      onclick={() => onpick(undefined)}
    >
      Not sure
    </button>
  {/if}
  {#each ENERGIES as e (e.key)}
    <button
      type="button"
      class="chip press {value === e.key ? 'chip-on' : ''}"
      onclick={() => onpick(value === e.key ? undefined : e.key)}
    >
      {e.label}
    </button>
  {/each}
</div>

{#if hint}
  <p class="footnote mt-2">
    {ENERGIES.find((e) => e.key === value)?.hint ??
      'Left unset it still shows in Free Time — it just cannot be ruled out of a short window.'}
  </p>
{/if}
