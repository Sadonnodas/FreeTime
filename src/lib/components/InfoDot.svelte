<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A small "i" beside a heading that opens the explanation.
   *
   * Settings had grown into paragraphs — what the Google warning means, why the
   * Gemini key is safe here, what to restrict it to. All of it is worth saying
   * once and none of it is worth reading again, so it moves behind a tap. The
   * screen becomes a list of controls, which is what a settings screen is.
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
  <div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
    <div class="flex items-center justify-between px-4 pt-safe">
      <span class="section-label py-3">{title}</span>
      <button
        class="press tap px-2 text-[22px] leading-none text-ink-400"
        onclick={() => (open = false)}
        aria-label="Close">×</button
      >
    </div>
    <div class="flex-1 overflow-y-auto px-5">
      <div class="body space-y-3 pb-8 text-ink-200">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
