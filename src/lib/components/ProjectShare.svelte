<script lang="ts">
  import { liveQuery } from 'dexie';
  import { activityByProject, monthsAgoIso, type ProjectShare } from '$lib/queries';
  import { base } from '$app/paths';

  /**
   * Where the recorded work went, by project.
   *
   * This is the app's one deliberate exception to "no analytics", asked for and
   * argued through. It stays on the right side of the rule by describing rather
   * than measuring: it counts things that happened, against no target, so there
   * is nothing to be behind on. No percentages of a goal, no red, no "you
   * should".
   *
   * The donut is what was asked for; the ranked bars underneath are what make
   * it readable. Ten projects in a pie is a handful of unlabelled slivers, and
   * the sliver you actually came to look at — the quiet one — is the least
   * legible of the lot. The bars put it in words.
   */
  const PERIODS = [
    { months: 1, label: '30 days' },
    { months: 6, label: '6 months' },
    { months: 12, label: 'A year' }
  ];

  /** Six months by default: long enough that a quiet stretch means something,
   *  short enough that it is still about now. */
  let period = $state(6);

  const shareQ = $derived(liveQuery(() => activityByProject(monthsAgoIso(period))));
  const rows = $derived(($shareQ as ProjectShare[] | undefined) ?? []);
  const total = $derived(rows.reduce((sum, r) => sum + r.events, 0));
  const busiest = $derived(Math.max(1, ...rows.map((r) => r.events)));

  /** The same hue-from-name as the project tiles, so a colour means the same
   *  project everywhere in the app without anyone choosing one. */
  function hue(text: string): number {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  const colour = (name: string) => `hsl(${hue(name)} 62% 55%)`;

  const R = 56;
  const C = 2 * Math.PI * R;

  /** Arc offsets for the donut, walked round in order. */
  const arcs = $derived.by(() => {
    let at = 0;
    return rows
      .filter((r) => r.events > 0)
      .map((r) => {
        const length = (r.events / total) * C;
        const arc = { name: r.project.name, length, offset: at };
        at += length;
        return arc;
      });
  });

  const parts = (r: ProjectShare) =>
    [
      r.closed ? `${r.closed} closed` : null,
      r.recorded ? `${r.recorded} recorded` : null,
      r.bought ? `${r.bought} bought` : null,
      r.finished ? `${r.finished} finished` : null
    ]
      .filter(Boolean)
      .join(' · ');
</script>

<section class="mb-8">
  <h2 class="section-label mb-2">Where the work went</h2>

  <div class="segmented mb-3">
    {#each PERIODS as p (p.months)}
      <button
        class="press segment {period === p.months ? 'segment-on' : ''}"
        onclick={() => (period = p.months)}
      >
        {p.label}
      </button>
    {/each}
  </div>

  {#if total === 0}
    <div class="card p-5 text-center">
      <p class="footnote">
        Nothing recorded in this stretch yet. Close a to-do, buy something, record a
        memo — it fills itself in.
      </p>
    </div>
  {:else}
    <div class="card p-4">
      <div class="flex items-center gap-5">
        <svg viewBox="0 0 140 140" class="h-[124px] w-[124px] shrink-0" aria-hidden="true">
          <!-- Rotated so the first and largest slice starts at twelve o'clock,
               which is where the eye begins. -->
          <g transform="rotate(-90 70 70)">
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-surface-2)" stroke-width="20" />
            {#each arcs as arc (arc.name)}
              <circle
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={colour(arc.name)}
                stroke-width="20"
                stroke-dasharray="{arc.length} {C - arc.length}"
                stroke-dashoffset={-arc.offset}
              />
            {/each}
          </g>
        </svg>

        <div class="min-w-0 flex-1">
          <p class="text-[2rem] font-bold leading-none tracking-[-0.03em]">{total}</p>
          <p class="footnote mt-1">things, across {rows.filter((r) => r.events).length} projects</p>
        </div>
      </div>

      <!-- The readable half. Every project appears, including the ones at zero,
           because the empty row is the whole reason for looking. -->
      <ul class="mt-4 space-y-2">
        {#each rows as r (r.project.id)}
          <li>
            <a href="{base}/projects/{r.project.id}" class="press block">
              <div class="flex items-baseline gap-2">
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  style="background: {r.events ? colour(r.project.name) : 'var(--color-surface-3)'}"
                ></span>
                <span class="min-w-0 flex-1 truncate text-[15px]">{r.project.name}</span>
                <span class="footnote shrink-0 tabular-nums">
                  {r.events ? `${Math.round((r.events / total) * 100)}%` : '—'}
                </span>
              </div>
              <div class="mt-1 ml-[18px] h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  class="h-full rounded-full"
                  style="width: {(r.events / busiest) * 100}%; background: {colour(r.project.name)}"
                ></div>
              </div>
              {#if parts(r)}
                <p class="footnote mt-0.5 ml-[18px] truncate">{parts(r)}</p>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    </div>

    <!--
      Said plainly, because the chart cannot say it itself. A project whose value
      never took the shape of a to-do will always look thin here, and that is a
      fact about the recording rather than about the year.
    -->
    <p class="footnote mt-2">
      This only sees what got written down. An afternoon nobody made a to-do for
      does not appear, so the quietest slice may be the least recorded rather than
      the least lived.
    </p>
  {/if}
</section>
