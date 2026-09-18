<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import type { Idea, Project } from '$lib/types';
  import {
    promoteIdea, toggleIdeaDone, updateIdea, setIdeaProject, softDelete, ideaToProject
  } from '$lib/store';
  import { tintFor } from '$lib/colors';
  import RenameField from './RenameField.svelte';
  import RemoveButton from './RemoveButton.svelte';
  import { rankedReorder } from '$lib/reorder.svelte';
  import { flip } from 'svelte/animate';

  /**
   * A list of ideas, and everything that can happen to one.
   *
   * AN IDEA IS NOT A TO-DO, and this is where that difference lives. Toon's
   * example: "an ear-training game" might need months of thinking, or turn out
   * not to be a good idea after all. Putting it on a to-do list makes it a
   * thing you are behind on from the moment it is written. So an idea gets
   * three ways forward and none of them is required: make it a to-do when it
   * is ready to be done, make it a PROJECT when it turns out to be big, or
   * delete it when it turns out to be wrong. Sitting there indefinitely is the
   * fourth, and it is a perfectly good one.
   *
   * One component for Brain, a project's screen and an era's overview, for the
   * reason BuyList is one component: two copies of the same row drift into
   * offering different things in different places.
   */
  let {
    ideas,
    eras,
    showWhere = true,
    empty
  }: {
    ideas: Idea[];
    /** Every live era, for "Belongs to" and for starting a project. */
    eras: Project[];
    /** Say which era and project each row is in. Off inside a project, where
     *  every row would say the same thing. */
    showWhere?: boolean;
    empty?: Snippet;
  } = $props();

  let openId = $state<string | null>(null);

  /** Hold and drag to put them in your own order (rank.ts) — one order per
   *  idea, so this list agrees with every other list the idea is in. */
  const drag = rankedReorder('ideas', () => ideas);

  /** The make-it-a-project form, for whichever row has it open. */
  let growing = $state<string | null>(null);
  let projectName = $state('');
  let projectEra = $state('');
  let growError = $state('');

  const eraOf = (id?: string) => eras.find((e) => e.id === id);

  const where = (i: Idea) =>
    [eraOf(i.projectId)?.name, i.projectId ? i.tag : undefined].filter(Boolean).join(' · ');

  function startGrowing(i: Idea) {
    growing = i.id;
    growError = '';
    // The idea's own words, trimmed to something that fits in a header. Rarely
    // the right name as it stands, which is why it is a field and not a tap.
    const text = i.text.trim();
    projectName = text.length > 40 ? text.slice(0, 40).replace(/\s+\S*$/, '') : text;
    projectEra = i.projectId ?? eras[0]?.id ?? '';
  }

  async function grow(i: Idea) {
    const name = projectName.trim();
    if (!name || !projectEra) return;
    const result = await ideaToProject(i.id, projectEra, name);
    if (result === 'name-taken') {
      growError = `${eraOf(projectEra)?.name ?? 'That era'} already has a project called ${name}.`;
      return;
    }
    if (result !== 'started') return;
    growing = null;
    openId = null;
    // It became somewhere; go there. The idea is the first thing inside it.
    await goto(`${base}/projects/${projectEra}/${encodeURIComponent(name)}`);
  }
</script>

