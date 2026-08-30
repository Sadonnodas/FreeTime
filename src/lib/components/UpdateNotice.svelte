<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    onUpdateStatus, consumeJustUpdated, checkAndApply, buildLabel, type UpdateStatus
  } from '$lib/pwa';

  /**
   * Telling you which version you are on, when it matters.
   *
   * This reverses an earlier decision. The app used to update itself in total
   * silence, on the grounds that an "update available" prompt is a nag — but
   * silence has its own failure: you cannot tell a working app from one quietly
   * running last month's code, and the worry that you might be is worse than a
   * line of text.
   *
   * It stays out of nag territory by never asking for anything. Two states, and
   * both are statements rather than requests:
   *
   *  - "Updated" — it already happened at launch, nothing to do, gone in a few
   *    seconds. This is the common case, because a build found at startup is
   *    installed there and then.
   *  - "A newer version is ready" — found mid-session, where reloading would
   *    throw away whatever is half-typed. It waits for a tap.
   *
   * The second one has no dismiss, deliberately. It first shipped with an ×,
   * which contradicted the entire reason it exists: dismissing set a flag for
   * the rest of the session, so the one person who had said out loud that he
   * did not want to work on a stale version could hide the only thing telling
   * him he was. Tapping Update is how it goes away.
   */
  let status = $state<UpdateStatus>('idle');
  const stop = onUpdateStatus((s) => (status = s));
  onDestroy(stop);

  let justUpdated = $state(false);

  // Read once at construction, then hidden again after a few seconds: the
  // confirmation is good news, and good news does not need to sit there.
  if (consumeJustUpdated()) {
    justUpdated = true;
    setTimeout(() => (justUpdated = false), 7000);
  }

  const ready = $derived(status === 'ready');
  const busy = $derived(status === 'updating');
</script>

{#if justUpdated}
  <div class="hairline-b flex items-center gap-2 px-4 py-2" style="background: var(--color-surface-1)">
    <span class="text-good">✓</span>
    <p class="footnote min-w-0 flex-1 truncate">
      Updated — built {buildLabel()}
    </p>
  </div>
{:else if ready || busy}
  <div
    class="hairline-b flex items-center gap-2 px-4 py-2"
    style="background: color-mix(in srgb, var(--color-accent) 12%, transparent)"
  >
    <p class="footnote min-w-0 flex-1 truncate text-accent">
      {busy ? 'Updating…' : 'A newer version is ready.'}
    </p>
    {#if !busy}
      <button class="press tap-h shrink-0 px-2 text-sm font-medium text-accent" onclick={checkAndApply}>
        Update
      </button>
    {/if}
  </div>
{/if}
