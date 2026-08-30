<script lang="ts">
  import { onMount } from 'svelte';
  import { capture } from '$lib/store';
  import { hasApiKey } from '$lib/gemini/client';
  import { canRecord } from '$lib/audio';
  import Assistant from './Assistant.svelte';
  import QuickIdea from './QuickIdea.svelte';
  import MemoRecorder from './MemoRecorder.svelte';

  /**
   * Capture must be under 5 seconds, with no required fields, ever (spec
   * principle 1). So: one input, Enter to save, no project picker, no date, no
   * confirmation dialog. It lands unfiled in Ideas and can stay there forever —
   * undecided is a valid resting state, not a failure.
   *
   * THERE IS ONE RECORD BUTTON, not two. The waveform keeps the audio; the
   * brain-dump that fed it to Gemini and threw the recording away has moved
   * into the assistant, where it belongs — it was always a Gemini interaction
   * wearing a capture button's clothes, and two record buttons side by side
   * only ever raised the question of which was which.
   */
  let text = $state('');
  let flash = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  // The mic is hidden rather than disabled without a key: an AI feature that
  // is visible but dead is worse than one that was never offered (spec 7.4).
  let hasKey = $state(false);
  let assistantOpen = $state(false);

  // Unlike the mic and the assistant, these two need no key and are never
  // hidden — they write straight to the store.
  let ideaOpen = $state(false);
  let memoOpen = $state(false);
  let canRecordAudio = $state(false);
  onMount(async () => {
    hasKey = await hasApiKey();
    // A kept recording involves no model at all, so it only needs a browser
    // that can record.
    canRecordAudio = canRecord();
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
      placeholder={hasKey ? 'Anything…' : 'Anything at all…'}
      enterkeyhint="done"
      autocomplete="off"
      class="field min-w-0 flex-1 {flash ? 'border-good/60' : ''}"
    />
    <!-- The extra buttons appear only while the box is empty, so the moment
         you start typing the row is just the field and Add. -->
    {#if !text.trim()}
      <button
        type="button"
        class="press tap-h w-11 shrink-0 rounded-xl bg-surface-2 text-ink-200"
        onclick={() => (ideaOpen = true)}
        aria-label="New idea"
      >
        <!-- Inline SVG, not an emoji: emoji render differently on every
             platform and cannot take the accent colour. -->
        <svg viewBox="0 0 24 24" class="h-[19px] w-[19px]" aria-hidden="true">
          <path
            d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .9 1.6l.1.6h5.2l.1-.6c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3"
            fill="currentColor"
          />
          <path d="M9.6 18.4h4.8M10.3 20.8h3.4" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" fill="none" />
        </svg>
      </button>
    {/if}
    {#if canRecordAudio && !text.trim()}
      <!-- A waveform, not a dot: this one KEEPS the audio. The dot beside it
           sends a brain-dump to the model and throws the recording away, and
           two identical-looking record buttons would be a trap. -->
      <button
        type="button"
        class="press tap-h w-11 shrink-0 rounded-xl bg-surface-2 text-ink-200"
        onclick={() => (memoOpen = true)}
        aria-label="Record a voice memo"
      >
        <svg viewBox="0 0 24 24" class="h-[19px] w-[19px]" aria-hidden="true">
          <g stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
            <path d="M3 12v0M7 8.5v7M11 5v14M15 8.5v7M19 11v2" />
          </g>
        </svg>
      </button>
    {/if}
    {#if hasKey && !text.trim()}
      <button
        type="button"
        class="press tap-h w-11 shrink-0 rounded-xl bg-surface-2 text-lg text-ink-200"
        onclick={() => (assistantOpen = true)}
        aria-label="Ask the assistant"
      >
        ✦
      </button>
    {/if}
    <button type="submit" disabled={!text.trim()} class="btn btn-primary press">Add</button>
  </div>
  {#if flash}
    <p class="mt-2 text-[12px] text-good">Saved to Brain.</p>
  {/if}
</form>

{#if assistantOpen}
  <Assistant onDone={() => (assistantOpen = false)} />
{/if}

{#if ideaOpen}
  <QuickIdea onDone={() => (ideaOpen = false)} />
{/if}

{#if memoOpen}
  <MemoRecorder onDone={() => (memoOpen = false)} />
{/if}
