<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { Widget, WidgetKind, Memo } from '$lib/types';
  import {
    widgetsFor, addWidget, updateWidget, removeWidget, moveWidget, setWidgetTag,
    countdownLabel, activityByWeek, projectCounts, nextDated, resizeImage,
    WIDGET_KINDS
  } from '$lib/widgets';
  import { shortDate } from '$lib/format';
  import { memosForProject } from '$lib/memos';
  import { canRecord } from '$lib/audio';
  import MemoList from './MemoList.svelte';
  import MemoRecorder from './MemoRecorder.svelte';

  /**
   * The configurable header of a project page.
   *
   * Sits above the three tabs rather than becoming a fourth one — the spec is
   * firm that a project has exactly three, and depth is what killed the last
   * system. Edit mode is explicit, so nothing rearranges under a stray tap.
   */
  let {
    projectId,
    section,
    sections = []
  }: { projectId: string; section?: string; sections?: string[] } = $props();

  const widgetsQ = $derived(liveQuery(() => widgetsFor(projectId)));

  /**
   * Blocks belong to a project inside the era, the same way its to-dos and its
   * recordings do.
   *
   * Before this they did not, and it showed the moment anyone used the app for
   * real: a schematic photographed for one build sat on the era itself, in
   * among every other build's blocks. Same rule as the to-do list — a chip
   * shows only that project, no chip shows the whole era.
   */
  const widgets = $derived(
    (($widgetsQ as Widget[] | undefined) ?? []).filter((w) =>
      section ? w.tag === section : true
    )
  );

  let editing = $state(false);
  let adding = $state(false);

  // Derived data each block needs, loaded once per project.
  const memosQ = $derived(liveQuery(() => memosForProject(projectId)));
  // Scoped by the section chip above, so picking a song shows that song's
  // recordings rather than everything the project has ever collected.
  const memos = $derived(
    (($memosQ as Memo[] | undefined) ?? []).filter((m) => (section ? m.tag === section : true))
  );
  let recording = $state(false);
  const recordable = canRecord();

  let weeks = $state<number[]>([]);
  let counts = $state({ open: 0, closedThisMonth: 0 });
  let suggestedDate = $state<{ date: string; title: string } | null>(null);

  $effect(() => {
    const id = projectId;
    void $widgetsQ;
    void activityByWeek(id).then((w) => (weeks = w));
    void projectCounts(id).then((c) => (counts = c));
    void nextDated(id).then((t) =>
      (suggestedDate = t?.date ? { date: t.date, title: t.title } : null)
    );
  });

  const peak = $derived(Math.max(1, ...weeks));

  async function add(kind: WidgetKind) {
    // Added while a project chip is lit, so it lands there — the same "the
    // filter is also the destination" rule the to-do field uses.
    const id = await addWidget(projectId, kind, section);
    adding = false;
    editing = true;
    // A countdown with no date is useless, so seed it from the project's next
    // dated to-do when there is one.
    if (kind === 'countdown' && suggestedDate) {
      await updateWidget(id, { date: suggestedDate.date, title: suggestedDate.title });
    }
  }

  async function onImage(widget: Widget, e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await updateWidget(widget.id, { image: await resizeImage(file) });
  }

  function setLinks(widget: Widget, raw: string) {
    // One per line, "label | url" or just a url. Deliberately a plain textarea:
    // a repeating add/remove form for two fields is a lot of interface for
    // something typed once.
    const links = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [a, b] = line.split('|').map((p) => p.trim());
        return b ? { label: a!, url: b } : { label: a!, url: a! };
      });
    void updateWidget(widget.id, { links });
  }

  const linksToText = (w: Widget) =>
    (w.links ?? []).map((l) => (l.label === l.url ? l.url : `${l.label} | ${l.url}`)).join('\n');

  const list = $derived(widgets);

  /** The photo opened full-screen, if any. */
  let viewing = $state<Widget | null>(null);
</script>

