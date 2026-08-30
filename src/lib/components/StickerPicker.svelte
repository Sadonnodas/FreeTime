<script lang="ts">
  import { STICKERS, stickerUrl, stickerRef, stickerFrom } from '$lib/stickers';

  /**
   * Pick a dinosaur for a project.
   *
   * Fifty-five is a lot to scroll, so there is a search box — but it filters on
   * what the dinosaur is DOING ("guitar", "coffee", "reading"), not on species,
   * because nobody looking for a cover for Music is thinking "parasaurolophus".
   *
   * No categories. A tabbed picker would be a small taxonomy to maintain and
   * argue with, and the whole set fits in a few flicks anyway.
   */
  let {
    current,
    onpick,
    onclose
  }: {
    current?: string;
    onpick: (image: string) => void;
    onclose: () => void;
  } = $props();

  let query = $state('');

  const shown = $derived(
    query.trim()
      ? STICKERS.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()))
      : STICKERS
  );

  const chosen = $derived(stickerFrom(current)?.id);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="glass-strong rise fixed inset-0 z-50 flex flex-col" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="flex min-h-0 flex-1 flex-col" onclick={(e) => e.stopPropagation()}>
    <div class="flex items-center justify-between gap-3 px-4 pt-safe">
      <h2 class="title-2 py-3">Pick a dinosaur</h2>
      <button class="press tap-h px-2 text-[22px] leading-none text-ink-400" onclick={onclose}>
        ×
      </button>
    </div>

    <div class="px-4 pb-3">
      <input bind:value={query} placeholder="Doing what?" class="field w-full" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-safe">
      {#if shown.length === 0}
        <p class="footnote py-8 text-center">No dinosaur does that. Yet.</p>
      {:else}
        <div class="grid grid-cols-3 gap-3 pb-6 sm:grid-cols-4">
          {#each shown as s (s.id)}
            <button
              class="press overflow-hidden rounded-2xl border-2 transition-colors
                     {chosen === s.id ? 'border-accent' : 'border-transparent'}"
              onclick={() => onpick(stickerRef(s.id))}
            >
              <!-- The same coloured ground the cover uses, so what you tap is
                   what you get rather than a white tile that turns out lilac. -->
              <span
                class="flex aspect-square items-center justify-center p-2"
                style="background: var(--color-surface-2)"
              >
                <img
                  src={stickerUrl(s)}
                  alt={s.label}
                  loading="lazy"
                  class="h-full w-full object-contain"
                />
              </span>
              <span class="footnote block truncate px-1 py-1 text-center">{s.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
