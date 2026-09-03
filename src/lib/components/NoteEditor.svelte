<script lang="ts">
  import { renderMarkdown } from '$lib/markdown';

  /**
   * A note, written as Markdown and read as formatted text.
   *
   * TWO MODES RATHER THAN ONE RICH EDITOR. A contenteditable box that formats
   * as you type is the obvious thing to reach for and the wrong one here: what
   * is stored has to stay plain text, because it syncs as JSON, is written by
   * the importer and the assistant, and has to survive being merged. Markdown
   * keeps the file honest and the toolbar hides the syntax from anyone who does
   * not want to learn it.
   *
   * READ IS THE DEFAULT, which is the whole reason this exists: a pasted link
   * was not clickable, so following it meant selecting and copying it out.
   */
  let {
    value,
    placeholder = 'Notes. Autosaves.',
    onchange
  }: {
    value: string;
    placeholder?: string;
    onchange: (markdown: string) => void;
  } = $props();

  let editing = $state(false);
  let box = $state<HTMLTextAreaElement | null>(null);

  const html = $derived(renderMarkdown(value));

  /**
   * Wrap or prefix the selection.
   *
   * `prefix` alone marks whole lines (a bullet, a heading, an indent); with
   * `suffix` it wraps the selection (bold, a link). Either way the cursor is
   * put back where a person would expect to carry on typing, because a
   * formatting button that loses your place is worse than typing the asterisks.
   */
  function apply(prefix: string, suffix = '', lineWise = false) {
    const el = box;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);

    if (lineWise) {
      const from = before.lastIndexOf('\n') + 1;
      const head = value.slice(0, from);
      const body = value.slice(from, end) || '';
      const marked = body
        .split('\n')
        .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line))
        .join('\n');
      onchange(head + marked + after);
      queueMicrotask(() => el.focus());
      return;
    }

    onchange(before + prefix + selected + suffix + after);
    queueMicrotask(() => {
      el.focus();
      const caret = start + prefix.length + selected.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const TOOLS: { label: string; title: string; run: () => void }[] = [
    { label: 'H', title: 'Heading', run: () => apply('## ', '', true) },
    { label: 'B', title: 'Bold', run: () => apply('**', '**') },
    { label: 'I', title: 'Italic', run: () => apply('*', '*') },
    { label: '•', title: 'Bullet', run: () => apply('- ', '', true) },
    { label: '1.', title: 'Numbered', run: () => apply('1. ', '', true) },
    { label: '→', title: 'Indent', run: () => apply('  ', '', true) },
    { label: '🔗', title: 'Link', run: () => apply('[', '](https://)') },
    { label: '—', title: 'Divider', run: () => apply('\n---\n') }
  ];
</script>

<div class="mb-2 flex items-center gap-1">
  <button
    type="button"
    class="press tap-h rounded-lg px-3 text-sm {editing ? 'text-ink-400' : 'text-accent'}"
    onclick={() => (editing = !editing)}
  >
    {editing ? 'Done' : 'Edit'}
  </button>

  {#if editing}
    <!-- The syntax, as buttons, so nobody has to know it is Markdown. -->
    <div class="no-bar -mr-1 flex flex-1 gap-1 overflow-x-auto">
      {#each TOOLS as t (t.label)}
        <button
          type="button"
          class="press tap-h w-9 shrink-0 rounded-lg bg-surface-2 text-sm"
          onclick={t.run}
          title={t.title}
          aria-label={t.title}
        >
          {t.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if editing}
  <textarea
    bind:this={box}
    {value}
    oninput={(e) => onchange(e.currentTarget.value)}
    {placeholder}
    class="field min-h-[40vh] w-full py-4 font-mono leading-relaxed"
  ></textarea>
{:else if value.trim()}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <div class="note-body">{@html html}</div>
{:else}
  <button
    type="button"
    class="press tap w-full rounded-xl border border-dashed border-line-2 text-sm text-ink-400"
    onclick={() => (editing = true)}
  >
    {placeholder}
  </button>
{/if}
