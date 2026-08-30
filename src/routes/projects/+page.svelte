<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from '$app/environment';
  import { projectPulses, type ProjectPulse } from '$lib/queries';
  import { createProject } from '$lib/store';
  import { base } from '$app/paths';

  const pulsesQ = liveQuery(() => projectPulses());

  let adding = $state(false);
  let name = $state('');

  // A new project is one tap and one field (spec principle 4). No template, no
  // description, no icon picker — the old workspace generated 443 boilerplate
  // files for 124 real records precisely because creation demanded structure.
  // The cover photo is set later, from inside the project, and never asked for.
  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createProject(name);
    name = '';
    adding = false;
  }

  /**
   * Three orders, all chosen by hand.
   *
   * "Quiet" is the one to be careful with. It is deliberately a sort you ask
   * for, not a state the app assigns: nothing is marked neglected, nothing
   * turns red, and the same tiles look identical in every order. Asking "what
   * have I not touched in a while?" is a fair question to put to your own
   * projects. Being told the answer unprompted is a nag, and the spec bans it.
   */
  type Order = 'recent' | 'quiet' | 'name';
  const ORDERS: { key: Order; label: string }[] = [
    { key: 'recent', label: 'Recent' },
    { key: 'quiet', label: 'Quiet first' },
    { key: 'name', label: 'A–Z' }
  ];

  const STORAGE_KEY = 'freetime.projectOrder';

  // Kept in localStorage rather than the database: it is a per-device viewing
  // preference, not data, and syncing it would make one phone reorder another.
  let order = $state<Order>(
    browser ? ((localStorage.getItem(STORAGE_KEY) as Order | null) ?? 'recent') : 'recent'
  );

  function setOrder(next: Order) {
    order = next;
    if (browser) localStorage.setItem(STORAGE_KEY, next);
  }

  const sorted = $derived.by(() => {
    const list = [...((($pulsesQ as ProjectPulse[] | undefined) ?? []))];
    if (order === 'name') return list.sort((a, b) => a.project.name.localeCompare(b.project.name));

    // Never touched sorts to the far end of whichever direction is being asked
    // for: last under Recent, first under Quiet.
    return list.sort((a, b) => {
      const at = a.lastTouchedAt ?? '';
      const bt = b.lastTouchedAt ?? '';
      return order === 'recent' ? bt.localeCompare(at) : at.localeCompare(bt);
    });
  });

  function ago(iso?: string): string {
    if (!iso) return 'nothing yet';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 60) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  /**
   * A project with no cover still gets a real tile rather than an empty box:
   * a colour derived from its own name, so it is stable forever and every
   * project looks different without anyone picking anything.
   */
  function hue(text: string): number {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  const initials = (text: string) =>
    text
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase();
</script>

<div class="px-4 pt-safe pb-8">
  <header class="flex items-end justify-between pt-3 pb-4">
    <h1 class="large-title">Projects</h1>
    <button class="press tap rounded-xl px-3 text-[15px] text-accent" onclick={() => (adding = !adding)}>
      {adding ? 'Cancel' : 'New'}
    </button>
  </header>

  {#if adding}
    <form onsubmit={add} class="mb-4 flex gap-2">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={name}
        autofocus
        placeholder="Project name"
        class="field min-w-0 flex-1"
      />
      <button class="btn btn-primary press">Add</button>
    </form>
  {/if}

  <div class="segmented mb-4">
    {#each ORDERS as o (o.key)}
      <button
        class="press segment {order === o.key ? 'segment-on' : ''}"
        onclick={() => setOrder(o.key)}
      >
        {o.label}
      </button>
    {/each}
  </div>

  <!--
    Pictures, not readouts. Recognising the Bearfeet logo or a photo of the
    actual campervan is faster than reading a word, and it makes the grid feel
    like somewhere you want to be rather than a status report.

    One quiet line of pulse survives underneath. Still no progress bars, no
    percentages, no counts styled as warnings — a quiet project looks quiet.
  -->
  <div class="grid grid-cols-2 gap-3">
    {#each sorted as p (p.project.id)}
      <a
        href="{base}/projects/{p.project.id}"
        class="press rise relative block aspect-square overflow-hidden rounded-[20px]
               border border-white/8 bg-ink-800"
      >
        {#if p.project.image}
          <img
            src={p.project.image}
            alt=""
            class="absolute inset-0 h-full w-full object-cover"
          />
        {:else}
          <div
            class="absolute inset-0 flex items-center justify-center"
            style="background:
              linear-gradient(150deg,
                hsl({hue(p.project.name)} 42% 26%),
                hsl({(hue(p.project.name) + 40) % 360} 38% 14%))"
          >
            <span class="text-[2.5rem] font-bold tracking-[-0.03em] text-white/22">
              {initials(p.project.name)}
            </span>
          </div>
        {/if}

        <!-- A scrim rather than a solid bar, so the photo still reads as a
             photo but the name is legible over anything. -->
        <div
          class="absolute inset-x-0 bottom-0 px-3 pt-10 pb-3"
          style="background: linear-gradient(to top, rgba(0,0,0,.82), rgba(0,0,0,.45) 45%, transparent)"
        >
          <h2 class="title-2 truncate text-white">{p.project.name}</h2>
          <p class="truncate text-[12px] text-white/55">{ago(p.lastTouchedAt)}</p>
        </div>
      </a>
    {/each}
  </div>
</div>
