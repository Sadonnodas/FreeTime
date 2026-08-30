<script lang="ts">
  import Dino from './Dino.svelte';

  /**
   * An empty state with the mascot in it.
   *
   * These are the moments the app feels most like nowhere — a fresh install, a
   * section nobody has filled, a month with nothing in it. The dinosaur turns
   * "there is nothing here" into someone telling you there is nothing here,
   * which is a different feeling for the same fact.
   *
   * The jokes stay on one side of a line. They are about the dinosaur, geology
   * and deep time — never about you and never about what you have not done.
   * "Nothing closed yet" must read as a fact, not as a comment, or the app has
   * quietly become the thing it was built to escape.
   */
  let {
    line,
    quip = '',
    size = 64
  }: {
    /** The plain statement of fact. Must stand alone if the joke falls flat. */
    line: string;
    /** The dinosaur's aside. Always optional, never load-bearing. */
    quip?: string;
    size?: number;
  } = $props();
</script>

<div class="flex flex-col items-center px-6 py-10 text-center">
  <span class="text-ink-600">
    <Dino {size} tone="mono" />
  </span>
  <p class="footnote mt-3 max-w-xs">{line}</p>
  {#if quip}
    <p class="footnote mt-1 max-w-xs italic opacity-70">{quip}</p>
  {/if}
</div>
