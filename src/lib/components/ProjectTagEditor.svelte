<script lang="ts">
  import {
    renameProjectTag,
    setProjectTagDescription,
    setProjectTagColor,
    setProjectSections,
    PROJECT_COLORS
  } from '$lib/store';
  import { flip } from 'svelte/animate';
  import { Reorder } from '$lib/reorder.svelte';
  import { sectionLabel, type SectionId } from '$lib/sections';

  /**
   * A project's own identity: what it is called, what it is for, what colour it
   * wears. Shared, so the era's list and the project's own screen cannot drift
   * into offering different things in different places.
   *
   * Name, description, colour — the same three in the same order as the form
   * that creates a project, because editing one should not be a different
   * screen from making one.
   */
  let {
    eraId,
    tag,
    color,
    description = '',
    onrenamed,
    sections
  }: {
    eraId: string;
    tag: string;
    color: string;
    description?: string;
    /** The name changed. The project screen needs this: its own URL contains
     *  the old one, and staying put would show "this project is gone". */
    onrenamed?: (next: string) => void;
    /**
     * This project's section order, when the caller is a screen that draws
     * sections. The era's list is not — it shows projects, not their insides —
     * so it passes nothing and the control does not appear there.
     */
    sections?: SectionId[];
  } = $props();

  /**
   * Reordering the SECTIONS, not the project's contents.
   *
   * A compact list of six short rows rather than dragging the sections
   * themselves on the page: a section is a whole folded block, often hundreds
   * of pixels tall with a list inside it, and dragging one of those around is
   * a different and much worse gesture than dragging six equal lines. Same
   * hold-and-drag as everywhere else (reorder.svelte.ts).
   */
  const sectionDrag = new Reorder((ids) => setProjectSections(eraId, tag, ids));

  async function rename(e: Event & { currentTarget: HTMLInputElement }) {
    const next = e.currentTarget.value.trim();
    // An empty name is refused rather than saved: a project with no name cannot
    // be read in a list, tapped into, or renamed back.
    if (!next || next === tag) {
      e.currentTarget.value = tag;
      return;
    }
    await renameProjectTag(eraId, tag, next);
    onrenamed?.(next);
  }
</script>

<div class="space-y-3">
  <input value={tag} onchange={rename} placeholder="Name" class="field w-full" />
  <input
    value={description}
    onchange={(e) => setProjectTagDescription(eraId, tag, e.currentTarget.value)}
    placeholder="What is it, in a line? (optional)"
    class="field w-full"
  />
  <div class="flex flex-wrap gap-2">
    {#each PROJECT_COLORS as swatch (swatch)}
      <button
        type="button"
        class="press h-8 w-8 rounded-full border-2 {color === swatch
          ? 'border-ink-50'
          : 'border-transparent'}"
        style="background: {swatch}"
        onclick={() => setProjectTagColor(eraId, tag, swatch)}
        aria-label="Use this colour"
      ></button>
    {/each}
  </div>

  {#if sections?.length}
    <!-- Only where sections are actually drawn. On the era's list this would
         be a control for something not on screen. -->
    <div>
      <p class="section-label mb-1.5">Order of sections</p>
      <ul class="space-y-1">
        {#each sectionDrag.arrange(sections.map((id: SectionId) => ({ id }))) as row (row.id)}
          <li
            class="card-flat flex items-center gap-2 px-3 py-2 text-sm"
            use:sectionDrag.item={row.id}
            animate:flip={{ duration: sectionDrag.dragging === row.id ? 0 : 180 }}
          >
            <span class="text-ink-400" aria-hidden="true">⠿</span>
            <span class="min-w-0 flex-1">{sectionLabel(row.id)}</span>
          </li>
        {/each}
      </ul>
      <p class="footnote mt-1.5">Press and hold one to move it.</p>
    </div>
  {/if}
</div>
