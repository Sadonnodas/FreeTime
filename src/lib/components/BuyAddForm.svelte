<script lang="ts">
  import { createBuyItem } from '$lib/store';
  import { setOnList } from '$lib/shoppingList';
  import { parsePrice } from '$lib/clip';
  import type { Project } from '$lib/types';
  import PhotoPicker from './PhotoPicker.svelte';
  import ProjectSelect from './ProjectSelect.svelte';

  /**
   * Adding a to-buy, with everything about it in the same go.
   *
   * *"When I add to-buys, I would like to be able to add the quantity, web
   * link and price in the same thing. Not adding the thing first and having to
   * click it open and add the rest there."* The name is still the only thing
   * needed and Enter still adds it — one field, no required fields (spec
   * principle 1) — but once there is a name, Qty, Price each, Link and Photo
   * appear underneath, the same way a to-do's sizes do.
   *
   * One form for Brain → Buy, a project's To buy and the shopping list, so the
   * three cannot drift into asking different things. Where it goes is the
   * caller's: a fixed era/project, or (`pickPlace`) a picker of its own.
   */
  let {
    placeholder = 'Something to buy',
    projectId,
    tag,
    pickPlace,
    onList = false,
    focus = false
  }: {
    placeholder?: string;
    /** Where it is filed, when the screen already says. */
    projectId?: string;
    tag?: string;
    /** Offer an era + project picker instead (the shopping list). */
    pickPlace?: Project[];
    /** Put it straight on the shopping list. */
    onList?: boolean;
    focus?: boolean;
  } = $props();

  let name = $state('');
  let qty = $state('');
  let price = $state('');
  let link = $state('');
  let image = $state<string | undefined>(undefined);
  let era = $state('');
  let project = $state('');

  const normaliseUrl = (raw: string) => {
    const t = raw.trim();
    if (!t) return undefined;
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const n = Number.parseInt(qty.replace(/\D/g, ''), 10);
    const id = await createBuyItem(trimmed, {
      qty: Number.isFinite(n) && n > 1 ? n : undefined,
      priceCents: parsePrice(price),
      url: normaliseUrl(link),
      image,
      projectId: pickPlace ? era || undefined : projectId,
      tag: pickPlace ? project || undefined : tag
    });
    if (onList) await setOnList(id, true);
    // The details were about THIS thing; the place stays for the next one.
    name = qty = price = link = '';
    image = undefined;
  }
</script>

<form onsubmit={add} class="mb-3">
  <div class="flex gap-2">
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={name} {placeholder} autofocus={focus} class="field min-w-0 flex-1" aria-label="What to buy" />
    <button class="btn btn-primary press" disabled={!name.trim()}>Add</button>
  </div>

  {#if name.trim()}
    <div class="card mt-2 space-y-2 p-3">
      <div class="flex gap-2">
        <input bind:value={qty} inputmode="numeric" placeholder="Qty" class="field w-20 shrink-0 text-sm" aria-label="Quantity" />
        <input bind:value={price} inputmode="decimal" placeholder="Price each" class="field min-w-0 flex-1 text-sm" aria-label="Price each" />
      </div>
      <input
        bind:value={link}
        type="text"
        inputmode="url"
        autocapitalize="off"
        placeholder="Where from — a link"
        class="field w-full text-sm"
        aria-label="Link"
      />
      {#if pickPlace}
        <div class="flex gap-2">
          <select bind:value={era} class="field press min-w-0 flex-1 text-sm" aria-label="Era">
            <option value="">No era</option>
            {#each pickPlace as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
          <div class="min-w-0 flex-1">
            <ProjectSelect
              eras={pickPlace}
              eraId={era || undefined}
              tag={project || undefined}
              noneLabel="Project"
              onpick={(id, t) => {
                era = id ?? '';
                project = t ?? '';
              }}
            />
          </div>
        </div>
      {/if}
      <PhotoPicker {image} onpick={(i) => (image = i)} onremove={() => (image = undefined)} />
      {#if image}<img src={image} alt="" class="h-20 rounded-lg object-cover" />{/if}
    </div>
  {/if}
</form>
