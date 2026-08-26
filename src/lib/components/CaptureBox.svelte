<script lang="ts">
  import { onMount } from 'svelte';
  import { capture } from '$lib/store';
  import { hasApiKey } from '$lib/gemini/client';
  import { canRecord } from '$lib/audio';
  import VoiceCapture from './VoiceCapture.svelte';
  import Assistant from './Assistant.svelte';

  /**
   * Capture must be under 5 seconds, with no required fields, ever (spec
   * principle 1). So: one input, Enter to save, no project picker, no date, no
   * confirmation dialog. It lands in the Brain inbox and can stay there
   * forever — unsorted is a valid resting state, not a failure.
   */
  let text = $state('');
  let flash = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  // The mic is hidden rather than disabled without a key: an AI feature that
  // is visible but dead is worse than one that was never offered (spec 7.4).
  let hasKey = $state(false);
  let voiceAvailable = $state(false);
  let voiceOpen = $state(false);
  let assistantOpen = $state(false);
  onMount(async () => {
    hasKey = await hasApiKey();
    // Recording needs both a key and a browser that can do it; the assistant
    // only needs the key. Hidden entirely otherwise (spec 7.4).
    voiceAvailable = canRecord() && hasKey;
  });

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

<form onsubmit={submit} class="glass hairline-t p-3">
  <div class="flex gap-2">
    <input
      bind:this={input}
      bind:value={text}
      type="text"
      placeholder="Anything at all…"
      enterkeyhint="done"
      autocomplete="off"
      class="field min-w-0 flex-1 {flash ? 'border-good/60' : ''}"
    />
    {#if hasKey && !text.trim()}
      <button
        type="button"
        class="press tap rounded-xl bg-white/8 px-4 text-lg text-ink-200"
        onclick={() => (assistantOpen = true)}
        aria-label="Ask the assistant"
      >
        ✦
      </button>
    {/if}
    {#if voiceAvailable && !text.trim()}
      <button
        type="button"
        class="press tap rounded-xl bg-white/8 px-4 text-lg text-accent"
        onclick={() => (voiceOpen = true)}
        aria-label="Record a brain-dump"
      >
        ●
      </button>
    {:else}
      <button
        type="submit"
        disabled={!text.trim()}
        class="btn btn-primary press"
      >
        Add
      </button>
    {/if}
  </div>
  {#if flash}
    <p class="mt-2 text-[12px] text-good">Saved to Brain.</p>
  {/if}
</form>

{#if voiceOpen}
  <VoiceCapture onDone={() => (voiceOpen = false)} />
{/if}

{#if assistantOpen}
  <Assistant onDone={() => (assistantOpen = false)} />
{/if}
