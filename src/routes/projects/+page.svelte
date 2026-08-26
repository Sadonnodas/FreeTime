<script lang="ts">
  import { liveQuery } from 'dexie';
  import { projectPulses, type ProjectPulse } from '$lib/queries';
  import { createProject } from '$lib/store';

  const pulsesQ = liveQuery(() => projectPulses());

  let adding = $state(false);
  let name = $state('');

  // A new project is one tap and one field (spec principle 4). No template, no
  // description, no icon picker — the old workspace generated 443 boilerplate
  // files for 124 real records precisely because creation demanded structure.
  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createProject(name);
    name = '';
    adding = false;
  }

  function ago(iso?: string): string {
    if (!iso) return 'not yet';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 60) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }
</script>

<div class="px-4 pt-safe pb-8">
  <header class="flex items-center justify-between py-4">
    <h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
    <button
      class="tap rounded-xl bg-ink-800 px-4 text-ink-200"
      onclick={() => (adding = !adding)}
    >
      {adding ? 'Cancel' : '+ New'}
    </button>
  </header>

  {#if adding}
    <form onsubmit={add} class="mb-4 flex gap-2">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={name}
        autofocus
        placeholder="Project name"
        class="tap flex-1 rounded-xl border border-ink-700 bg-ink-800 px-4 outline-none
               focus:border-accent"
      />
      <button class="tap rounded-xl bg-accent px-5 font-medium text-ink-950">Add</button>
    </form>
  {/if}

  <!-- No progress bars anywhere. Cards show pulse: last touched, recent
       closes, open count. A quiet project looks quiet, not failing. -->
  <div class="grid grid-cols-2 gap-3">
    {#each ($pulsesQ as ProjectPulse[] | undefined) ?? [] as p (p.project.id)}
      <a
        href="/projects/{p.project.id}"
        class="rounded-2xl border border-ink-700 bg-ink-900 p-4"
      >
        <h2 class="truncate font-medium">{p.project.name}</h2>
        <dl class="mt-3 space-y-0.5 text-xs text-ink-400">
          <div class="flex justify-between"><dt>Touched</dt><dd>{ago(p.lastTouchedAt)}</dd></div>
          <div class="flex justify-between"><dt>Closed 30d</dt><dd>{p.closedLast30}</dd></div>
          <div class="flex justify-between"><dt>Open</dt><dd>{p.openCount}</dd></div>
        </dl>
      </a>
    {/each}
  </div>
</div>
