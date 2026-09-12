<script lang="ts">
  import { onDestroy } from 'svelte';
  import { onSyncState, type SyncState } from '$lib/sync';
  import { beginSignIn } from '$lib/google/auth';

  /**
   * Saying, once, that Drive sync has stopped — and offering the one tap that
   * starts it again.
   *
   * Asked for after the same thing happened repeatedly: *"I get logged out of
   * Google a lot. If I don't interact for a day it logs out."* Google's token
   * lasts an hour and there is no refresh token available to a site with no
   * backend (see auth.ts), so the app renews silently at safe moments. When
   * Google declines to renew quietly — which is Google's call, not a bug here
   * — the app is left holding nothing, and until now it said so only on the
   * Settings screen, which is the last place anyone looks when nothing appears
   * to be wrong. Work carried on saving locally and silently stopped leaving
   * the device.
   *
   * It shows for ONE state: connected before, no usable token now. Not while
   * offline (nothing is broken, the network is), not when signed out on
   * purpose (there is nothing to reconnect to), and not for a failed pass.
   *
   * No dismiss, for the same reason the update notice has none: a warning you
   * can wave away is one you will wave away, and then you are back to thinking
   * everything synced. Reconnecting is how it goes.
   */
  let state = $state<SyncState>({ status: 'idle' });
  onDestroy(onSyncState((s) => (state = s)));

  const stale = $derived(state.status === 'paused' && state.reason === 'no-token');
</script>

<!-- pt-safe, because this sits above the page content and every page applies
     its own. Without it the bar slides under the iPhone's clock. -->
{#if stale}
  <div
    class="hairline-b flex items-center gap-3 px-4 pt-safe pb-3"
    style="background: color-mix(in srgb, var(--color-accent) 14%, transparent)"
  >
    <div class="min-w-0 flex-1">
      <p class="text-[15px] font-medium text-accent">Google wants a fresh sign-in.</p>
      <!-- Says what is still true, because "sync has stopped" reads as "your
           work is at risk" and it is not: everything is on the device either
           way, and it goes up as soon as this is done. -->
      <p class="footnote">Everything is still saved here. Nothing has gone to Drive since.</p>
    </div>
    <button
      class="press tap-h shrink-0 rounded-xl bg-accent px-3 text-sm font-medium text-ink-950"
      onclick={() => beginSignIn(false)}
    >
      Reconnect
    </button>
  </div>
{/if}
