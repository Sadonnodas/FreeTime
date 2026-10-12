<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { onSyncState, type SyncState } from '$lib/sync';
  import { syncWords, DONE_WORDS } from '$lib/syncWords';

  /**
   * Today's subtitle, which becomes the sync line while there is one.
   *
   * **IT TAKES THE LINE THAT IS ALREADY THERE** rather than adding one. Today
   * is the screen whose hero was shrunk once already to keep the habits above
   * the fold, and a status line that appears and disappears would push the
   * page around every time a sync ran. This way the words change and nothing
   * moves.
   *
   * WHEN IT SPEAKS, and it is mostly about when it does not:
   *
   * - A sync that is over in a blink says NOTHING. One runs ten seconds after
   *   every edit, so announcing them all would blink under the title all
   *   evening — the complaint was about a WAIT, so a wait is what it reports.
   * - Once it has said "Syncing…", it always says how that ended. The actual
   *   question was *"don't know when it is done syncing"*, and an indicator
   *   that just vanishes answers it with "something happened".
   * - A failure stays up until a sync works, because that one has to be read.
   * - Everything else is silence. See syncWords.ts.
   */
  let { children }: { children: Snippet } = $props();

  /** Long enough that a quick background sync passes in silence, short enough
   *  that a real wait is explained before it is noticed. */
  const SPEAK_AFTER_MS = 400;
  const DONE_FOR_MS = 2500;

  // NOT named `state`: that shadows the `$state` rune for TypeScript, which
  // then reads the declaration as referring to itself.
  let sync = $state<SyncState>({ status: 'idle' });
  /** Set once a sync has gone on long enough to be worth mentioning, so the
   *  confirmation is only given for a wait that was actually announced. */
  let announced = $state(false);
  let done = $state(false);

  let speakTimer: ReturnType<typeof setTimeout> | undefined;
  let doneTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() =>
    onSyncState((next) => {
      const was = sync.status;
      sync = next;

      if (next.status === 'syncing') {
        clearTimeout(doneTimer);
        done = false;
        clearTimeout(speakTimer);
        speakTimer = setTimeout(() => (announced = true), SPEAK_AFTER_MS);
        return;
      }

      clearTimeout(speakTimer);
      if (was === 'syncing' && announced && next.status === 'idle') {
        done = true;
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => (done = false), DONE_FOR_MS);
      }
      announced = false;
    })
  );

  const line = $derived(
    done ? DONE_WORDS : sync.status === 'syncing' && !announced ? null : syncWords(sync)
  );
</script>

<!-- polite, so a screen reader mentions it between sentences rather than
     interrupting whatever it was reading. -->
<p class="footnote mt-1" aria-live="polite">
  {#if line}
    <span class="text-ink-200">{line}</span>
  {:else}
    {@render children()}
  {/if}
</p>
