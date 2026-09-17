<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import {
    createQuickNote, updateQuickNote, softDelete, quickNoteToProjectNote, quickNoteToProject
  } from '$lib/store';
  import { activeProjects } from '$lib/queries';
  import type { Project, QuickNote } from '$lib/types';
  import { portal } from '$lib/portal';
  import RemoveButton from './RemoveButton.svelte';

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
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  );
  const notes = $derived(($notesQ as QuickNote[] | undefined) ?? []);

  // --- writing: the box at the top, or an older note opened full screen
  let editingId = $state<string | null>(null);
  let draft = $state('');
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
    pending ??= createQuickNote(text);
    return pending;
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
    const id = composingId ?? (pending ? await pending : null);
    if (id) {
      if (draft.trim()) await updateQuickNote(id, draft);
      else await softDelete('quickNotes', id);
    }
    composingId = null;
    pending = null;
    draft = '';
  }

  const editing = $derived(notes.find((n) => n.id === editingId));
  let editText = $state('');
  let editTimer: ReturnType<typeof setTimeout> | undefined;

  function open(n: QuickNote) {
    moving = null;
    editText = n.text;
    editingId = n.id;
  }
  function onEdit(text: string) {
    editText = text;
    clearTimeout(editTimer);
    const id = editingId;
    editTimer = setTimeout(() => id && void updateQuickNote(id, text), 300);
  }
  async function back() {
    clearTimeout(editTimer);
    const id = editingId;
    editingId = null;
    if (!id) return;
    if (editText.trim()) await updateQuickNote(id, editText);
    else await softDelete('quickNotes', id);
  }

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
    if (kind === 'project') newName = firstLine(editText) === 'Empty note' ? '' : firstLine(editText);
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
    await updateQuickNote(id, editText);
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

  // --- the list
  let search = $state('');
  const shown = $derived(
    notes
      .filter((n) => n.id !== composingId)
      .filter((n) => (search.trim() ? n.text.toLowerCase().includes(search.trim().toLowerCase()) : true))
  );

  const firstLine = (t: string) => t.trim().split('\n')[0] || 'Empty note';
  const rest = (t: string) => t.trim().split('\n').slice(1).join(' ').trim();
  function when(iso: string): string {
    const d = new Date(iso);
    const same = d.toDateString() === new Date().toDateString();
    return same
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  const focus = (node: HTMLTextAreaElement) => {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  };
</script>

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
    <textarea
      use:focus
      value={editText}
      oninput={(e) => onEdit(e.currentTarget.value)}
      class="min-h-0 w-full flex-1 resize-none bg-transparent px-5 py-3 text-[17px] leading-relaxed text-ink-50 outline-none"
      aria-label="Note"
    ></textarea>

    <!-- Where a note can go once it turns out to belong somewhere. -->
    <div class="border-t border-line-1 px-4 pt-3 pb-3">
      {#if !moving}
        <div class="flex gap-2">
          <button
            class="press tap-h flex-1 rounded-xl bg-surface-1 px-3 text-sm font-medium text-accent"
            disabled={!editText.trim() || !eras.length}
            onclick={() => startMoving('notes')}
          >
            Add to notes of…
          </button>
          <button
            class="press tap-h flex-1 rounded-xl bg-surface-1 px-3 text-sm font-medium text-accent"
            disabled={!editText.trim() || !eras.length}
            onclick={() => startMoving('project')}
          >
            Make a project
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
              <select
                bind:value={toTag}
                class="field press min-w-0 flex-1 text-sm"
                aria-label="Project"
                disabled={!toEraTags.length}
              >
                <option value="">{toEraTags.length ? 'The era itself' : 'No projects'}</option>
                {#each toEraTags as t (t)}<option value={t}>{t}</option>{/each}
              </select>
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
        <textarea
          value={draft}
          oninput={(e) => onCompose(e.currentTarget.value)}
          rows={draft.includes('\n') || draft.length > 40 ? 5 : 3}
          placeholder="Write it down…"
          class="w-full resize-none bg-transparent text-[17px] leading-relaxed text-ink-50 outline-none placeholder:text-ink-400"
          aria-label="New quick note"
        ></textarea>
        {#if draft.trim()}
          <div class="flex items-center justify-between gap-2">
            <span class="footnote">Saved as you type</span>
            <button class="press tap-h rounded-lg px-3 text-sm font-medium text-accent" onclick={finishCompose}>
              New note
            </button>
          </div>
        {/if}
      </div>

      {#if flash}
        <p class="card-flat mt-3 px-4 py-3 text-sm text-good" role="status">✓ {flash}</p>
      {/if}

      {#if notes.length > 6}
        <input bind:value={search} placeholder="Search notes" class="field mt-4 w-full" />
      {/if}

      {#if shown.length}
        <ul class="mt-4 space-y-1">
          {#each shown as n (n.id)}
            <li>
              <button class="card-flat press w-full px-4 py-3 text-left" onclick={() => open(n)}>
                <span class="block truncate font-medium">{firstLine(n.text)}</span>
                <span class="footnote block truncate">
                  {when(n.updatedAt)}{rest(n.text) ? ` · ${rest(n.text)}` : ''}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if !draft.trim()}
        <p class="footnote mt-4 px-1">
          Measurements, numbers, a name to remember. Nothing to file, nothing to choose.
        </p>
      {/if}
    </div>
  {/if}
</div>
