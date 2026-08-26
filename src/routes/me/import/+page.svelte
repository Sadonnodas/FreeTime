<script lang="ts">
  import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import { parseCsv } from '$lib/import/csv';
  import {
    guessMapping, toCandidates, isYearlessDate,
    type Mapping, type Target, type Candidate
  } from '$lib/import/notion';
  import {
    projectNamesIn, proposeDecisions, applyImport, importNote,
    type ProjectDecisions
  } from '$lib/import/apply';
  import { activeProjects } from '$lib/queries';

  /**
   * The one-time Notion importer (spec 9).
   *
   * Two things it deliberately does NOT do: import everything silently, and
   * decide the taxonomy for you. The spec's post-mortem is that the old system
   * held 443 files for 124 real records across two competing hierarchies, so
   * this makes you look at the backlog once and say what stays.
   */
  type Step = 'pick' | 'map' | 'triage' | 'done';
  let step = $state<Step>('pick');

  const projectsQ = liveQuery(() => activeProjects());

  let fileName = $state('');
  let headers = $state<string[]>([]);
  let rows = $state<Record<string, string>[]>([]);
  let target = $state<Target>('todo');
  let mapping = $state<Mapping>({});
  let decisions = $state<ProjectDecisions>({});
  let candidates = $state<Candidate[]>([]);
  let yearlessDates = $state(0);

  // Triage state
  let index = $state(0);
  let kept = $state<Candidate[]>([]);
  let result = $state({ written: 0, projectsCreated: [] as string[] });

  async function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    fileName = file.name;
    const text = await file.text();

    rows = parseCsv(text);
    headers = rows[0] ? Object.keys(rows[0]) : [];
    remap();
    step = 'map';
  }

  function remap() {
    mapping = guessMapping(headers, target, rows);
    refresh();
  }

  async function refresh() {
    candidates = toCandidates(rows, mapping);
    // Count what the date column would have contributed, so the explanation
    // below is a real number rather than a vague warning.
    yearlessDates = mapping.date
      ? rows.filter((r) => isYearlessDate(r[mapping.date!])).length
      : 0;
    decisions = await proposeDecisions(projectNamesIn(candidates));
  }

  function setDecision(name: string, raw: string) {
    decisions = {
      ...decisions,
      [name]:
        raw === 'drop'
          ? { kind: 'drop' }
          : raw === 'create'
            ? { kind: 'create' }
            : { kind: 'existing', projectId: raw }
    };
  }

  const decisionValue = (name: string) => {
    const d = decisions[name];
    if (!d || d.kind === 'drop') return 'drop';
    return d.kind === 'create' ? 'create' : d.projectId;
  };

  async function importAll() {
    result = await applyImport(candidates, target, decisions);
    step = 'done';
  }

  function startTriage() {
    index = 0;
    kept = [];
    step = 'triage';
  }

  function decide(keep: boolean) {
    const c = candidates[index];
    if (c && keep) kept = [...kept, c];
    if (index + 1 < candidates.length) index += 1;
    else void finishTriage();
  }

  async function finishTriage() {
    result = await applyImport(kept, target, decisions);
    step = 'done';
  }

  // ---- markdown note import (the setlist) ----
  let noteProjectId = $state('');
  let noteStatus = $state('');

  async function onMarkdown(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !noteProjectId) return;
    await importNote(noteProjectId, await file.text());
    noteStatus = `Added ${file.name} to the project's notes.`;
  }

  const FIELDS: { key: keyof Mapping; label: string; forTargets: Target[] }[] = [
    { key: 'title', label: 'Title', forTargets: ['todo', 'buy', 'idea', 'list_item'] },
    { key: 'project', label: 'Project', forTargets: ['todo', 'buy', 'idea'] },
    { key: 'energy', label: 'Energy', forTargets: ['todo'] },
    { key: 'date', label: 'Date', forTargets: ['todo'] },
    { key: 'done', label: 'Already done', forTargets: ['todo'] },
    { key: 'url', label: 'Link', forTargets: ['buy', 'list_item'] },
    { key: 'price', label: 'Price', forTargets: ['buy'] },
    { key: 'notes', label: 'Notes', forTargets: ['todo', 'buy'] }
  ];
</script>

