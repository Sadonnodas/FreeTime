<script lang="ts">
  /**
   * Fixing the name of something already written down.
   *
   * Everything in this app is captured in one field at speed, which is the
   * whole point of it — and the cost of typing fast is typos, half-thoughts and
   * names that turn out to be wrong an hour later. Until now the name was the
   * one thing that set permanently on Add: you could change a to-do's era, its
   * project, its size, its date and what it waits for, but not what it says.
   *
   * `value` rather than `bind:`, because the row underneath is a live query —
   * binding would let a sync landing mid-edit fight the cursor. It saves on
   * blur and on Enter, which is what onchange means for a text input.
   */
  let {
    value,
    label = 'Name',
    onrename
  }: { value: string; label?: string; onrename: (name: string) => void } = $props();

  function commit(e: Event & { currentTarget: HTMLInputElement }) {
    const next = e.currentTarget.value.trim();
    // An empty name is refused, not saved. A row with no text is a row you
    // cannot read, cannot tap open and therefore cannot rename back.
    if (!next) e.currentTarget.value = value;
    else if (next !== value) onrename(next);
  }
</script>

<input
  class="field w-full"
  aria-label={label}
  {value}
  onchange={commit}
  onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
/>
