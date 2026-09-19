<script lang="ts">
  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import {
    createBuyItem, createIdea, createTodo, createQuickNote, appendToNote
  } from '$lib/store';
  import { setOnList } from '$lib/shoppingList';
  import { activeProjects } from '$lib/queries';
  import { parseClip, parsePrice, noteText, type Clip, type ClipKind } from '$lib/clip';
  import { resizeImage, THUMB_EDGE } from '$lib/images';
  import type { Project } from '$lib/types';
  import PhotoPicker from '$lib/components/PhotoPicker.svelte';
  import ProjectSelect from '$lib/components/ProjectSelect.svelte';
  import { autogrow } from '$lib/autogrow';

  /**
   * "Add to FreeTime" — where the Chrome extension, an iOS Shortcut or a
   * bookmark hands something over (clip.ts says why it is a hand-over).
   *
   * Everything arrives filled in and editable: what it is, its name, and for a
   * to-buy the price, link and photo. What the page cannot know is where it
   * belongs, so that is the one choice to make — remembered from last time on
   * this device, since clipping tends to come in runs for one project. Nothing
   * is written until Add. Opened with nothing handed over, it is simply a form.
   */

  const KINDS: { key: ClipKind; label: string }[] = [
    { key: 'buy', label: 'To-buy' },
    { key: 'idea', label: 'Idea' },
    { key: 'todo', label: 'To-do' },
    { key: 'note', label: 'Note' }
  ];

  const erasQ = liveQuery(() => activeProjects());
  const eras = $derived(($erasQ as Project[] | undefined) ?? []);

  let kind = $state<ClipKind>('buy');
  let title = $state('');
  let text = $state('');
  let link = $state('');
  let price = $state('');
  let qty = $state('');
  let currency = $state<string | undefined>(undefined);
  let image = $state<string | undefined>(undefined);
  let onList = $state(false);
  let era = $state('');
  let project = $state('');
  let handedOver = $state(false);
  let done = $state<{ what: string; where: string; path?: string } | null>(null);

  const PLACE_KEY = 'freetime.clip.place';

  onMount(async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
      if (saved?.era) {
        era = saved.era;
        project = saved.project ?? '';
      }
    } catch {
      // No memory of last time is fine: pick a place.
    }
    const clip = parseClip(location.hash);
    if (clip) await take(clip);
    // Read once. A reload must not offer the same thing again after it was
    // added, and the hash is not something to leave in the address bar.
    history.replaceState(history.state, '', location.pathname);
  });

  async function take(c: Clip) {
    handedOver = true;
    kind = c.kind;
    title = c.title;
    text = c.text ?? '';
    link = c.url ?? '';
    price = c.priceCents ? (c.priceCents / 100).toFixed(2) : '';
    currency = c.currency;
    // Made small again here, whatever the sender did: a photo rides inside
    // the synced file of its table, and THUMB_EDGE is the cap that keeps that
    // cheap (see Todo.image).
    if (c.image) {
      try {
        const blob = await (await fetch(c.image)).blob();
        image = await resizeImage(new File([blob], 'clip.jpg', { type: blob.type }), THUMB_EDGE);
      } catch {
        image = undefined;
      }
    }
  }

  const eraName = $derived(eras.find((e) => e.id === era)?.name ?? '');
  const where = $derived([eraName, project].filter(Boolean).join(' · '));
  const needsName = $derived(kind !== 'note');
  const ready = $derived(needsName ? !!title.trim() : !!(text.trim() || title.trim()));

  const normaliseUrl = (raw: string) => {
    const t = raw.trim();
    if (!t) return undefined;
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!ready) return;
    const projectId = era || undefined;
    const tag = project || undefined;
    const url = normaliseUrl(link);
    const name = title.trim();

    if (kind === 'buy') {
      const n = Number.parseInt(qty.replace(/\D/g, ''), 10);
      const id = await createBuyItem(name, {
        qty: Number.isFinite(n) && n > 1 ? n : undefined,
        priceCents: parsePrice(price),
        currency,
        url,
        image,
        projectId,
        tag
      });
      if (onList) await setOnList(id, true);
    } else if (kind === 'idea') {
      await createIdea(name, { projectId, tag, url });
    } else if (kind === 'todo') {
      await createTodo(name, { projectId, tag, url, image });
    } else {
      const clip: Clip = { kind: 'note', title: name, url, text: text.trim() || undefined };
      if (projectId) await appendToNote(projectId, noteText(clip), tag);
      // With nowhere chosen a note becomes a QUICK note — the place for things
      // that belong nowhere yet — written plainly, since quick notes are not
      // rendered as Markdown.
      else await createQuickNote([clip.text, name, url].filter(Boolean).join('\n\n'));
    }

    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({ era, project }));
    } catch {
      // Remembering the place is a convenience.
    }

    const label = KINDS.find((k) => k.key === kind)!.label;
    done = {
      what: kind === 'note' ? 'Note' : `${label}: ${name}`,
      where: projectId ? where : kind === 'note' ? 'Quick notes' : 'Brain, not filed yet',
      path: projectId
        ? project
          ? `/projects/${projectId}/${encodeURIComponent(project)}`
          : `/projects/${projectId}`
        : kind === 'buy'
          ? '/brain?section=buy'
          : kind === 'idea'
            ? '/brain?section=ideas'
            : kind === 'todo'
              ? '/brain?section=todos'
              : undefined
    };
  }

  function another() {
    done = null;
    title = text = link = price = qty = '';
    image = undefined;
    currency = undefined;
    handedOver = false;
  }

  const host = $derived.by(() => {
    try {
      return link ? new URL(normaliseUrl(link)!).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  });
</script>

<div class="px-4 pt-safe pb-24">
  <header class="pt-3 pb-4">
    <h1 class="large-title">Add to FreeTime</h1>
    <p class="footnote mt-1">
      {#if handedOver && host}From {host}. Check it, pick where it goes, and add.
      {:else}Anything from anywhere — or use the Chrome extension or a Shortcut to fill this in.{/if}
    </p>
  </header>

  {#if done}
    <div class="card p-5 text-center">
      <p class="text-[40px] leading-none">✓</p>
      <p class="mt-2 text-[17px] font-semibold break-words">{done.what}</p>
      <p class="footnote mt-1">Added to {done.where}.</p>
      <div class="mt-5 flex flex-col gap-2">
        {#if done.path}
          <button class="btn btn-primary press" onclick={() => goto(`${base}${done!.path}`)}>
            Open {done.where}
          </button>
        {/if}
        <button class="press tap rounded-xl text-sm text-accent" onclick={another}>Add something else</button>
      </div>
      <p class="footnote mt-4">You can close this tab — it is saved.</p>
    </div>
  {:else}
    <form onsubmit={add} class="space-y-4">
      <div class="segmented" role="radiogroup" aria-label="What it is">
        {#each KINDS as k (k.key)}
          <button
            type="button"
            class="press segment {kind === k.key ? 'segment-on' : ''}"
            role="radio"
            aria-checked={kind === k.key}
            onclick={() => (kind = k.key)}>{k.label}</button
          >
        {/each}
      </div>

      {#if kind === 'note'}
        <div>
          <p class="section-label mb-2">Text</p>
          <textarea
            bind:value={text}
            rows="6"
            placeholder="What to keep"
            class="field w-full text-[16px] leading-relaxed"
          ></textarea>
          <p class="footnote mt-1">Where it came from is added underneath.</p>
        </div>
      {/if}

      <div>
        <p class="section-label mb-2">{kind === 'note' ? 'From' : 'Name'}</p>
        <textarea
          bind:value={title}
          use:autogrow={{ value: title, max: 160 }}
          placeholder={kind === 'buy' ? 'What to buy' : kind === 'todo' ? 'What to do' : 'What it is'}
          class="field field-grow w-full"
        ></textarea>
      </div>

      {#if kind === 'buy'}
        <div class="flex gap-2">
          <input bind:value={qty} inputmode="numeric" placeholder="Qty" class="field w-20 shrink-0" aria-label="Quantity" />
          <input bind:value={price} inputmode="decimal" placeholder="Price each" class="field min-w-0 flex-1" aria-label="Price each" />
        </div>
      {/if}

      <input
        bind:value={link}
        type="text"
        inputmode="url"
        autocapitalize="off"
        placeholder="Link"
        class="field w-full"
        aria-label="Link"
      />

      {#if kind === 'buy' || kind === 'todo'}
        <div>
          <p class="section-label mb-2">Photo</p>
          <PhotoPicker {image} onpick={(i) => (image = i)} onremove={() => (image = undefined)} />
          {#if image}<img src={image} alt="" class="mt-2 h-28 rounded-lg object-contain" />{/if}
        </div>
      {/if}

      <div>
        <p class="section-label mb-2">Where it goes</p>
        <div class="flex gap-2">
          <select bind:value={era} onchange={() => (project = '')} class="field press min-w-0 flex-1 text-sm" aria-label="Era">
            <option value="">{kind === 'note' ? 'Quick notes' : 'Nowhere yet'}</option>
            {#each eras as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
          <div class="min-w-0 flex-1">
            <ProjectSelect
              {eras}
              eraId={era || undefined}
              tag={project || undefined}
              noneLabel={kind === 'note' ? "The era's own notes" : 'No project'}
              onpick={(id, t) => {
                era = id ?? '';
                project = t ?? '';
              }}
            />
          </div>
        </div>
      </div>

      {#if kind === 'buy'}
        <label class="press flex items-center gap-3 text-sm">
          <input type="checkbox" bind:checked={onList} class="h-5 w-5 accent-[var(--color-accent)]" />
          <span>Put it on the shopping list too</span>
        </label>
      {/if}

      <button class="btn btn-primary press w-full py-3.5 text-[17px]" disabled={!ready}>
        Add{where ? ` to ${where}` : ''}
      </button>
    </form>
  {/if}
</div>
