import type { SyncState } from './sync';

/**
 * What Today says about syncing, if anything.
 *
 * Asked for plainly: *"when I open the app it takes a while for everything to
 * sync up and sometimes I think it didn't sync all the way or don't know when
 * it is done syncing."* Settings has said this for months, which is the wrong
 * place — by the time you have gone looking, the thing you wanted to know has
 * already happened.
 *
 * **SILENT IS THE DEFAULT, and most of this file is about what NOT to say.**
 * Today is the screen that has to stay calm, and a sync runs ten seconds after
 * every single edit — a line that spoke each time would blink away under the
 * title all evening, which is a nag by any other name.
 *
 * So: nothing at all when there is nothing to report, and the component that
 * uses this only asks once a sync has gone on long enough to be a WAIT. No
 * wait, no words.
 */
export function syncWords(state: SyncState): string | null {
  switch (state.status) {
    case 'syncing':
      return 'Syncing…';

    /*
     * An error SPEAKS, and keeps speaking until a sync succeeds. This is the
     * half he actually asked for — "sometimes I think it didn't sync all the
     * way" — and a failure that clears itself after a few seconds would leave
     * exactly that doubt, which is the update notice's lesson: a staleness
     * warning that dismisses itself is no use.
     *
     * It is a statement and not an alarm. Nothing is lost when a sync fails:
     * the app is local-first, everything is already written here, and it tries
     * again by itself.
     */
    case 'error':
      return 'Sync did not finish. It will try again.';

    /*
     * PAUSED SAYS NOTHING HERE, and that is deliberate for both halves of it.
     * Having no token is the ReconnectNotice's job, which already says it on
     * every screen and offers the way back — two voices for one problem is
     * worse than one. And being offline is not an event in an app that works
     * offline by design: a permanent line on the calmest screen for the whole
     * of a train journey would be furniture that means "normal".
     */
    case 'paused':
      return null;

    case 'idle':
      return null;
  }
}

/** Said once, when a sync that was announced has finished — the answer to
 *  "don't know when it is done". Transient: the state is the absence of it. */
export const DONE_WORDS = 'Synced.';
