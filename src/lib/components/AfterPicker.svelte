<script lang="ts">
  import type { Todo } from '$lib/types';

  /**
   * "This comes after that."
   *
   * A select and not a chip row: the options are whole to-do titles, which are
   * sentences, and a dozen sentences as chips is a wall. The list is already
   * filtered to what is legal — never itself, never something that waits on
   * this one further down the chain, never something already done — so there is
   * no error state to explain and nothing to refuse after the fact.
   */
  let {
    value,
    options,
    onpick
  }: {
    value?: string;
    options: Todo[];
    onpick: (after?: string) => void;
  } = $props();
</script>

{#if options.length}
  <select
    class="field press w-full text-sm"
    aria-label="Comes after"
    value={value ?? ''}
    onchange={(e) => onpick(e.currentTarget.value || undefined)}
  >
    <option value="">Nothing — it can start now</option>
    {#each options as o (o.id)}
      <option value={o.id}>{o.title}</option>
    {/each}
  </select>
{:else}
  <p class="footnote">Nothing else here for it to wait for yet.</p>
{/if}
