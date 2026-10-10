<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import {
    createQuickNote, updateQuickNote, setQuickNoteTitle, setQuickNotePinned, softDelete,
    quickNoteToProjectNote,
    quickNoteToProject
  } from '$lib/store';
  import { activeProjects } from '$lib/queries';
  import type { Project, QuickNote } from '$lib/types';
  import { portal } from '$lib/portal';
  import RemoveButton from './RemoveButton.svelte';
  import ProjectSelect from './ProjectSelect.svelte';
  import { totalOf, formatNumber } from '$lib/calc';
  import { stripMarker } from '$lib/textLists';
  import { type Mark } from '$lib/textMarks';
  import { renderMarks } from '$lib/markdown';
  import RichNote from './RichNote.svelte';
  import ShareText from './ShareText.svelte';

  /**
   * Quick notes — the phone's Notes app, inside this one.
   *
   * *"If I have to write down something super quickly, like I just took a
   * measurement and I just need to remember the numbers."* So the screen opens
   * on a box to write in, with the notes already written underneath: writing
   * is the first thing, finding is the second. Nothing to choose, nothing to
   * file, no Save — a note exists from its first letter and every keystroke is
   * kept, because the moment this is for is one where you have a tape measure
   * in the other hand.
   *
   * A note left empty is removed on the way out, so opening this and closing it
   * again leaves nothing behind.
   */
  let { onclose }: { onclose: () => void } = $props();

  const notesQ = liveQuery(async () =>
    (await db.quickNotes.toArray())
      .filter((n) => !n.deletedAt)
      // Pinned first, then most recently touched. Within the pinned ones the
      // same rule applies, so a pin changes where a note sits and never how
      // its neighbours are ordered.
      .sort(
        (a, b) =>
          (a.pinnedAt ? 0 : 1) - (b.pinnedAt ? 0 : 1) || b.updatedAt.localeCompare(a.updatedAt)
      )
  );
  const notes = $derived(($notesQ as QuickNote[] | undefined) ?? []);

  // --- writing: the box at the top, or an older note opened full screen
  let editingId = $state<string | null>(null);
  let draft = $state('');
  /**
   * The note's own name, in its own field — *"not like on the notes app where
   * the first thing you type is kind of like a title. I want a separate
   * field."* The first line of a quick note is usually the measurement, so
   * promoting it would name the note wrongly AND quietly give the first thing
   * you type a second meaning.
   *
   * Optional, and never in the way: a note still exists from its first letter
   * whether that letter lands here or in the box below, and an untitled note
   * is listed by its first line exactly as every note was before this.
   */
  let draftTitle = $state('');
  /** The note the top box is writing into, once it has a first letter. */
  let composingId = $state<string | null>(null);
  let pending: Promise<string> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function write(text: string, id: string | null): Promise<string> {
    if (id) {
      await updateQuickNote(id, text);
      return id;
    }
    // Created exactly once, even if the second letter arrives before the
    // first write has finished.
    pending ??= createQuickNote(text, draftTitle);
    return pending;
  }

  /** The row being written into, made now if the first letter has just
   *  arrived — in either field. */
  async function ensureNote(): Promise<string> {
    if (composingId) return composingId;
    pending ??= createQuickNote(draft, draftTitle);
    const id = await pending;
    composingId = id;
    pending = null;
    return id;
  }

  let titleTimer: ReturnType<typeof setTimeout> | undefined;
  function onComposeTitle(title: string) {
    draftTitle = title;
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      void ensureNote().then((id) => setQuickNoteTitle(id, draftTitle));
    }, 300);
  }

  function onCompose(text: string) {
    draft = text;
    clearTimeout(timer);
    if (!composingId && !pending) {
      void write(text, null).then((id) => {
        composingId = id;
        pending = null;
        if (draft !== text) void updateQuickNote(id, draft);
      });
      return;
    }
    timer = setTimeout(() => {
      if (composingId) void updateQuickNote(composingId, draft);
    }, 300);
  }

  /** Put the top box down and start fresh; the note stays in the list. */
  async function finishCompose() {
    clearTimeout(timer);
    clearTimeout(titleTimer);
    const id = composingId ?? (pending ? await pending : null);
    if (id) {
      // Empty now means both fields: a note called something, with nothing in
      // it yet, is a note somebody started on purpose.
      if (draft.trim() || draftTitle.trim()) {
        await updateQuickNote(id, draft);
        await setQuickNoteTitle(id, draftTitle);
      } else await softDelete('quickNotes', id);
    }
    composingId = null;
    pending = null;
    draft = '';
    draftTitle = '';
  }

  const editing = $derived(notes.find((n) => n.id === editingId));
  let editText = $state('');
  let editTitle = $state('');
  let editTimer: ReturnType<typeof setTimeout> | undefined;
  let editTitleTimer: ReturnType<typeof setTimeout> | undefined;

  function open(n: QuickNote) {
    moving = null;
    sharing = false;
    showTotal = false;
    editText = n.text;
    editTitle = n.title ?? '';
    editingId = n.id;
  }

  function onEditTitle(title: string) {
    editTitle = title;
    clearTimeout(editTitleTimer);
    const id = editingId;
    editTitleTimer = setTimeout(() => id && void setQuickNoteTitle(id, title), 300);
  }
  function onEdit(text: string) {
    editText = text;
    clearTimeout(editTimer);
    const id = editingId;
    editTimer = setTimeout(() => id && void updateQuickNote(id, text), 300);
  }
  async function back() {
    clearTimeout(editTimer);
    clearTimeout(editTitleTimer);
    const id = editingId;
    editingId = null;
    if (!id) return;
    if (editText.trim() || editTitle.trim()) {
      await updateQuickNote(id, editText);
      await setQuickNoteTitle(id, editTitle);
    } else await softDelete('quickNotes', id);
  }

  /**
   * A note on its way to somebody else — the measurements, the name, the
   * number you were asked for. The one thing a quick note could not do was
   * leave the app, which is strange for the screen that holds exactly the
   * sort of thing you get asked to send on.
   *
   * It leaves as MARKDOWN, title first, which is what every other export here
   * does: `**Hall**` reads as asterisks in a message and as bold in anything
   * that understands notes, and one convention beats a second one that only
   * this screen uses. The preview shows precisely what lands.
   */
  let sharing = $state(false);
  const shareText = $derived(
    [editTitle.trim(), editText.trim()].filter(Boolean).join('\n\n')
  );

  // --- moving on: into a project's notes, or into a project of its own
  const erasQ = liveQuery(() => activeProjects());
  const eras = $derived(($erasQ as Project[] | undefined) ?? []);
  let moving = $state<'notes' | 'project' | null>(null);
  let toEra = $state('');
  let toTag = $state('');
  let newName = $state('');
  let refusal = $state('');
  /** What just happened, said once on the list. */
  let flash = $state('');
  const toEraTags = $derived(eras.find((e) => e.id === toEra)?.tags ?? []);
  $effect(() => {
    if (!toEraTags.includes(toTag)) toTag = '';
  });

  function startMoving(kind: 'notes' | 'project') {
    moving = kind;
    refusal = '';
    toEra ||= eras[0]?.id ?? '';
    if (kind === 'project') {
      // Its name if it has one — that is what the note is called, and it was
      // typed deliberately where a first line was not.
      const name = editTitle.trim() || (firstLine(editText) === 'Empty note' ? '' : firstLine(editText));
      newName = name;
    }
  }

  function say(text: string) {
    flash = text;
    setTimeout(() => {
      if (flash === text) flash = '';
    }, 4000);
  }

  async function moveOn() {
    const id = editingId;
    if (!id || !toEra) return;
    clearTimeout(editTimer);
    clearTimeout(editTitleTimer);
    await updateQuickNote(id, editText);
    await setQuickNoteTitle(id, editTitle);
    const eraName = eras.find((e) => e.id === toEra)?.name ?? '';
    if (moving === 'notes') {
      if (!(await quickNoteToProjectNote(id, toEra, toTag || undefined))) return;
      say(`Added to the notes of ${[eraName, toTag].filter(Boolean).join(' · ')}.`);
    } else {
      const result = await quickNoteToProject(id, toEra, newName);
      if (result === 'name-taken') {
        refusal = `${eraName} already has a project called “${newName.trim()}”.`;
        return;
      }
      if (result !== 'started') return;
      say(`${newName.trim()} is a new project in ${eraName}, with this note in it.`);
    }
    moving = null;
    editingId = null;
  }

  async function close() {
    if (editingId) await back();
    await finishCompose();
    onclose();
  }

  // --- sums

  let showTotal = $state(false);

  // --- list buttons
  let composeRich = $state<ReturnType<typeof RichNote> | null>(null);
  let editRich = $state<ReturnType<typeof RichNote> | null>(null);
  const editor = (which: 'compose' | 'edit') => (which === 'compose' ? composeRich : editRich);
  /** The browser's own list editing: it continues on Enter, ends the list on
   *  an empty item and nests on Tab, all of which textLists.ts had to do by
   *  hand while this was a textarea. */
  function listButton(kind: 'bullet' | 'number', which: 'compose' | 'edit') {
    editor(which)?.command(kind === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList');
  }

  /**
   * Bold, italic and underline — the same Markdown the project notes use, and
   * the same toggle the keyboard shortcut applies, so a button and Cmd+B
   * cannot come to mean different things. See textMarks.ts.
   */
  /** Cmd/Ctrl+B, I and U need no handler here: a contenteditable applies them
   *  itself and reports the change as an ordinary input. */
  function markButton(mark: Mark, which: 'compose' | 'edit') {
    editor(which)?.command(mark);
  }

  // --- selecting several, to delete them together
  let selecting = $state(false);
  let picked = $state<string[]>([]);
  function togglePick(id: string) {
    picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
  }
  function stopSelecting() {
    selecting = false;
    picked = [];
  }
  async function deletePicked() {
    const ids = picked;
    stopSelecting();
    for (const id of ids) await softDelete('quickNotes', id);
    say(`${ids.length} ${ids.length === 1 ? 'note' : 'notes'} deleted.`);
  }

  // --- the list
  let search = $state('');
  const shown = $derived(
    notes
      .filter((n) => n.id !== composingId)
      .filter((n) => {
        const q = search.trim().toLowerCase();
        return q ? `${n.title ?? ''}\n${n.text}`.toLowerCase().includes(q) : true;
      })
  );

  // Previews read without list markers: "Paint", then "Primer · Brushes".
  const lines = (t: string) => t.trim().split('\n').map((l) => stripMarker(l).trim()).filter(Boolean);
  const firstLine = (t: string) => lines(t)[0] || 'Empty note';
  const rest = (t: string) => lines(t).slice(1).join(' · ');
  /** A titled note leads with its name and keeps ALL of its text underneath;
   *  an untitled one is listed by its first line, as it always was. */
  const rowTitle = (n: QuickNote) => (n.title?.trim() ? n.title.trim() : firstLine(n.text));
  const rowRest = (n: QuickNote) =>
    n.title?.trim() ? lines(n.text).join(' · ') : rest(n.text);
  function when(iso: string): string {
    const d = new Date(iso);
    const same = d.toDateString() === new Date().toDateString();
    return same
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }


</script>

{#snippet listTools(which: 'compose' | 'edit')}
  <!-- pointerdown is cancelled so tapping these keeps the cursor (and the
       phone's keyboard) where it was. -->
  <div class="flex flex-wrap gap-1">
    <!-- The three marks, written as what they do. Cmd/Ctrl+B, I and U do the
         same thing for anyone who never looks at a toolbar — which was the
         actual report: *"pressing Command + B doesn't work either."* -->
    <button
      type="button"
      class="press tap-h rounded-lg px-2.5 text-sm font-bold text-ink-200"
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => markButton('bold', which)}
      title="Bold (⌘B)"
      aria-label="Bold">B</button
    >
    <button
      type="button"
      class="press tap-h rounded-lg px-2.5 text-sm text-ink-200 italic"
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => markButton('italic', which)}
      title="Italic (⌘I)"
      aria-label="Italic">I</button
    >
    <button
      type="button"
      class="press tap-h rounded-lg px-2.5 text-sm text-ink-200 underline"
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => markButton('underline', which)}
      title="Underline (⌘U)"
      aria-label="Underline">U</button
    >
    <button
      type="button"
      class="press tap-h rounded-lg px-2.5 text-sm text-ink-200"
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => listButton('bullet', which)}
      aria-label="Bulleted list">• List</button
    >
    <button
      type="button"
      class="press tap-h rounded-lg px-2.5 text-sm text-ink-200"
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => listButton('number', which)}
      aria-label="Numbered list">1. List</button
    >
    <!-- Lines to tick off, inside the note. Text and only text: nothing here
         reaches Today, Free Time or any count — see RichNote.checkList. -->
    <button
      type="button"
      class="press tap-h rounded-lg px-2.5 text-sm text-ink-200"
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => editor(which)?.checkList()}
      aria-label="Checklist">☐ List</button
    >
  </div>
{/snippet}

