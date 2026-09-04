<script lang="ts">
  import type { TimeBucket } from '$lib/types';

  /**
   * How long a job takes — the other axis from EnergyPicker, and independent
   * of it. Sanding a board is easy and takes an afternoon; a decision you have
   * been avoiding is twenty minutes of hard thinking.
   *
   * The buckets are the SAME ones Free Time asks about ("how much time do you
   * have?"), so the two questions line up exactly and the filter is a
   * comparison rather than a translation. The old model had one, mapping a
   * time window onto an effort ceiling, and it made "20 minutes free" mean
   * "quick wins only" — which is wrong in both directions.
   *
   * Unset always passes the filter, like effort: a job with no estimate is not
   * assumed to be a long one.
   */
  export const DURATIONS: { key: TimeBucket; label: string }[] = [
    { key: '20min', label: '20 min' },
    { key: '1-2h', label: 'An hour or two' },
    { key: 'half day', label: 'Half a day' },
    { key: 'all day', label: 'All day' }
  ];

  let {
    value,
    onpick,
    unset = true
  }: {
    value?: TimeBucket;
    onpick: (takes?: TimeBucket) => void;
    unset?: boolean;
  } = $props();
</script>

<!-- type="button" on every one: a <button> in a <form> submits it by default,
     which once wrote the to-do the instant its size was chosen. -->
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
  {#each DURATIONS as d (d.key)}
    <button
      type="button"
      class="chip press {value === d.key ? 'chip-on' : ''}"
      onclick={() => onpick(value === d.key ? undefined : d.key)}
    >
      {d.label}
    </button>
  {/each}
</div>
