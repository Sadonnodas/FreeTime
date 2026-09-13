<script lang="ts">
  import { markWeekShown, type WeeklySummary, type WeeklyKind } from '$lib/weekly';
  import { tintFor } from '$lib/colors';
  import { onMount } from 'svelte';

  /**
   * Last week, arriving once on the first open of a new one. See weekly.ts for
   * the rules that keep it a look-back rather than a planning view.
   *
   * Marked shown the moment it renders, not when dismissed, exactly like the
   * monthly summary: one that waits to be properly received is one that comes
   * back, and anything that comes back uninvited is a nag.
   *
   * Grouped under the era and project each thing belongs to, in the same two
   * colours those rows wear in Brain and on Today — so "the campervan had a good
   * week" is a patch of one colour you can see before reading a word.
   */
  let { summary, onDismiss }: { summary: WeeklySummary; onDismiss: () => void } = $props();

  // Fire and forget, once, when it first renders. The worst case of this
  // failing is seeing it twice, which is far better than holding the screen on
  // a write.
  onMount(() => void markWeekShown(summary.key));

  /** How each kind reads under its row. A closed to-do says nothing — it is
   *  the default thing that gets done, and labelling every one is noise. */
  const KIND: Record<WeeklyKind, string | null> = {
    closed: null,
    finished: 'finished',
    bought: 'bought',
    recorded: 'recorded'
  };

  const heading = (g: WeeklySummary['groups'][number]) =>
    g.era ? [g.era.name, g.tag].filter(Boolean).join(' · ') : 'Not filed anywhere';
</script>

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex-1 overflow-y-auto px-6 pt-safe">
    <div class="pt-10 pb-6">
      <p class="section-label">Last week · {summary.label}</p>
      <h2 class="mt-3 text-[34px] leading-[1.08] font-bold tracking-[-0.03em]">
        {#if summary.total}
          {summary.total} {summary.total === 1 ? 'thing' : 'things'} got done.
        {:else}
          You kept at it.
        {/if}
      </h2>
      <!-- No comparison with the week before, no trend, no target. A number
           you can be down on is a number you can fail at. -->
    </div>

    {#each summary.groups as group (heading(group))}
      {@const tint = tintFor(group.era, group.tag)}
      <section class="mb-4">
        <p class="section-label mb-2 flex items-center gap-2">
          {#if tint}
            <span
              class="inline-block h-2 w-2 rounded-full"
              style="background: {tint.fill}"
              aria-hidden="true"
            ></span>
          {/if}
          {heading(group)}
        </p>
        <ul class="space-y-1">
          {#each group.items as item (item.id)}
            <li
              class="card-flat flex items-baseline gap-3 px-4 py-3 {tint ? 'row-tint' : ''}"
              style:--row={tint?.fill}
              style:--edge={tint?.edge}
            >
              <span class="min-w-0 flex-1 text-ink-200">{item.text}</span>
              {#if KIND[item.kind]}
                <span class="footnote shrink-0">{KIND[item.kind]}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if summary.habits.length}
      <!-- Days, never "out of 7": that would be a completion percentage, and
           those are banned outright. -->
      <section class="mb-4">
        <p class="section-label mb-2">Habits</p>
        <ul class="space-y-1">
          {#each summary.habits as habit (habit.name)}
            <li class="card-flat flex items-baseline gap-3 px-4 py-3">
              <span class="min-w-0 flex-1 text-ink-200">{habit.name}</span>
              <span class="footnote shrink-0 tabular-nums">
                {habit.days} {habit.days === 1 ? 'day' : 'days'}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="h-4"></div>
  </div>

  <div class="p-6 pb-safe">
    <button class="btn btn-primary press w-full py-4 text-[17px]" onclick={onDismiss}>
      Good
    </button>
  </div>
</div>
