<script lang="ts">
  import { onMount } from 'svelte';
  import { hasApiKey } from '$lib/gemini/client';
  import Assistant from './Assistant.svelte';

  /**
   * What is left of Today's capture row: a way into the assistant, and nothing
   * else.
   *
   * The row used to be a text field, a record button, an assistant button and
   * an Add — capture under five seconds, per spec principle 1, landing unfiled
   * in Ideas. It was the right design for a capture-first app and the wrong one
   * for how this app is actually used: *"I don't have the reflex to just add a
   * random thing and then assign it later... if I have a to-do for a project in
   * Family, I just go there and add it there."* A prominent field nobody types
   * into is furniture, and it was furniture on the one screen that has to stay
   * calm — the same screen whose hero was shrunk to stop it pushing habits off
   * the bottom.
   *
   * THE ASSISTANT IS THE ONE THING THAT STAYS, and it was named as the reason:
   * talking to it files things wherever they belong, which is the same instinct
   * as going to the project — it just does the walking. It is also the only
   * thing here that had nowhere else to live; the capture field's job is done
   * better by Brain, and the recorder is one tap away in Brain → Memos.
   *
   * Capture itself is NOT gone, which matters because principle 1 is a hard
   * rule: Brain takes a thought in one field with no required fields, exactly
   * as this did. What changed is which screen carries it.
   *
   * Hidden entirely without a key, like every other AI surface: a dead button
   * is worse than one that was never offered (spec 7.4). Today then simply has
   * nothing at the bottom, which is the decluttered state anyway.
   */
  let hasKey = $state(false);
  let open = $state(false);

  onMount(async () => {
    hasKey = await hasApiKey();
  });
</script>

{#if hasKey}
  <div class="glass hairline-t flex justify-end px-3 py-2">
    <button
      class="press tap-h flex items-center gap-2 rounded-xl bg-surface-2 px-3 text-sm text-ink-200"
      onclick={() => (open = true)}
    >
      <span class="text-accent">✦</span>
      Ask
    </button>
  </div>
{/if}

{#if open}
  <Assistant onDone={() => (open = false)} />
{/if}