<div class="px-4 pt-safe pb-8">
  <header class="py-4">
    <a href="{base}/me" class="text-sm text-ink-400">← Me</a>
    <h1 class="mt-1 text-2xl font-semibold tracking-tight">Import</h1>
  </header>

  {#if step === 'pick'}
    <p class="mb-4 text-sm text-ink-400">
      Pick one CSV from a Notion export. Nothing is written until you say so, and the file
      never leaves this device.
    </p>
    <label class="tap block rounded-2xl border border-dashed border-ink-700 p-6 text-center">
      <input type="file" accept=".csv,text/csv" class="hidden" onchange={onFile} />
      <span class="text-accent">Choose a CSV</span>
    </label>

    <section class="mt-8">
      <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
        Or a page as a project note
      </h2>
      <p class="mb-2 text-xs text-ink-400">
        Markdown, appended to that project's notes. Never overwrites what's there.
      </p>
      <select
        bind:value={noteProjectId}
        class="tap mb-2 w-full rounded-xl border border-ink-700 bg-ink-800 px-3 text-sm"
      >
        <option value="">Choose a project…</option>
        {#each $projectsQ ?? [] as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      {#if noteProjectId}
        <label class="tap block rounded-xl border border-dashed border-ink-700 p-4 text-center">
          <input type="file" accept=".md,.markdown,.txt" class="hidden" onchange={onMarkdown} />
          <span class="text-sm text-accent">Choose a .md file</span>
        </label>
      {/if}
      {#if noteStatus}<p class="mt-2 text-xs text-good">{noteStatus}</p>{/if}
    </section>
  {:else if step === 'map'}
    <p class="mb-1 text-sm">{fileName}</p>
    <p class="mb-4 text-xs text-ink-400">
      {rows.length} rows · {candidates.length} with a title
    </p>

    <section class="mb-6">
      <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Import as</h2>
      <div class="flex flex-wrap gap-2">
        {#each [['todo', 'To-dos'], ['buy', 'Buy'], ['idea', 'Ideas'], ['list_item', 'List items']] as const as [value, label]}
          <button
            class="tap rounded-xl border px-4 text-sm {target === value
              ? 'border-accent text-ink-50'
              : 'border-ink-700 text-ink-400'}"
            onclick={() => {
              target = value;
              remap();
            }}>{label}</button
          >
        {/each}
      </div>
    </section>

    <section class="mb-6">
      <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Columns</h2>
      <p class="mb-2 text-xs text-ink-400">
        Guessed from the headers and the values. Change anything that looks wrong.
      </p>
      <div class="space-y-2">
        {#each FIELDS.filter((f) => f.forTargets.includes(target)) as field (field.key)}
          <label class="flex items-center gap-2">
            <span class="w-28 shrink-0 text-sm text-ink-400">{field.label}</span>
            <select
              value={mapping[field.key] ?? ''}
              onchange={(e) => {
                mapping = { ...mapping, [field.key]: e.currentTarget.value || undefined };
                void refresh();
              }}
              class="tap min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-800 px-2 text-sm"
            >
              <option value="">— none —</option>
              {#each headers as h (h)}
                <option value={h}>{h}</option>
              {/each}
            </select>
          </label>
        {/each}
      </div>

      {#if yearlessDates > 0}
        <!-- A real and easily-missed problem in this export, so it is stated
             plainly rather than left as a silent drop. -->
        <p class="mt-3 rounded-xl bg-ink-800 p-3 text-xs text-ink-200">
          {yearlessDates} of these dates have no year — Notion writes “Feb 3”, not
          “Feb 3 2026”. They're being left off rather than guessed, because a wrong date
          becomes a real obligation here. Those to-dos come in undated, which just means
          they wait.
        </p>
      {/if}
    </section>

    {#if Object.keys(decisions).length}
      <section class="mb-6">
        <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
          Project names found
        </h2>
        <p class="mb-2 text-xs text-ink-400">
          Old workstreams become real projects only if you say so. Anything dropped just
          means the item comes in unassigned — which is fine.
        </p>
        <div class="space-y-2">
          {#each Object.keys(decisions) as name (name)}
            <label class="flex items-center gap-2">
              <span class="w-28 shrink-0 truncate text-sm">{name}</span>
              <select
                value={decisionValue(name)}
                onchange={(e) => setDecision(name, e.currentTarget.value)}
                class="tap min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-800 px-2 text-sm"
              >
                <option value="drop">Leave unassigned</option>
                <option value="create">Create project “{name}”</option>
                {#each $projectsQ ?? [] as p (p.id)}
                  <option value={p.id}>Use {p.name}</option>
                {/each}
              </select>
            </label>
          {/each}
        </div>
      </section>
    {/if}

    <div class="flex gap-2">
      <button
        class="tap flex-1 rounded-2xl bg-ink-800 py-4 text-ink-200"
        onclick={startTriage}
        disabled={!candidates.length}>Go through them</button
      >
      <button
        class="flex-1 rounded-2xl bg-accent py-4 font-medium text-ink-950 disabled:opacity-30"
        onclick={importAll}
        disabled={!candidates.length}>Import all {candidates.length}</button
      >
    </div>
    <p class="mt-2 text-center text-xs text-ink-400">
      Going through them one at a time is slower, and it's how the stale half gets left
      behind.
    </p>
  {:else if step === 'triage'}
    {@const c = candidates[index]}
    <p class="mb-3 text-xs text-ink-400">{index + 1} of {candidates.length} · kept {kept.length}</p>
    {#if c}
      <div class="mb-4 rounded-2xl border border-ink-700 bg-ink-900 p-4">
        <p class="text-lg leading-snug">{c.title}</p>
        {#if c.projectName || c.energy || c.done}
          <p class="mt-2 text-xs text-ink-400">
            {[c.projectName, c.energy, c.done ? 'already done' : null].filter(Boolean).join(' · ')}
          </p>
        {/if}
      </div>
      <div class="flex gap-2">
        <button class="tap flex-1 rounded-2xl bg-ink-800 py-4 text-ink-400" onclick={() => decide(false)}>
          Drop
        </button>
        <button
          class="flex-1 rounded-2xl bg-accent py-4 font-medium text-ink-950"
          onclick={() => decide(true)}>Keep</button
        >
      </div>
      <button
        class="tap mt-3 w-full text-center text-xs text-ink-400"
        onclick={finishTriage}>Stop here and import the {kept.length} kept</button
      >
    {/if}
  {:else}
    <div class="py-10 text-center">
      <p class="text-2xl font-semibold">{result.written} imported.</p>
      {#if result.projectsCreated.length}
        <p class="mt-2 text-sm text-ink-400">
          New projects: {result.projectsCreated.join(', ')}
        </p>
      {/if}
      <button
        class="tap mt-6 rounded-xl bg-ink-800 px-5 py-3 text-ink-200"
        onclick={() => {
          step = 'pick';
          fileName = '';
          rows = [];
          candidates = [];
        }}>Import another file</button
      >
    </div>
  {/if}
</div>
