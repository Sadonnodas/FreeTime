<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  /**
   * One kind of thing inside a project, with a header you can fold away.
   *
   * THE POINT IS NOT TIDINESS, IT IS REACH. Everything a project holds now
   * lives on one screen, so fifteen to-dos would bury the photograph
   * underneath them — "you don't have to scroll down a million times to see
   * your photos under your 15 to-dos" was the actual brief. Folding a section
   * is what makes a long project navigable without adding a tab bar back.
   *
   * The state is remembered per project and per section, in localStorage
   * rather than in the database: which sections you had folded on this phone
   * is a property of this phone, not of the project, and syncing it would mean
   * a laptop quietly refolding things on the device you were reading them on.
   *
   * A project page opens with its to-dos showing and everything else folded to
   * a row of headers with counts, so a fresh project is a short screen rather
   * than a scroll. Sections that do not say otherwise fold themselves once they
   * hold more than COLLAPSE_OVER items. Either way the choice is remembered the
   * moment you make one, so the defaults only ever apply once per section.
   */
  const COLLAPSE_OVER = 8;

  let {
    id,
    title,
    count,
    color,
    defaultFolded,
    open = false,
    children,
    action
  }: {
    /** Stable key for remembering the folded state. */
    id: string;
    title: string;
    count: number;
    color?: string;
    /** How this section starts before anyone has folded it by hand. */
    defaultFolded?: boolean;
    /** Set true to unfold from outside — the add sheet picking this kind. */
    open?: boolean;
    children: Snippet;
    /** Optional control shown in the header, e.g. an add field toggle. */
    action?: Snippet;
  } = $props();

  const key = $derived(`freetime.fold.${id}`);

  let folded = $state(false);

  // Re-read when the SECTION changes, never when its contents do. Reading the
  // count untracked is the whole trick: without it, adding a ninth to-do would
  // re-run this and silently fold the section you were typing into.
  $effect(() => {
    const k = key;
    untrack(() => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(k);
      } catch {
        /* private window, or site data blocked — fall through to the default */
      }
      folded = saved !== null ? saved === '1' : (defaultFolded ?? count > COLLAPSE_OVER);
    });
  });

  // Someone outside asked for this section: unfold, without touching the
  // remembered preference. Reaching in and rewriting localStorage was tried
  // first and did nothing at all, because the effect above only re-reads when
  // the section changes, not when storage does.
  $effect(() => {
    if (open) folded = false;
  });

  function toggle() {
    folded = !folded;
    try {
      localStorage.setItem(key, folded ? '1' : '0');
    } catch {
      /* not being able to remember it is not a reason to refuse to fold it */
    }
  }
</script>

<section class="mb-3">
  <div class="flex items-center gap-2">
    <button
      class="press tap-h flex min-w-0 flex-1 items-center gap-2 text-left"
      onclick={toggle}
      aria-expanded={!folded}
    >
      <span
        class="text-[11px] transition-transform duration-200 {folded ? '' : 'rotate-90'}"
        style="color: {color ?? 'var(--color-ink-400)'}"
        aria-hidden="true">▶</span
      >
      <span class="section-label truncate">{title}</span>
      {#if count}
        <span class="footnote shrink-0 tabular-nums">{count}</span>
      {/if}
    </button>
    {#if action}{@render action()}{/if}
  </div>

  {#if !folded}
    <div class="mt-2">{@render children()}</div>
  {/if}
</section>
