<script lang="ts">
  import PhotoViewer from './PhotoViewer.svelte';

  /**
   * The little square on a row, and the full-size view behind it.
   *
   * It owns its own viewer rather than reporting a tap upwards, because every
   * list that shows one wants exactly the same thing to happen — and a list
   * that had to carry a `viewing` variable of its own is a list that can forget
   * to render the overlay.
   *
   * It must be a SIBLING of the row's own button, never inside it: a button
   * within a button is invalid and the inner one stops being tappable.
   */
  let { image, label = '' }: { image: string; label?: string } = $props();

  let open = $state(false);
</script>

<button
  class="press h-10 w-10 shrink-0 overflow-hidden rounded-lg"
  onclick={() => (open = true)}
  aria-label={label ? `View photo of ${label}` : 'View photo'}
>
  <img src={image} alt="" class="h-full w-full object-cover" />
</button>

{#if open}
  <PhotoViewer {image} title={label} onclose={() => (open = false)} />
{/if}
