<script lang="ts">
  import { WEEKDAYS, repeatLabel } from '$lib/recurring';

  /**
   * Which days a to-do comes round on.
   *
   * Seven letters to tap, and the sentence underneath — "Every Thursday" —
   * because three lit letters in a row of seven is a puzzle to read back and a
   * sentence is not. The same division the WhenPicker uses: chips to choose
   * with, words to confirm by.
   *
   * "Doesn't repeat" is a chip rather than an empty state, so turning a
   * recurring to-do back into an ordinary one is one tap and is visibly there
   * — the same reason WhenPicker has "Someday".
   */
  let {
    value,
    onpick
  }: {
    value?: number[];
    onpick: (days?: number[]) => void;
  } = $props();

  const on = $derived(new Set(value ?? []));

  function toggle(day: number) {
    const next = new Set(on);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onpick(next.size ? [...next].sort((a, b) => a - b) : undefined);
  }
</script>

<div class="flex flex-wrap items-center gap-2">
  <button type="button" class="chip press {on.size ? '' : 'chip-on'}" onclick={() => onpick(undefined)}>
    Doesn't repeat
  </button>
  <div class="flex gap-1">
    {#each WEEKDAYS as w (w.day)}
      <button
        type="button"
        class="press flex h-9 w-9 items-center justify-center rounded-full border text-[13px] font-medium
               {on.has(w.day)
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-line-1 bg-surface-1 text-ink-300'}"
        aria-pressed={on.has(w.day)}
        aria-label={w.label}
        onclick={() => toggle(w.day)}>{w.short}</button
      >
    {/each}
  </div>
</div>
{#if repeatLabel(value)}
  <p class="footnote mt-1.5">
    {repeatLabel(value)}. It comes back on those days and is not there on the others.
  </p>
{/if}
