<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import {
    collectProject, toMarkdown, EXPORT_SECTIONS, EVERYTHING, JUST_TODOS,
    type ExportSection, type ProjectExport
  } from '$lib/export';

  /**
   * Choosing what to take out of a project, and where it goes.
   *
   * Three ways out, because the two uses asked for arrive at different places:
   * COPY is the Claude Code case — paste straight into a prompt on the same
   * device; SHARE is the same text from a phone, handed to AirDrop, Notes or
   * mail on its way to the laptop; PRINT is the "one day I want to really work
   * on it" case, on paper or saved as a PDF.
   *
   * The preview is the text itself, not a picture of it. What you see is
   * byte-for-byte what gets copied, and it doubles as the fallback: where the
   * clipboard is refused, the text is already on screen to select by hand.
   *
   * The choice of sections is remembered per device, because someone who
   * exports "just the to-dos" for Claude Code is going to do it again tomorrow.
   */
  let { eraId, tag, onclose }: { eraId: string; tag: string; onclose: () => void } = $props();

  const KEY = 'freetime.export.sections';

  let data = $state<ProjectExport | null>(null);
  let chosen = $state<ExportSection[]>(loadChoice());
  let note = $state('');
  let preview = $state<HTMLTextAreaElement | null>(null);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  function loadChoice(): ExportSection[] {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (Array.isArray(saved) && saved.length) {
        const valid = saved.filter((s) => EXPORT_SECTIONS.some((x) => x.key === s));
        if (valid.length) return valid;
      }
    } catch {
      /* private window — start from everything */
    }
    return [...EVERYTHING];
  }

  function choose(next: ExportSection[]) {
    chosen = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* not remembering is fine */
    }
  }

  const toggle = (key: ExportSection) =>
    choose(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key]);

  const sameAs = (preset: ExportSection[]) =>
    preset.length === chosen.length && preset.every((k) => chosen.includes(k));

  onMount(async () => {
    data = await collectProject(eraId, tag);
  });

  const text = $derived(data ? toMarkdown(data, chosen) : '');

  /** How many rows each section would carry, so an empty one says so on its chip. */
  const counts = $derived.by<Record<ExportSection, number>>(() => ({
    todos: data?.open.length ?? 0,
    done: data?.done.length ?? 0,
    ideas: data?.ideas.length ?? 0,
    buy: data?.buy.length ?? 0,
    notes: data?.note ? 1 : 0,
    blocks: data?.blocks.length ?? 0,
    recordings: data?.recordings.length ?? 0
  }));

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
      await navigator.share({ title: tag, text });
    } catch {
      /* cancelled, which says itself */
    }
  }

  function print() {
    const sections = chosen.join(',');
    onclose();
    void goto(`${base}/projects/${eraId}/${encodeURIComponent(tag)}/print?s=${sections}`);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="glass-strong rise fixed inset-0 z-50 flex flex-col justify-end p-4 pb-safe" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="card mx-auto flex max-h-full w-full max-w-[560px] flex-col gap-3 p-4"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex items-center justify-between">
      <p class="text-[17px] font-semibold">Export {tag}</p>
      <button class="press tap-h px-2 text-[22px] leading-none text-ink-400" onclick={onclose} aria-label="Close">×</button>
    </div>

    <!-- The two cases that were actually asked for, one tap each. -->
    <div class="flex gap-2">
      <button class="chip press {sameAs(EVERYTHING) ? 'chip-on' : ''}" onclick={() => choose([...EVERYTHING])}>
        Everything
      </button>
      <button class="chip press {sameAs(JUST_TODOS) ? 'chip-on' : ''}" onclick={() => choose([...JUST_TODOS])}>
        Just the to-dos
      </button>
    </div>

    <div class="flex flex-wrap gap-2">
      {#each EXPORT_SECTIONS as s (s.key)}
        <button
          class="chip press {chosen.includes(s.key) ? 'chip-on' : ''} {counts[s.key] ? '' : 'opacity-50'}"
          onclick={() => toggle(s.key)}
          aria-pressed={chosen.includes(s.key)}
        >
          {s.label}{#if counts[s.key]}&nbsp;<span class="tabular-nums opacity-70">{counts[s.key]}</span>{/if}
        </button>
      {/each}
    </div>

    <textarea
      bind:this={preview}
      readonly
      value={data ? text : 'Gathering…'}
      class="field h-[38dvh] min-h-[9rem] resize-none font-mono text-[13px] leading-snug"
      aria-label="What will be exported"
    ></textarea>

    {#if note}
      <p class="footnote text-good">{note}</p>
    {/if}

    <div class="flex flex-wrap gap-2">
      <button class="btn btn-primary press flex-1" disabled={!data} onclick={copy}>Copy</button>
      {#if canShare}
        <button class="btn press flex-1 bg-surface-2" disabled={!data} onclick={share}>Share</button>
      {/if}
      <button class="btn press flex-1 bg-surface-2" disabled={!data} onclick={print}>Print or PDF</button>
    </div>
  </div>
</div>
