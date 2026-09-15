<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount, onDestroy } from 'svelte';
  import { portal } from '$lib/portal';

  /**
   * A printout, previewed over the app, with Print right above it.
   *
   * The project printout is a page of its own (it has a URL to go to). Brain's
   * lists are not: they are whatever the screen was filtered to at that moment,
   * and giving them a URL would mean re-running the filters there — a second
   * copy of the rules that could quietly disagree with the list you tapped on.
   * So the paper is drawn from the rows already in hand, over the top, and the
   * print stylesheet prints this and nothing else (`body.paper-open`).
   */
  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();

  // Null until mounted, so an empty title — which is what the app normally has
  // — is still put back. Testing `if (previous)` skipped exactly that case and
  // left the tab named after the last printout.
  let previous: string | null = null;
  onMount(() => {
    document.body.classList.add('paper-open');
    // The browser names the PDF after the document title.
    previous = document.title;
    document.title = title;
  });
  onDestroy(() => {
    document.body.classList.remove('paper-open');
    if (previous !== null) document.title = previous;
  });
</script>

<div class="paper-overlay paper-wrap" use:portal role="dialog" aria-label={title}>
  <div class="paper-bar print:hidden">
    <button class="press" onclick={onclose}>‹ Back</button>
    <button class="btn btn-primary press" onclick={() => window.print()}>Print or save as PDF</button>
  </div>
  {@render children()}
</div>
