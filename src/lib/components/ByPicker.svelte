<script lang="ts">
  import WhenPicker from './WhenPicker.svelte';

  /**
   * A to-do's DEADLINE — the day it has to be done before.
   *
   * It is WhenPicker underneath, deliberately: the chips, the invisible date
   * field over the last one and the iOS workaround it exists for are all the
   * same job, and two copies of a date control is how the day field ended up
   * drawing as an empty grey bar in one place and a row of chips in another.
   * Only the words change — "No deadline" instead of "Someday".
   *
   * It is a component of its own rather than a prop on WhenPicker so that
   * screens.test.ts can see it: that test reads the route sources and asserts
   * every screen a to-do is written on offers every control, and it cannot
   * tell two WhenPickers apart. A deadline missing from one screen is the
   * exact failure that test was written after.
   *
   * No `future`: a deadline can be in the past. Writing down the inspection
   * you have already missed is a reasonable thing to do, and refusing the date
   * would only mean losing the fact.
   */
  let { value, onpick }: { value?: string; onpick: (by: string | undefined) => void } = $props();
</script>

<WhenPicker {value} {onpick} noneLabel="No deadline" />
