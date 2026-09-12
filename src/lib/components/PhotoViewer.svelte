<script lang="ts">
  /**
   * A photo at full size, over everything.
   *
   * `object-contain`, never cover: these are screenshots and schematics as
   * often as they are pictures, and cropping one removes the part being looked
   * at. Tapping anywhere closes, because after a glance at a photo the only
   * thing anyone wants is to be back where they were.
   */
  let {
    image,
    title = '',
    onclose
  }: { image: string; title?: string; onclose: () => void } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="glass-strong rise fixed inset-0 z-50 flex flex-col" onclick={onclose}>
  <div class="flex items-center justify-between gap-3 px-4 pt-safe">
    <p class="section-label truncate py-3">{title}</p>
    <button
      class="press tap-h px-2 text-[22px] leading-none text-ink-400"
      onclick={onclose}
      aria-label="Close">×</button
    >
  </div>
  <div class="flex min-h-0 flex-1 items-center justify-center p-3 pb-safe">
    <img src={image} alt={title} class="max-h-full max-w-full object-contain" />
  </div>
</div>
