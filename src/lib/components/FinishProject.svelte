<script lang="ts">
  import { onMount } from 'svelte';
  import { setProjectTagFinished } from '$lib/store';
  import { projectRecap, type ProjectRecap } from '$lib/queries';
  import Burst from './Burst.svelte';

  /**
   * Finishing a project — the moment, not just the flag.
   *
   * "I would be satisfied if I could check that whole project off." A tick box
   * would do that technically and miss the point, which is the satisfaction. So
   * it is two beats. First, what the project came to: when it started, how much
   * got done, what was bought and recorded. Looking back over that IS most of
   * the satisfaction, and it is also the confirmation — you see what you are
   * calling done before you call it. Then the tick, and a celebration sized for
   * a closet rather than for a to-do.
   *
   * Counts, never a proportion: "14 to-dos done", never "14 of 17". Anything
   * still open is mentioned once, plainly, with what will happen to it — it
   * stays exactly as it is and Free Time stops suggesting it — because finishing
   * with loose ends is normal and the app ticking them for you would be a lie in
   * the wins feed.
   */
  let {
    eraId,
    tag,
    color,
    onclose
  }: { eraId: string; tag: string; color: string; onclose: () => void } = $props();

  let recap = $state<ProjectRecap | null>(null);
  let done = $state(false);

  onMount(async () => {
    recap = await projectRecap(eraId, tag);
  });

  const since = $derived(
    recap?.startedAt
      ? new Date(recap.startedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : null
  );

  const lines = $derived(
    recap
      ? [
          recap.done ? `${recap.done} ${recap.done === 1 ? 'to-do' : 'to-dos'} done` : null,
          recap.bought ? `${recap.bought} ${recap.bought === 1 ? 'thing' : 'things'} bought` : null,
          recap.recorded
            ? `${recap.recorded} ${recap.recorded === 1 ? 'recording' : 'recordings'}`
            : null,
          recap.ideas ? `${recap.ideas} ${recap.ideas === 1 ? 'idea' : 'ideas'}` : null
        ].filter((x): x is string => !!x)
      : []
  );

  async function finish() {
    // Before the write, like a to-do's tick: a celebration that waits on the
    // database reads as a glitch. The burst plays as it mounts.
    done = true;
    await setProjectTagFinished(eraId, tag, true);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="glass-strong rise fixed inset-0 z-50 flex flex-col justify-end p-4 pb-safe" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="card relative mx-auto w-full max-w-[520px] overflow-visible p-6 text-center"
    style="border-top: 4px solid {color}"
    onclick={(e) => e.stopPropagation()}
  >
    {#if done}
      <!-- A bigger burst than a to-do gets, centred on the words. -->
      <div class="pointer-events-none absolute top-10 left-1/2 -translate-x-1/2">
        <Burst size={260} />
      </div>
      <p class="section-label">Finished</p>
      <h2 class="mt-2 text-[30px] leading-tight font-bold tracking-[-0.02em]">{tag}</h2>
      <p class="mt-3 text-[17px] text-ink-200">Done. That one is yours.</p>
      {#if lines.length || since}
        <p class="footnote mt-2">
          {[since ? `Since ${since}` : null, ...lines].filter(Boolean).join(' · ')}
        </p>
      {/if}
      <button class="btn btn-primary press mt-6 w-full py-4 text-[17px]" onclick={onclose}>
        Good
      </button>
    {:else}
      <p class="section-label">Finish this project?</p>
      <h2 class="mt-2 text-[28px] leading-tight font-bold tracking-[-0.02em]">{tag}</h2>

      {#if !recap}
        <p class="footnote mt-4">Looking back over it…</p>
      {:else}
        {#if since}<p class="mt-3 text-ink-200">Started in {since}.</p>{/if}
        {#if lines.length}
          <ul class="mt-4 space-y-1">
            {#each lines as line (line)}<li class="text-[17px]">{line}</li>{/each}
          </ul>
        {/if}
        {#if recap.open}
          <!-- Said once, with what happens, and nothing more. Finishing with a
               loose end or two is how projects actually end. -->
          <p class="footnote mt-4">
            {#if recap.open === 1}
              1 to-do is still open. It stays as it is, and Free Time stops suggesting it.
            {:else}
              {recap.open} to-dos are still open. They stay as they are, and Free Time stops
              suggesting them.
            {/if}
          </p>
        {/if}
      {/if}

      <button class="btn btn-primary press mt-6 w-full py-4 text-[17px]" disabled={!recap} onclick={finish}>
        Mark it finished
      </button>
      <button class="press tap mt-1 w-full text-sm text-ink-400" onclick={onclose}>Not yet</button>
    {/if}
  </div>
</div>