<ul class="space-y-1">
  {#each drag.arrange(ideas) as i (i.id)}
    <!-- Tinted only where the list mixes projects. Inside one project every row
         would wear the same colour, which says nothing, and would make the ideas
         look like a different kind of thing from the plain to-dos above them. -->
    {@const tint = showWhere ? tintFor(eraOf(i.projectId), i.projectId ? i.tag : undefined) : undefined}
    <li
      class="card-flat px-3 {tint ? 'row-tint' : ''}"
      style:--row={tint?.fill}
      style:--edge={tint?.edge}
      use:drag.item={{ id: i.id, off: openId === i.id }}
      animate:flip={{ duration: drag.dragging === i.id ? 0 : 180 }}
    >
      <div class="flex items-center gap-3">
        <!-- Finishing a want is a real thing — a book gets read — and it counts
             as a win without ever having been a task. -->
        <button
          class="press tap shrink-0 {i.doneAt ? 'text-good' : 'text-ink-400'}"
          onclick={() => toggleIdeaDone(i.id, !i.doneAt)}
          aria-label={i.doneAt ? 'Not done after all' : 'Done with it'}
        >
          {i.doneAt ? '✓' : '○'}
        </button>

        <button
          class="min-w-0 flex-1 py-3 text-left"
          onclick={() => {
            openId = openId === i.id ? null : i.id;
            growing = null;
          }}
        >
          <p class={i.doneAt ? 'text-ink-400 line-through' : ''}>{i.text}</p>
          <!-- `group` exists only on ideas migrated from the old Lists tab.
               Shown so nothing from back then goes invisible. -->
          {#if (showWhere && i.projectId) || i.group || i.promotedToTodoId || i.becameProjectAt}
            <p class="footnote">
              {[
                showWhere && i.projectId ? where(i) : null,
                i.group,
                i.becameProjectAt ? 'started this project' : null,
                i.promotedToTodoId ? '→ to-do' : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          {/if}
        </button>

        {#if !i.promotedToTodoId && !i.doneAt}
          <button
            class="press tap-h shrink-0 rounded-xl bg-surface-2 px-3 text-sm text-ink-200"
            onclick={() => promoteIdea(i.id)}>Make a to-do</button
          >
        {/if}
      </div>

      {#if openId === i.id}
        <div class="mt-1 space-y-3 border-t border-line-1 pt-3 pb-3">
          <div>
            <p class="section-label mb-2">What it says</p>
            <RenameField
              value={i.text}
              label="What it says"
              onrename={(text) => updateIdea(i.id, { text })}
            />
          </div>

          <!-- Where it belongs, decided whenever you know — which is usually not
               the moment you had the thought. -->
          <div>
            <p class="section-label mb-2">Belongs to</p>
            <div class="flex flex-wrap gap-2">
              <label class="min-w-0 flex-1">
                <span class="footnote mb-1 block">Era</span>
                <select
                  value={i.projectId ?? ''}
                  class="field press w-full text-sm"
                  onchange={(e) => setIdeaProject(i.id, e.currentTarget.value || undefined)}
                >
                  <option value="">Nowhere yet</option>
                  {#each eras as era (era.id)}
                    <option value={era.id}>{era.name}</option>
                  {/each}
                </select>
              </label>
              <label class="min-w-0 flex-1">
                <span class="footnote mb-1 block">Project</span>
                <select
                  value={i.tag ?? ''}
                  class="field press w-full text-sm"
                  disabled={!(eraOf(i.projectId)?.tags ?? []).length}
                  onchange={(e) =>
                    setIdeaProject(i.id, i.projectId, e.currentTarget.value || undefined)}
                >
                  <option value="">
                    {i.projectId
                      ? (eraOf(i.projectId)?.tags ?? []).length
                        ? 'No project'
                        : 'None in this era'
                      : 'Pick an era first'}
                  </option>
                  {#each eraOf(i.projectId)?.tags ?? [] as tag (tag)}
                    <option value={tag}>{tag}</option>
                  {/each}
                </select>
              </label>
            </div>
          </div>

          {#if !i.becameProjectAt && eras.length}
            {#if growing === i.id}
              <!--
                Its own small form, because a project needs a NAME and the idea's
                text is rarely one — "a game where you hear two notes and guess
                the interval" is a line, not a header. The full text is kept as
                the new project's description, so nothing typed is lost.
              -->
              <form
                class="card space-y-2 p-3"
                onsubmit={(e) => {
                  e.preventDefault();
                  void grow(i);
                }}
              >
                <p class="section-label">Make it a project</p>
                <input
                  bind:value={projectName}
                  class="field w-full"
                  placeholder="What the project is called"
                  aria-label="Project name"
                />
                {#if !i.projectId}
                  <select bind:value={projectEra} class="field press w-full text-sm" aria-label="Era">
                    {#each eras as era (era.id)}
                      <option value={era.id}>In {era.name}</option>
                    {/each}
                  </select>
                {:else}
                  <p class="footnote">
                    Next to the others in {eraOf(i.projectId)?.name}. Projects never go inside
                    projects.
                  </p>
                {/if}
                {#if growError}
                  <p class="footnote text-accent-2">{growError}</p>
                {/if}
                <div class="flex gap-2">
                  <button
                    type="submit"
                    class="btn btn-primary press flex-1"
                    disabled={!projectName.trim() || !projectEra}>Start project</button
                  >
                  <button
                    type="button"
                    class="press tap-h rounded-xl px-3 text-sm text-ink-400"
                    onclick={() => (growing = null)}>Not yet</button
                  >
                </div>
              </form>
            {/if}
          {/if}

          <div class="flex items-center gap-1">
            {#if !i.becameProjectAt && eras.length && growing !== i.id}
              <button
                class="press tap-h rounded-lg px-3 text-sm text-accent"
                onclick={() => startGrowing(i)}>Make it a project</button
              >
            {/if}
            <span class="flex-1"></span>
            <!-- For the idea that turned out not to be one. Two taps, like every
                 other delete, and no dialog. -->
            <RemoveButton
              label="Delete"
              confirm="Really delete it?"
              onremove={() => {
                openId = null;
                void softDelete('ideas', i.id);
              }}
            />
          </div>
        </div>
      {/if}
    </li>
  {:else}
    {@render empty?.()}
  {/each}
</ul>
