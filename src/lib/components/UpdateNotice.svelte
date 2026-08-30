<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    onUpdateStatus, consumeJustUpdated, checkAndApply, buildLabel, type UpdateStatus
  } from '$lib/pwa';
  import Dino from './Dino.svelte';

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

<!--
  pt-safe is load-bearing, not decoration. This bar sits above the page content,
  and every page applies its own safe-area padding — so without it the bar slid
  underneath the iPhone's clock and battery, where it could be neither read nor
  tapped. Reported from an actual phone.
-->
{#if justUpdated}
  <div
    class="hairline-b flex items-center gap-2 px-4 pt-safe pb-2"
    style="background: var(--color-surface-1)"
  >
    <span class="text-good">✓</span>
    <p class="footnote min-w-0 flex-1">Updated — built {buildLabel()}</p>
  </div>
{:else if ready || busy}
  <div
    class="hairline-b flex items-center gap-3 px-4 pt-safe pb-3"
    style="background: color-mix(in srgb, var(--color-accent) 14%, transparent)"
  >
    <span class="shrink-0 text-accent"><Dino size={26} tone="mono" /></span>
    <p class="min-w-0 flex-1 text-[15px] font-medium text-accent">
      {busy ? 'Updating…' : 'A newer version is ready.'}
    </p>
    {#if !busy}
      <button
        class="btn btn-primary press shrink-0 px-4 text-sm"
        style="min-height: 38px"
        onclick={checkAndApply}
      >
        Update
      </button>
    {/if}
  </div>
{/if}
