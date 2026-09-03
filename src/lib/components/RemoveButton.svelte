<script lang="ts">
  /**
   * A delete that takes two taps and says what it will delete.
   *
   * ARMED RATHER THAN A DIALOG. A confirm dialog for one row is heavier than
   * the mistake it prevents, and a bare ✕ is how someone ends up asking how a
   * thing is supposed to be removed at all. The label changes to the question,
   * and disarms itself after a few seconds so a stray tap cannot sit there
   * waiting to go off.
   *
   * THIS IS NOT "CLEAR COMPLETED". Everything here is soft-deleted one row at a
   * time, by hand, because someone decided that row should not exist. Finished
   * work is still never deleted and never hidden by the app itself — the wins
   * feed depends on it, and the rule against tidying it away stands.
   */
  let {
    label = 'Remove',
    confirm = 'Really remove?',
    onremove,
    full = false
  }: {
    label?: string;
    confirm?: string;
    onremove: () => void;
    /** Full width, for the end of an expanded panel. */
    full?: boolean;
  } = $props();

  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function tap() {
    if (armed) {
      clearTimeout(timer);
      armed = false;
      onremove();
      return;
    }
    armed = true;
    timer = setTimeout(() => (armed = false), 4000);
  }
</script>

<button
  type="button"
  class="press tap-h rounded-lg px-3 text-sm {full ? 'w-full' : ''} {armed
    ? 'bg-surface-2 text-accent-2'
    : 'text-ink-400'}"
  onclick={tap}
>
  {armed ? confirm : label}
</button>
