<script lang="ts">
  import { liveQuery } from 'dexie';
  import { createIdea } from '$lib/store';
  import { activeProjects } from '$lib/queries';
  import type { Project } from '$lib/types';

  /**
   * One thought, straight into a project.
   *
   * The capture box below already takes anything in one field, but everything
   * it takes lands in the inbox with no home. That is the right default for
   * "buy cat food" and the wrong one for a lyric, because a lyric belongs to
   * something and you already know what while you are typing it.
   *
   * So this is capture with exactly one optional extra, and the extra is one
   * tap on a chip. No title, no tags, no date, nothing required — the project
   * chips can be ignored entirely and the idea still saves.
   */
  let { onDone }: { onDone: () => void } = $props();

  const projectsQ = liveQuery(() => activeProjects());

  let text = $state('');
  let projectId = $state<string | undefined>(undefined);

  async function save() {
    const value = text.trim();
    if (!value) return;
    await createIdea(value, projectId);
    onDone();
  }

  function onKey(e: KeyboardEvent) {
    // Enter saves, shift-Enter makes a new line. A lyric is often two lines,
    // so the newline has to stay reachable.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  }
</script>

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex items-center justify-between px-4 pt-safe">
    <span class="section-label py-3">New idea</span>
    <button
      class="press tap px-2 text-[22px] leading-none text-ink-400"
      onclick={onDone}
      aria-label="Close">×</button
    >
  </div>

  <div class="flex-1 overflow-y-auto px-4">
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      bind:value={text}
      onkeydown={onKey}
      autofocus
      placeholder="A lyric, an app, a shape for a bowl…"
      class="field w-full py-3 text-[17px] leading-relaxed"
      rows="5"
    ></textarea>

    <p class="section-label mt-5 mb-2">Where does it belong?</p>
    <div class="flex flex-wrap gap-2">
      <button
        class="chip press {projectId === undefined ? 'chip-on' : ''}"
        onclick={() => (projectId = undefined)}
      >
        Nowhere yet
      </button>
      {#each ($projectsQ as Project[] | undefined) ?? [] as p (p.id)}
        <button
          class="chip press {projectId === p.id ? 'chip-on' : ''}"
          onclick={() => (projectId = projectId === p.id ? undefined : p.id)}
        >
          {p.name}
        </button>
      {/each}
    </div>

    <div class="h-6"></div>
  </div>

  <div class="p-4 pb-safe">
    <button class="btn btn-primary press w-full py-4" disabled={!text.trim()} onclick={save}>
      Save
    </button>
  </div>
</div>
