<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { renderMarkdown } from '$lib/markdown';
  import { mmss, displayTitle } from '$lib/memos';
  import { projectTagColor } from '$lib/store';
  import {
    collectProject, todoDetails, buyDetails, buyLineTotal, demoteHeadings, EXPORT_SECTIONS,
    EVERYTHING, type ExportSection, type ProjectExport
  } from '$lib/export';
  import { money } from '$lib/format';

  /**
   * A project on paper.
   *
   * Printed by the browser — Print, or Save as PDF from the same dialog, which
   * the iPhone share sheet offers too — rather than by a PDF library, which
   * would be a third runtime dependency producing a worse document than the
   * browser's own typesetting. See export.ts.
   *
   * THIS PAGE IS PAPER IN BOTH THEMES. Black on white on screen as well as in
   * print, whatever the app's appearance is set to: what you see is what comes
   * out, and a dark preview of a white printout is a preview of nothing.
   *
   * Laid out for a pen: to-dos and shopping get real empty boxes to tick by
   * hand, and the project's colour is kept to a single rule under the title,
   * because a page of tinted rows prints as grey mud on a mono printer.
   */
  const eraId = $derived(page.params.id!);
  const tag = $derived(decodeURIComponent(page.params.tag!));
  const sections = $derived.by<Set<ExportSection>>(() => {
    const raw = page.url.searchParams.get('s');
    const picked = (raw ? raw.split(',') : EVERYTHING).filter((k) =>
      EXPORT_SECTIONS.some((s) => s.key === k)
    ) as ExportSection[];
    return new Set(picked.length ? picked : EVERYTHING);
  });

  let data = $state<ProjectExport | null | undefined>(undefined);
  onMount(async () => {
    data = await collectProject(eraId, tag);
  });

  const today = new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const color = $derived(data ? projectTagColor(data.era.tags, data.era.tagColors, tag) : '#999');
  const show = (s: ExportSection, has: boolean) => sections.has(s) && has;
  const buyTotal = $derived((data?.buy ?? []).reduce((sum, b) => sum + buyLineTotal(b), 0));
</script>

<svelte:head>
  <!-- The browser uses the title as the PDF's filename. -->
  <title>{tag} — {data?.era.name ?? 'FreeTime'}</title>
</svelte:head>

<div class="paper-wrap">
  <div class="paper-bar print:hidden">
    <a href="{base}/projects/{eraId}/{encodeURIComponent(tag)}" class="press">‹ Back</a>
    <button class="btn btn-primary press" onclick={() => window.print()} disabled={!data}>
      Print or save as PDF
    </button>
  </div>

  {#if data === undefined}
    <p class="paper-muted">Gathering…</p>
  {:else if data === null}
    <p class="paper-muted">This project is not there any more. It may have been renamed.</p>
  {:else}
    <article class="paper">
      <header class="paper-head" style="border-color: {color}">
        <p class="paper-kicker">{data.era.name}</p>
        <h1>{data.tag}</h1>
        {#if data.description}<p class="paper-lede">{data.description}</p>{/if}
        <p class="paper-muted">Exported {today}</p>
      </header>

      {#if show('todos', data.open.length > 0)}
        <section>
          <h2>To-dos</h2>
          <ul class="paper-checks">
            {#each data.open as { todo, after } (todo.id)}
              <li>
                <span class="paper-box" aria-hidden="true"></span>
                <div>
                  <p>{todo.title}</p>
                  {#if todoDetails(todo, after).length}
                    <p class="paper-muted">{todoDetails(todo, after).join(' · ')}</p>
                  {/if}
                  {#if todo.image}<img src={todo.image} alt="" class="paper-thumb" />{/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if show('done', data.done.length > 0)}
        <section>
          <h2>Done</h2>
          <ul class="paper-checks">
            {#each data.done as t (t.id)}
              <li class="paper-done">
                <span class="paper-box paper-box-on" aria-hidden="true">✓</span>
                <p>{t.title}</p>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if show('ideas', data.ideas.length > 0)}
        <section>
          <h2>Ideas</h2>
          <ul class="paper-bullets">
            {#each data.ideas as i (i.id)}<li>{i.text}</li>{/each}
          </ul>
        </section>
      {/if}

      {#if show('buy', data.buy.length > 0)}
        <section>
          <h2>To buy</h2>
          <ul class="paper-checks">
            {#each data.buy as b (b.id)}
              <li>
                <span class="paper-box" aria-hidden="true"></span>
                <div>
                  <p>{b.name}{#if (b.qty ?? 1) > 1}&nbsp;×{b.qty}{/if}</p>
                  {#if buyDetails(b).length}<p class="paper-muted paper-break">{buyDetails(b).join(' · ')}</p>{/if}
                  {#if b.image}<img src={b.image} alt="" class="paper-thumb" />{/if}
                </div>
              </li>
            {/each}
          </ul>
          {#if buyTotal}
            <p class="paper-total">Still to buy: {money(buyTotal, data.buy[0]?.currency)}</p>
          {/if}
        </section>
      {/if}

      {#if show('notes', !!data.note)}
        <section>
          <h2>Notes</h2>
          <!-- The same renderer the app uses, which escapes before it parses —
               a note syncs between devices, so it is never trusted as HTML. -->
          <div class="paper-md">{@html renderMarkdown(demoteHeadings(data.note!))}</div>
        </section>
      {/if}

      {#if show('blocks', data.blocks.length > 0)}
        <section>
          <h2>Blocks</h2>
          {#each data.blocks as w (w.id)}
            <div class="paper-block">
              {#if w.title}<p class="paper-kicker">{w.title}</p>{/if}
              {#if w.kind === 'note'}<p class="paper-pre">{w.text}</p>{/if}
              {#if w.kind === 'countdown'}<p>{w.date}</p>{/if}
              {#if w.kind === 'links'}
                <ul class="paper-bullets">
                  {#each w.links ?? [] as l (l.url)}<li class="paper-break">{l.label || l.url} — {l.url}</li>{/each}
                </ul>
              {/if}
              {#if w.kind === 'image'}<img src={w.image} alt={w.title ?? ''} class="paper-photo" />{/if}
            </div>
          {/each}
        </section>
      {/if}

      {#if show('recordings', data.recordings.length > 0)}
        <section>
          <h2>Recordings</h2>
          <ul class="paper-bullets">
            {#each data.recordings as m (m.id)}<li>{displayTitle(m)} ({mmss(m.durationMs)})</li>{/each}
          </ul>
        </section>
      {/if}
    </article>
  {/if}
</div>
