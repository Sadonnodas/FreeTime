<script lang="ts">
  import { renderMarkdown } from '$lib/markdown';
  import RichNote from './RichNote.svelte';

  /**
   * A note: stored as Markdown, read as formatted text, and now WRITTEN as
   * formatted text too.
   *
   * THE OLD NOTE HERE SAID "two modes rather than one rich editor", and half
   * of that reasoning still stands while the other half has been overtaken.
   * What is STORED still has to be plain Markdown — it syncs as JSON, the
   * importer and the assistant both write it, and it has to survive a merge —
   * and it still is: the editor renders that Markdown on the way in and
   * writes it back on the way out, and the HTML never reaches the database.
   * What was wrong was the conclusion that the BOX had to show the syntax.
   * It did not, and the proof is that quick notes do not.
   *
   * READ IS STILL THE DEFAULT, and Edit is still a toggle, which now matters
   * for a subtler reason than it used to: reading follows a link, linkifies a
   * bare URL and renders a code span, and none of those may happen to text
   * somebody is in the middle of writing.
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
  let box = $state<ReturnType<typeof RichNote> | null>(null);
  /** The URL being typed, while the link row is open. */
  let linking = $state<string | null>(null);

  const html = $derived(renderMarkdown(value));

  /**
   * THE SAME EDITOR QUICK NOTES USE, for the same reason they got it: the
   * toolbar made `**bold**` and you read asterisks until you pressed Done.
   * Asked for straight after that one landed — *"WYSIWYG"* being the word for
   * a box whose text already looks like the finished thing.
   *
   * **Read is still the default and Edit is still a toggle.** Editing in place
   * now looks much like reading, and the two are not the same: the read view
   * follows a link, linkifies a bare URL and renders a code span, none of
   * which an editor may do to text somebody is in the middle of writing.
   *
   * What the editor cannot write back it leaves exactly as it found it (see
   * richText.ts), which is what makes it safe to point at notes that hold
   * lyrics.
   */
  const TOOLS: { label: string; title: string; run: () => void }[] = [
    { label: 'H', title: 'Heading', run: () => box?.block('h3') },
    { label: 'B', title: 'Bold', run: () => box?.command('bold') },
    { label: 'I', title: 'Italic', run: () => box?.command('italic') },
    // Underline is this app's own `__text__` — markdown has none; markdown.ts.
    { label: 'U', title: 'Underline', run: () => box?.command('underline') },
    { label: '•', title: 'Bullet', run: () => box?.command('insertUnorderedList') },
    { label: '1.', title: 'Numbered', run: () => box?.command('insertOrderedList') },
    { label: '☐', title: 'Checklist', run: () => box?.checkList() },
    { label: '❝', title: 'Quote', run: () => box?.block('blockquote') },
    { label: '🔗', title: 'Link', run: () => (linking = 'https://') },
    { label: '—', title: 'Divider', run: () => box?.divider() }
  ];

  function addLink() {
    const url = (linking ?? '').trim();
    linking = null;
    if (url && url !== 'https://') box?.link(url);
  }
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
  {#if linking !== null}
    <!-- A link needs somewhere to point, and a WYSIWYG box has nowhere to
         type that. One row, only while it is being asked for. -->
    <div class="mb-2 flex gap-2">
      <input
        type="text"
        bind:value={linking}
        placeholder="https://…"
        aria-label="Link address"
        class="field min-w-0 flex-1"
        onkeydown={(e) => {
          if (e.key === 'Enter') addLink();
          if (e.key === 'Escape') linking = null;
        }}
      />
      <button type="button" class="btn btn-secondary press" onclick={addLink}>Link</button>
    </div>
  {/if}
  <RichNote
    bind:this={box}
    {value}
    oninput={onchange}
    {placeholder}
    class="note-body min-h-[40vh] w-full rounded-xl bg-surface-1 px-4 py-4"
  />
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
