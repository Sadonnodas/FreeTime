<script lang="ts">
  import type { Todo, Idea, BuyItem, Project } from '$lib/types';
  import { listToMarkdown, type ListKind } from '$lib/export';
  import ShareText from './ShareText.svelte';

  /**
   * "Export" for one of Brain's lists: the rows exactly as they are on screen.
   *
   * The rows come in from the page that is already showing them, filtered and
   * ordered — the export never runs its own query, so it cannot list something
   * different from what you were looking at when you tapped it. Narrow the list
   * first (a day, an era, closed shown or not) and that is what goes out.
   */
  let {
    kind,
    title,
    rows,
    eras,
    allTodos = []
  }: {
    kind: ListKind;
    /** The heading, saying what the list is narrowed to. */
    title: string;
    rows: (Todo | Idea | BuyItem)[];
    eras: Project[];
    allTodos?: Todo[];
  } = $props();

  let open = $state(false);
  const text = $derived(open ? listToMarkdown(kind, title, rows, eras, allTodos) : '');
</script>

<button
  type="button"
  class="press tap-h shrink-0 rounded-xl border border-line-1 px-2.5 text-xs text-ink-400"
  onclick={() => (open = true)}
  disabled={!rows.length}
>
  Export
</button>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="glass-strong rise fixed inset-0 z-50 flex flex-col justify-end p-4 pb-safe"
    onclick={() => (open = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="card mx-auto flex max-h-full w-full max-w-[560px] flex-col gap-3 p-4"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-[17px] font-semibold">Export {title}</p>
          <p class="footnote">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}, as they are on screen — narrow the list
            first to export less.
          </p>
        </div>
        <button
          class="press tap-h px-2 text-[22px] leading-none text-ink-400"
          onclick={() => (open = false)}
          aria-label="Close">×</button
        >
      </div>
      <ShareText {text} {title} />
    </div>
  </div>
{/if}
