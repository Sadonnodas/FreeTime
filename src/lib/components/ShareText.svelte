<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A piece of text on its way out of the app: shown exactly, then copied or
   * shared.
   *
   * One component for the project export and for Brain's list export, so the
   * two cannot drift into copying differently or failing differently.
   *
   * The preview IS the text, byte for byte — what you see is what lands in
   * Claude Code — and it doubles as the fallback: where the clipboard is
   * refused, the text is already on screen and gets selected for you.
   */
  let {
    text,
    title,
    ready = true,
    extra
  }: {
    text: string;
    /** Offered to the share sheet, which uses it as a subject line. */
    title: string;
    ready?: boolean;
    /** More buttons on the same row — Print, for a project. */
    extra?: Snippet;
  } = $props();

  let note = $state('');
  let preview = $state<HTMLTextAreaElement | null>(null);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  function flash(message: string) {
    note = message;
    setTimeout(() => (note = ''), 3000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      flash('Copied. Paste it wherever it is going.');
    } catch {
      // Refused (an older browser, or no user gesture it recognises). The text
      // is already in the box: select it so a long-press copies it.
      preview?.focus();
      preview?.select();
      flash('This browser would not copy it. It is selected — copy it from the box.');
    }
  }

  async function share() {
    try {
      await navigator.share({ title, text });
    } catch {
      /* cancelled, which says itself */
    }
  }
</script>

<textarea
  bind:this={preview}
  readonly
  value={ready ? text : 'Gathering…'}
  class="field h-[38dvh] min-h-[9rem] resize-none py-2 font-mono text-[13px] leading-snug"
  aria-label="What will be exported"
></textarea>

{#if note}
  <p class="footnote text-good">{note}</p>
{/if}

<div class="flex flex-wrap gap-2">
  <button class="btn btn-primary press flex-1" disabled={!ready} onclick={copy}>Copy</button>
  {#if canShare}
    <button class="btn press flex-1 bg-surface-2" disabled={!ready} onclick={share}>Share</button>
  {/if}
  {@render extra?.()}
</div>
