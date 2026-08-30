<script lang="ts">
  import type { Snippet } from 'svelte';
  import Dino from './Dino.svelte';

  /**
   * The explanation, delivered by the dinosaur.
   *
   * The first version put the text under an uppercase, letter-spaced
   * `section-label` heading — the same treatment used for the tiny grey labels
   * elsewhere — which at paragraph scale reads as shouting. Explanations are the
   * one place in this app that should sound like a person talking, so it is a
   * speech bubble with the animal standing under it, and the heading is a
   * sentence rather than a label.
   *
   * Anchored to the bottom of the screen: the dinosaur is standing on the floor
   * talking upwards, and on a phone that is also where the thumb already is.
   */
  let { title, children }: { title: string; children: Snippet } = $props();

  let open = $state(false);
</script>

<button
  class="press ml-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full
         align-middle text-[11px] font-bold"
  style="background: var(--color-surface-2); color: var(--color-ink-400)"
  onclick={() => (open = true)}
  aria-label="About {title}"
>
  i
</button>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!--
    THE RESET IS THE FIX, not the typography below it.

    This button lives inside the section's <h2>, which carries .section-label —
    uppercase, letter-spaced, small and grey. All of that inherits straight into
    the sheet, so the explanation came out shouting in capitals no matter what
    classes were put on it. Reported as "the text is so aggressive", and it was.
  -->
  <div
    class="glass-strong rise fixed inset-0 z-50 flex flex-col justify-end p-4 pb-safe"
    style="text-transform: none; letter-spacing: normal; font-weight: 400;
           font-size: 1rem; color: var(--color-ink-50)"
    onclick={() => (open = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mx-auto w-full max-w-[520px]" onclick={(e) => e.stopPropagation()}>
      <div class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <h2 class="title-2">{title}</h2>
          <button
            class="press tap-h -mt-1 -mr-1 shrink-0 px-2 text-[22px] leading-none text-ink-400"
            onclick={() => (open = false)}
            aria-label="Close">×</button
          >
        </div>
        <div class="body mt-2 space-y-3 text-ink-200">
          {@render children()}
        </div>
      </div>

      <!-- The bubble's tail, sitting above the dinosaur's head. -->
      <div class="ml-10 flex">
        <div
          class="h-5 w-5 -translate-y-[11px] rotate-45 rounded-br-[3px]"
          style="background: var(--color-surface-1);
                 border-right: 1px solid var(--color-line-1);
                 border-bottom: 1px solid var(--color-line-1)"
        ></div>
      </div>

      <div class="-mt-2 ml-3">
        <Dino size={64} title="" />
      </div>
    </div>
  </div>
{/if}
