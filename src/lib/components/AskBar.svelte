<script lang="ts">
  import { onMount } from 'svelte';
  import { hasApiKey } from '$lib/gemini/client';
  import Assistant from './Assistant.svelte';

  /**
   * The assistant, as a floating button over the Today screen.
   *
   * WHAT THIS REPLACED, AND WHY IT KEEPS MOVING. Today used to carry a full
   * capture row — a text field, a record button, an assistant button and Add.
   * That went when it turned out not to be how the app is used: things get
   * written where they belong, not captured loose and filed later. The
   * assistant was the one part worth keeping, and the first attempt simply left
   * it where it was: a small labelled button alone in the bar the row used to
   * fill. Reported as *"a sad little button now that sits at the bottom. It
   * feels very out of place"* — fairly, because a bar exists to hold a row of
   * things, and a bar holding one thing reads as the leftovers of something
   * that was taken away.
   *
   * So it stops pretending to be a bar. A round button floating over the page
   * is a shape that means one action and does not imply a missing row, and it
   * gives the page its full width back — the bar was drawing a hairline and a
   * band of glass across Today to hold a single 70px button.
   *
   * It sits above the tab bar, clear of the safe area, and is deliberately
   * SMALL and quiet next to the Free Time circle: this screen has one hero and
   * it is not this. Hidden entirely without a Gemini key, like every other AI
   * surface — a dead button is worse than one that was never offered.
   */
  let hasKey = $state(false);
  let open = $state(false);

  onMount(async () => {
    hasKey = await hasApiKey();
  });
</script>

{#if hasKey}
  <!--
    Fixed, not absolute: it stays put while the day scrolls under it. The offset
    clears the tab bar (its own height plus the phone's home indicator), which
    is why it is computed rather than a round number.
  -->
  <button
    class="press fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full
           text-[22px] text-accent shadow-lg"
    style="bottom: calc(env(safe-area-inset-bottom, 0px) + 74px);
           background: color-mix(in srgb, var(--color-surface-3) 92%, var(--color-accent));
           box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28)"
    onclick={() => (open = true)}
    aria-label="Ask the assistant"
  >
    ✦
  </button>
{/if}

{#if open}
  <Assistant onDone={() => (open = false)} />
{/if}
