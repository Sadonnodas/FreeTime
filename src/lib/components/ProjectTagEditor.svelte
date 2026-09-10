<script lang="ts">
  import {
    renameProjectTag,
    setProjectTagDescription,
    setProjectTagColor,
    PROJECT_COLORS
  } from '$lib/store';

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
    onrenamed
  }: {
    eraId: string;
    tag: string;
    color: string;
    description?: string;
    /** The name changed. The project screen needs this: its own URL contains
     *  the old one, and staying put would show "this project is gone". */
    onrenamed?: (next: string) => void;
  } = $props();

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
</div>
