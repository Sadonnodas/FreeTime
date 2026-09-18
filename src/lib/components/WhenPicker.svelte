<script lang="ts">
  import { today } from '$lib/store';
  import { tomorrow, dayLabel } from '$lib/days';

  /**
   * A to-do's day: Someday, Today, Tomorrow, or another day.
   *
   * The other day used to be a bare `<input type="date">`, and an EMPTY one on
   * an iPhone draws as a blank grey bar with nothing in it — wider than its
   * box, too, since iOS gives date fields a minimum width of their own.
   * Reported from the add form as *"it's just an empty bar that extends past
   * the add box."* So it is a chip like the other three: "📅 Pick a day" until
   * a day is picked, then that day's name. The real date field is laid over
   * the chip, invisible, so tapping the chip is tapping the field and iOS
   * opens its own wheel; `showPicker()` does the same where a click on a
   * field's body would not (desktop Chrome).
   *
   * One component for the add form and the row editor, so they cannot drift.
   */
  let {
    value,
    onpick
  }: { value?: string; onpick: (date: string | undefined) => void } = $props();

  const todayIso = today();
  const tomorrowIso = tomorrow(todayIso);
  const other = $derived(!!value && value !== todayIso && value !== tomorrowIso);
</script>

<div class="flex flex-wrap items-center gap-2">
  <button type="button" class="chip press {value ? '' : 'chip-on'}" onclick={() => onpick(undefined)}>
    Someday
  </button>
  <button type="button" class="chip press {value === todayIso ? 'chip-on' : ''}" onclick={() => onpick(todayIso)}>
    Today
  </button>
  <button
    type="button"
    class="chip press {value === tomorrowIso ? 'chip-on' : ''}"
    onclick={() => onpick(tomorrowIso)}
  >
    Tomorrow
  </button>
  <label class="chip press relative overflow-hidden {other ? 'chip-on' : ''}">
    📅 {other ? dayLabel(value!, todayIso) : 'Pick a day'}
    <input
      type="date"
      value={value ?? ''}
      class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      aria-label="Pick a day"
      onclick={(e) => {
        try {
          e.currentTarget.showPicker?.();
        } catch {
          // Refused outside a user gesture in some browsers; the tap still
          // lands on the field itself, which is what iOS uses anyway.
        }
      }}
      onchange={(e) => onpick(e.currentTarget.value || undefined)}
    />
  </label>
</div>
