<script lang="ts">
  import { onMount } from 'svelte';
  import { todaysEvents, type CalendarEvent } from '$lib/google/calendar';

  /**
   * Today's events, read-only, no interaction (spec 4.1).
   *
   * Hidden entirely when there is nothing to show — not connected, offline, or
   * a genuinely empty day. An empty strip would be a permanent reminder that a
   * feature exists, which is noise on the one screen that has to stay calm.
   */
  let events = $state<CalendarEvent[]>([]);

  onMount(async () => {
    events = await todaysEvents();
  });
</script>

{#if events.length}
  <section class="rise mb-5 flex gap-2 overflow-x-auto pb-1">
    {#each events as event (event.id)}
      <!-- Not a button, not a link. There is nothing to do with these. -->
      <div class="card-flat shrink-0 px-3.5 py-2.5">
        <p class="text-[11px] font-medium text-accent">{event.allDay ? 'All day' : event.time}</p>
        <p class="mt-0.5 max-w-[12rem] truncate text-[15px]">{event.summary}</p>
      </div>
    {/each}
  </section>
{/if}