{#snippet total(text: string)}
  {@const t = totalOf(text)}
  {#if t}
    <!-- The parts are always on show when it is open: which number was taken
         from each line is a guess (see calc.ts), so the sum shows its working. -->
    <button
      type="button"
      class="press flex w-full items-baseline gap-2 text-left"
      onclick={() => (showTotal = !showTotal)}
      aria-expanded={showTotal}
    >
      <span class="section-label">Σ Total</span>
      <span class="text-[17px] font-semibold tabular-nums">{formatNumber(t.total, t.comma)}</span>
      <span class="footnote ml-auto">{showTotal ? 'Hide' : `${t.parts.length} numbers`}</span>
    </button>
    {#if showTotal}
      <p class="footnote mt-1 break-words tabular-nums">
        {t.parts.map((n) => formatNumber(n, t.comma)).join(' + ')} — the last number on each line
      </p>
    {/if}
  {/if}
{/snippet}

<div
  use:portal
  class="rise fixed inset-0 z-50 flex flex-col bg-ink-950 pt-safe pb-safe"
  role="dialog"
  aria-label="Quick notes"
>
  {#if editing}
    <header class="flex items-center gap-2 px-2 pt-2 pb-1">
      <button class="press tap px-2 text-[17px] text-accent" onclick={back}>‹ Notes</button>
      <span class="footnote flex-1 text-center">{when(editing.updatedAt)}</span>
      <!-- Said in words as well as in the pin, because a glyph that means
           "pinned" and a glyph that means "pin this" are the same picture. -->
      <button
        class="press tap-h shrink-0 rounded-lg px-2 text-sm {editing.pinnedAt
          ? 'text-accent'
          : 'text-ink-400'}"
        aria-pressed={!!editing.pinnedAt}
        onclick={() => setQuickNotePinned(editing.id, !editing.pinnedAt)}
      >
        📌 {editing.pinnedAt ? 'Pinned' : 'Pin'}
      </button>
      <RemoveButton
        label="Delete"
        confirm="Delete note?"
        onremove={() => {
          const id = editing.id;
          editingId = null;
          void softDelete('quickNotes', id);
        }}
      />
    </header>
    <!-- Above the writing box, which is where the request put it. A plain
         one-line field: a title is a name, and formatting one would be a
         second place to reach for the same three buttons. -->
    <input
      type="text"
      value={editTitle}
      oninput={(e) => onEditTitle(e.currentTarget.value)}
      placeholder="Title"
      aria-label="Note title"
      class="w-full bg-transparent px-5 pt-2 text-[19px] font-semibold tracking-[-0.01em] text-ink-50 outline-none placeholder:font-normal placeholder:text-ink-400"
    />
    <div class="px-3">{@render listTools('edit')}</div>
    <!-- The sums, the lists and the marks all live inside the editor: it owns
         its own DOM, so a textarea's value-and-selection arithmetic does not
         apply to it. -->
    <RichNote
      bind:this={editRich}
      value={editText}
      oninput={onEdit}
      autofocus
      placeholder="Note"
      class="min-h-0 w-full flex-1 overflow-y-auto px-5 py-3 text-[17px] text-ink-50"
    />

    <!-- Where a note can go once it turns out to belong somewhere. -->
    <div class="border-t border-line-1 px-4 pt-3 pb-3">
      {#if totalOf(editText)}
        <div class="mb-3">{@render total(editText)}</div>
      {/if}
      {#if sharing}
        <!--
          THE PREVIEW EARNS ITS KEEP HERE, where elsewhere it is a formality.
          The screen shows the note formatted and what leaves the app is the
          Markdown underneath, so this is the one place those two differ — and
          the box says exactly which of them is about to land in the message.
          Same component as both exports, so a note cannot copy or fail
          differently from a project.
        -->
        <ShareText text={shareText} title={editTitle.trim() || firstLine(editText)} />
        <button
          class="press tap-h mt-2 w-full rounded-xl px-3 text-sm text-ink-400"
          onclick={() => (sharing = false)}
        >
          Done sharing
        </button>
      {:else if !moving}
        <div class="flex flex-wrap gap-2">
          <button
            class="press tap-h min-w-[9rem] flex-1 rounded-xl bg-surface-1 px-3 text-sm font-medium text-accent"
            disabled={!editText.trim() || !eras.length}
            onclick={() => startMoving('notes')}
          >
            Add to notes of…
          </button>
          <button
            class="press tap-h min-w-[9rem] flex-1 rounded-xl bg-surface-1 px-3 text-sm font-medium text-accent"
            disabled={!editText.trim() || !eras.length}
            onclick={() => startMoving('project')}
          >
            Make a project
          </button>
          <!-- On the row that already exists rather than one of its own: a
               lone control on a row reads as a leftover, which this project
               learned once with Export. -->
          <button
            class="press tap-h min-w-[6rem] flex-1 rounded-xl bg-surface-1 px-3 text-sm font-medium text-accent"
            disabled={!editText.trim() && !editTitle.trim()}
            onclick={() => (sharing = true)}
          >
            Copy or share
          </button>
        </div>
      {:else}
        <div class="space-y-2">
          <p class="section-label">
            {moving === 'notes' ? "Add to a project's notes" : 'Make it a project'}
          </p>
          <div class="flex gap-2">
            <select bind:value={toEra} class="field press min-w-0 flex-1 text-sm" aria-label="Era">
              {#each eras as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
            </select>
            {#if moving === 'notes'}
              <div class="min-w-0 flex-1">
                <ProjectSelect
                  {eras}
                  eraId={toEra || undefined}
                  tag={toTag || undefined}
                  noneLabel="The era itself"
                  onpick={(era, tag) => {
                    if (era) toEra = era;
                    toTag = tag ?? '';
                  }}
                />
              </div>
            {/if}
          </div>
          {#if moving === 'project'}
            <input bind:value={newName} placeholder="Project name" class="field w-full" />
            <p class="footnote">The whole note becomes the new project's notes.</p>
          {:else}
            <p class="footnote">Added at the end of what is already there, and removed from here.</p>
          {/if}
          {#if refusal}<p class="text-sm text-accent">{refusal}</p>{/if}
          <div class="flex items-center justify-end gap-2">
            <button class="press tap-h px-3 text-sm text-ink-400" onclick={() => (moving = null)}>
              Cancel
            </button>
            <button
              class="btn btn-primary press"
              disabled={!toEra || (moving === 'project' && !newName.trim())}
              onclick={moveOn}
            >
              {moving === 'notes' ? 'Add' : 'Make project'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <header class="flex items-center gap-3 px-4 pt-3 pb-2">
      <h2 class="min-w-0 flex-1 truncate text-[28px] leading-tight font-bold tracking-[-0.02em]">
        📝 Quick notes
      </h2>
      <button class="press tap shrink-0 px-2 text-[17px] font-semibold text-accent" onclick={close}>
        Done
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
      <!-- Write first. Every letter is kept; there is no Save. -->
      <div class="card-flat p-3">
        <input
          type="text"
          value={draftTitle}
          oninput={(e) => onComposeTitle(e.currentTarget.value)}
          placeholder="Title"
          aria-label="Title for this note"
          class="mb-1 w-full bg-transparent text-[19px] font-semibold tracking-[-0.01em] text-ink-50 outline-none placeholder:font-normal placeholder:text-ink-400"
        />
        <RichNote
          bind:this={composeRich}
          value={draft}
          oninput={onCompose}
          placeholder="Write it down…"
          class="w-full min-h-[4.5rem] text-[17px] text-ink-50"
        />
        {#if totalOf(draft)}
          <div class="mb-2 border-t border-line-1 pt-2">{@render total(draft)}</div>
        {/if}
        <div class="-ml-2 flex items-center justify-between gap-2">
          {@render listTools('compose')}
          {#if draft.trim() || draftTitle.trim()}
            <button class="press tap-h rounded-lg px-3 text-sm font-medium text-accent" onclick={finishCompose}>
              New note
            </button>
          {/if}
        </div>
      </div>

      {#if flash}
        <p class="card-flat mt-3 px-4 py-3 text-sm text-good" role="status">✓ {flash}</p>
      {/if}

      {#if notes.some((n) => n.id !== composingId)}
        <!-- Search, always there once there is something to search, and
             Select beside it for clearing out several at once. -->
        <div class="mt-4 flex items-center gap-2">
          <input
            type="search"
            bind:value={search}
            placeholder="Search notes"
            class="field min-w-0 flex-1"
            aria-label="Search notes"
          />
          <button
            type="button"
            class="press tap-h shrink-0 rounded-xl px-3 text-sm font-medium text-accent"
            onclick={() => (selecting ? stopSelecting() : (selecting = true))}
          >
            {selecting ? 'Cancel' : 'Select'}
          </button>
        </div>
      {/if}

      {#if shown.length}
        <ul class="mt-3 space-y-1">
          {#each shown as n (n.id)}
            {@const on = picked.includes(n.id)}
            <li>
              <button
                class="card-flat press flex w-full items-center gap-3 px-4 py-3 text-left"
                onclick={() => (selecting ? togglePick(n.id) : open(n))}
                aria-pressed={selecting ? on : undefined}
              >
                {#if selecting}
                  <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold
                           {on ? 'border-accent bg-accent text-ink-950' : 'border-ink-600'}"
                    aria-hidden="true">{on ? '✓' : ''}</span
                  >
                {/if}
                <span class="min-w-0 flex-1">
                  <!-- The marks are RENDERED here rather than shown as
                       asterisks: this is where a note is read rather than
                       written, so it is the one place the formatting can be
                       seen. Escaped first, and never a link — see
                       renderMarks. -->
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <span class="block truncate font-medium">
                    {#if n.pinnedAt}<span aria-label="Pinned">📌</span>{' '}{/if}<!--
                    -->{@html renderMarks(rowTitle(n))}</span>
                  <span class="footnote block truncate">
                    {when(n.updatedAt)}{#if rowRest(n)}{' · '}<!--
                      -->{@html renderMarks(rowRest(n))}{/if}
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if search.trim()}
        <p class="footnote mt-4 px-1">No note has “{search.trim()}” in it.</p>
      {:else if !draft.trim()}
        <p class="footnote mt-4 px-1">
          Measurements, numbers, a name to remember. Nothing to file, nothing to choose.
        </p>
      {/if}
    </div>

    {#if selecting}
      <!-- At the bottom, where the thumb ends up after picking down a list. -->
      <div class="flex items-center gap-2 border-t border-line-1 px-4 pt-3 pb-3">
        <button
          class="press tap-h px-2 text-sm text-ink-400"
          onclick={() => (picked = picked.length === shown.length ? [] : shown.map((n) => n.id))}
        >
          {picked.length === shown.length && shown.length ? 'None' : 'All'}
        </button>
        <span class="footnote flex-1 text-center">{picked.length} selected</span>
        {#if picked.length}
          <RemoveButton
            label="Delete {picked.length}"
            confirm="Delete {picked.length} {picked.length === 1 ? 'note' : 'notes'}?"
            onremove={deletePicked}
          />
        {/if}
      </div>
    {/if}
  {/if}
</div>
