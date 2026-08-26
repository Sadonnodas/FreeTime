<script lang="ts">
  import { capture } from '$lib/store';

  /**
   * Capture must be under 5 seconds, with no required fields, ever (spec
   * principle 1). So: one input, Enter to save, no project picker, no date, no
   * confirmation dialog. It lands in the Brain inbox and can stay there
   * forever — unsorted is a valid resting state, not a failure.
   */
  let text = $state('');
  let flash = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    // Clear first so the box is instantly ready for the next thought. The write
    // is local-only and effectively instant, so there is nothing to wait for.
    text = '';
    await capture(value);
    flash = true;
    setTimeout(() => (flash = false), 600);
    input?.focus();
  }
</script>

<form onsubmit={submit} class="border-t border-ink-800 bg-ink-900 p-3">
  <div class="flex gap-2">
    <input
      bind:this={input}
      bind:value={text}
      type="text"
      placeholder="Anything at all…"
      enterkeyhint="done"
      autocomplete="off"
      class="tap flex-1 rounded-xl border px-4 text-base text-ink-50 outline-none
             placeholder:text-ink-400 transition-colors
             {flash ? 'border-good bg-ink-800' : 'border-ink-700 bg-ink-800 focus:border-accent'}"
    />
    <button
      type="submit"
      disabled={!text.trim()}
      class="tap rounded-xl bg-accent px-5 font-medium text-ink-950 disabled:opacity-30"
    >
      Add
    </button>
  </div>
  {#if flash}
    <p class="mt-2 text-xs text-good">Saved to Brain.</p>
  {/if}
</form>
