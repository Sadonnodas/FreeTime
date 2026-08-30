<script lang="ts">
  import { stickerFor, stickerUrl } from '$lib/stickers';

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
   *
   * WHICH dinosaur is decided by the line itself, so a given empty state always
   * has the same one. A mascot that changed on every render would read as a
   * glitch rather than as a character, and this component re-renders whenever
   * anything else on the page does.
   *
   * It sits on a tinted disc for the same reason a project cover does: the art
   * is drawn with near-black outlines, and on the near-black page it would lose
   * its edges and become a smudge of colour.
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

  const sticker = $derived(stickerFor(line));

  /** The same hue-from-a-name used by project covers. */
  const hue = $derived.by(() => {
    let h = 0;
    for (const ch of line) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  });
</script>

<div class="flex flex-col items-center px-6 py-10 text-center">
  <span
    class="flex items-center justify-center rounded-[22px] p-2"
    style="width: {size * 1.5}px; height: {size * 1.5}px;
           background: linear-gradient(150deg, hsl({hue} 52% 84%), hsl({(hue + 40) % 360} 44% 70%))"
  >
    <img
      src={stickerUrl(sticker)}
      alt={sticker.label}
      loading="lazy"
      class="h-full w-full object-contain"
    />
  </span>
  <p class="footnote mt-3 max-w-xs">{line}</p>
  {#if quip}
    <p class="footnote mt-1 max-w-xs italic opacity-70">{quip}</p>
  {/if}
</div>
