<script lang="ts">
  import { resizeImage, THUMB_EDGE } from '$lib/images';

  /**
   * Attaching a photo to a row, from inside the editor that row already opens.
   *
   * Capped at THUMB_EDGE like a shopping photo: this is "the screenshot of the
   * error" or "that shelf in the shop", a reminder of which thing you meant
   * rather than something to print. The cap is what keeps it affordable —
   * these ride inside their table's JSON on every sync, so a phone photo left
   * at full size would make one to-do heavier than the entire rest of the
   * database.
   *
   * A failure says so. `resizeImage` throws on a browser with no canvas and on
   * a file that is not really an image, and a silent no-op there looks exactly
   * like a tap that did not register.
   */
  let {
    image,
    onpick,
    onremove
  }: {
    image?: string;
    onpick: (dataUrl: string) => void;
    onremove: () => void;
  } = $props();

  let error = $state('');

  async function choose(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    error = '';
    try {
      onpick(await resizeImage(file, THUMB_EDGE));
    } catch (err) {
      error = (err as Error).message;
    }
    // Lets the same file be picked twice running, which otherwise fires no
    // change event and looks like the app ignored the tap.
    input.value = '';
  }
</script>

<div class="flex items-center gap-2">
  <label class="press tap flex flex-1 items-center justify-center rounded-xl bg-surface-2 text-sm">
    <input type="file" accept="image/*" class="hidden" onchange={choose} />
    <span class="text-accent">{image ? 'Change photo' : 'Add a photo'}</span>
  </label>
  {#if image}
    <button
      type="button"
      class="press tap-h rounded-lg px-3 text-sm text-ink-400"
      onclick={onremove}
    >
      Remove photo
    </button>
  {/if}
</div>
{#if error}
  <p class="footnote text-accent-2">{error}</p>
{/if}
