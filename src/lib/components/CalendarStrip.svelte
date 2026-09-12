<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { todaysEvents, type CalendarEvent } from '$lib/google/calendar';
  import Collapsible from './Collapsible.svelte';

  /**
   * Today's events, read-only, no interaction (spec 4.1).
   *
   * Hidden entirely when there is nothing to show — not connected, offline, or
   * a genuinely empty day. An empty strip would be a permanent reminder that a
   * feature exists, which is noise on the one screen that has to stay calm.
   *
   * IT FOLDS, and the count is what makes that safe. Asked for as decluttering
   * — *"I would like to be able to fold it in so it's not always visible"* —
   * and a day with three meetings on it must not become a day that looks
   * empty, so the header keeps saying how many there are. Same Collapsible,
   * same remembered-per-device localStorage as a project's sections: whether
   * you keep your calendar folded is a fact about this phone, not something to
   * push at your laptop.
   *
   * It looks again when the app comes back to the front. Without that, an
   * installed app on a phone is suspended rather than closed, so the list it
   * drew on Monday is the list you are still reading on Wednesday — and adding
   * something in Google and switching back looks like the feature is broken.
   * Same safe moment the update check uses, and the same reasoning.
   */
  let events = $state<CalendarEvent[]>([]);

  async function load(force = false) {
    events = await todaysEvents(force);
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void load(true);
  }

  onMount(() => {
    void load();
    document.addEventListener('visibilitychange', onVisible);
  });
  onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
</script>

{#if events.length}
  <!-- The heading is in here rather than on the page, because this component is
       the only thing that knows whether there is anything to put under it, and
       a heading over an empty space is worse than no heading at all. -->
  <Collapsible id="today/calendar" title="Calendar" count={events.length}>
    <section class="rise -mt-1 mb-2 flex gap-2 overflow-x-auto pb-1">
      {#each events as event (event.id)}
        <!-- Not a button, not a link. There is nothing to do with these. -->
        <div class="card-flat shrink-0 px-3.5 py-2.5">
          <p class="text-[11px] font-medium text-accent">{event.allDay ? 'All day' : event.time}</p>
          <p class="mt-0.5 max-w-[12rem] truncate text-[15px]">{event.summary}</p>
          {#if event.calendar}
            <!-- Which calendar it came from, in that calendar's own colour, so a
                 band night and a client meeting are told apart at a glance the
                 same way they are in Google. Left off for the primary calendar,
                 where naming it on every card says nothing. -->
            <p class="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
              <span
                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style="background: {event.color ?? 'currentColor'}"
              ></span>
              <span class="max-w-[10.5rem] truncate">{event.calendar}</span>
            </p>
          {/if}
        </div>
      {/each}
    </section>
  </Collapsible>
{/if}