<section class="mb-5">
  {#if list.length}
    <div class="grid grid-cols-2 gap-3">
      {#each list as widget (widget.id)}
        <!-- Editing forces every block full width. A half-width card leaves
             132px of content, and the control row below needs 188px, so in edit
             mode the grid used to scroll sideways on a phone. Going full width
             fixes that and gives the label and text fields room to be typed in.
             The two-column grid comes back the moment you tap Done. -->
        <div class="card rise p-4 {widget.size === 'wide' || editing ? 'col-span-2' : ''}">
          {#if widget.title || editing}
            <p class="section-label mb-2 truncate">{widget.title || 'Untitled'}</p>
          {/if}

          {#if widget.kind === 'countdown'}
            {#if widget.date}
              {@const c = countdownLabel(widget.date)}
              <p class="text-[2rem] font-bold leading-none tracking-[-0.03em]">{c.value}</p>
              <p class="footnote mt-1">{c.caption} · {shortDate(widget.date)}</p>
            {:else}
              <p class="footnote">Pick a date below.</p>
            {/if}
          {:else if widget.kind === 'counts'}
            <div class="flex gap-6">
              <div>
                <p class="text-[2rem] font-bold leading-none tracking-[-0.03em]">{counts.open}</p>
                <p class="footnote mt-1">open</p>
              </div>
              <div>
                <p class="text-[2rem] font-bold leading-none tracking-[-0.03em] text-good">
                  {counts.closedThisMonth}
                </p>
                <p class="footnote mt-1">closed</p>
              </div>
            </div>
          {:else if widget.kind === 'activity'}
            <!-- Bars are scaled to this project's own busiest week, not to a
                 target. There is nothing here to fall short of. -->
            <div class="flex h-12 items-end gap-[3px]">
              {#each weeks as n, i (i)}
                <div
                  class="flex-1 rounded-[2px] {n ? 'bg-accent' : 'bg-surface-3'}"
                  style="height: {n ? Math.max(12, (n / peak) * 100) : 8}%"
                  title="{n} closed"
                ></div>
              {/each}
            </div>
            <p class="footnote mt-2">last 12 weeks</p>
          {:else if widget.kind === 'note'}
            <p class="body whitespace-pre-wrap">{widget.text || 'Nothing pinned yet.'}</p>
          {:else if widget.kind === 'links'}
            <div class="space-y-1.5">
              {#each widget.links ?? [] as link (link.url)}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  class="press block truncate text-accent"
                >
                  {link.label}
                </a>
              {:else}
                <p class="footnote">No links yet.</p>
              {/each}
            </div>
          {:else if widget.kind === 'memos'}
            <!-- Recordings live above the tabs like every other block, which is
                 how a project gains a fourth kind of content without gaining a
                 fourth tab. -->
            {#if memos.length}
              <MemoList {memos} grouped={false} showProject={false} />
            {:else}
              <p class="footnote">
                {section
                  ? `Nothing recorded for ${section} yet. The tape is still blank.`
                  : 'Nothing filed here yet.'}
              </p>
            {/if}
            {#if recordable}
              <button
                class="press tap mt-2 flex w-full items-center justify-center gap-2 rounded-xl
                       bg-surface-2 text-sm text-ink-50"
                onclick={() => (recording = true)}
              >
                <span class="text-red-400">●</span> Record
              </button>
            {/if}
          {:else if widget.kind === 'image'}
            {#if widget.image}
              <!-- Tappable, because a schematic is the one block whose whole
                   point is the detail in it, and a card on a phone is 170px
                   wide. -->
              <button
                class="press -m-4 mt-0 block w-[calc(100%+2rem)]"
                onclick={() => (viewing = widget)}
                aria-label="View {widget.title ?? 'photo'} full screen"
              >
                <img
                  src={widget.image}
                  alt={widget.title ?? 'Photo'}
                  class="w-full rounded-b-[20px] object-cover"
                />
              </button>
            {:else}
              <p class="footnote">No photo yet.</p>
            {/if}
          {/if}

          {#if editing}
            <div class="mt-3 space-y-2 border-t border-line-1 pt-3">
              <input
                value={widget.title ?? ''}
                oninput={(e) => updateWidget(widget.id, { title: e.currentTarget.value })}
                placeholder="Label"
                class="field w-full text-sm"
              />

              {#if widget.kind === 'countdown'}
                <input
                  type="date"
                  value={widget.date ?? ''}
                  onchange={(e) => updateWidget(widget.id, { date: e.currentTarget.value })}
                  class="field w-full text-sm"
                />
              {:else if widget.kind === 'note'}
                <textarea
                  value={widget.text ?? ''}
                  oninput={(e) => updateWidget(widget.id, { text: e.currentTarget.value })}
                  placeholder="Anything worth keeping in view"
                  class="field w-full py-2 text-sm"
                  rows="4"
                ></textarea>
              {:else if widget.kind === 'links'}
                <textarea
                  value={linksToText(widget)}
                  onchange={(e) => setLinks(widget, e.currentTarget.value)}
                  placeholder="Label | https://…"
                  class="field w-full py-2 text-sm"
                  rows="3"
                ></textarea>
              {:else if widget.kind === 'image'}
                <label class="press tap flex items-center justify-center rounded-xl bg-surface-2 text-sm">
                  <input type="file" accept="image/*" class="hidden" onchange={(e) => onImage(widget, e)} />
                  <span class="text-accent">Choose a photo</span>
                </label>
              {/if}

              {#if sections.length}
                <!-- Which project inside the era this block belongs to. Same
                     shape as the buy list's picker, so moving a photo to the
                     right build is a tap rather than a delete and re-upload. -->
                <div class="flex flex-wrap gap-2 pt-1">
                  <button
                    class="chip press {widget.tag ? '' : 'chip-on'}"
                    onclick={() => setWidgetTag(widget.id, undefined)}
                  >
                    Whole era
                  </button>
                  {#each sections as t (t)}
                    <button
                      class="chip press {widget.tag === t ? 'chip-on' : ''}"
                      onclick={() => setWidgetTag(widget.id, widget.tag === t ? undefined : t)}
                    >
                      {t}
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="flex items-center gap-1">
                <button
                  class="press tap min-w-0 flex-1 rounded-lg bg-surface-2 text-sm"
                  onclick={() =>
                    updateWidget(widget.id, { size: widget.size === 'wide' ? 'small' : 'wide' })}
                >
                  {widget.size === 'wide' ? 'Narrow' : 'Wide'}
                </button>
                <button class="press tap-h w-11 shrink-0 rounded-lg bg-surface-2" onclick={() => moveWidget(widget.id, -1)}
                  aria-label="Move up">↑</button>
                <button class="press tap-h w-11 shrink-0 rounded-lg bg-surface-2" onclick={() => moveWidget(widget.id, 1)}
                  aria-label="Move down">↓</button>
                <button class="press tap-h w-11 shrink-0 rounded-lg text-ink-400" onclick={() => removeWidget(widget.id)}
                  aria-label="Remove">✕</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if adding}
    <div class="card mt-3 p-2">
      {#each WIDGET_KINDS as k (k.kind)}
        <button class="press list-row w-full text-left" onclick={() => add(k.kind)}>
          <span class="flex-1">
            <span class="block">{k.label}</span>
            <span class="footnote">{k.hint}</span>
          </span>
          <span class="text-ink-400">+</span>
        </button>
      {/each}
      <button class="press tap mt-1 w-full text-sm text-ink-400" onclick={() => (adding = false)}>
        Cancel
      </button>
    </div>
  {:else}
    <div class="mt-3 flex gap-2">
      <button
        class="press tap flex-1 rounded-xl border border-dashed border-line-2 text-sm text-ink-400"
        onclick={() => (adding = true)}
      >
        + Add a block
      </button>
      {#if list.length}
        <button
          class="press tap rounded-xl px-4 text-sm {editing ? 'text-accent' : 'text-ink-400'}"
          onclick={() => (editing = !editing)}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      {/if}
    </div>
  {/if}
</section>

{#if viewing}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!--
    A photo, as large as the screen allows.

    object-contain and not cover: this is nearly always a schematic, a parts
    diagram or a whiteboard, and cropping the edges off one to fill a phone
    would cut away the part being looked at. Pinch-zoom still works on top of
    it, which is why the field-size floor in app.css matters — nothing here
    should trigger the OS zoom by accident.
  -->
  <div
    class="glass-strong rise fixed inset-0 z-50 flex flex-col"
    onclick={() => (viewing = null)}
  >
    <div class="flex items-center justify-between gap-3 px-4 pt-safe">
      <p class="section-label truncate py-3">{viewing.title || 'Photo'}</p>
      <button
        class="press tap-h px-2 text-[22px] leading-none text-ink-400"
        onclick={() => (viewing = null)}
        aria-label="Close">×</button
      >
    </div>
    <div class="flex min-h-0 flex-1 items-center justify-center p-3 pb-safe">
      <img src={viewing.image} alt={viewing.title ?? 'Photo'} class="max-h-full max-w-full object-contain" />
    </div>
  </div>
{/if}

{#if recording}
  <MemoRecorder {projectId} {section} onDone={() => (recording = false)} />
{/if}
