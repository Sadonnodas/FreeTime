<script lang="ts">
  import { autogrow, oneLine } from '$lib/autogrow';
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

  function commit(e: Event & { currentTarget: HTMLTextAreaElement }) {
    const next = oneLine(e.currentTarget.value);
    // An empty name is refused, not saved. A row with no text is a row you
    // cannot read, cannot tap open and therefore cannot rename back.
    if (!next) e.currentTarget.value = value;
    else if (next !== value) onrename(next);
  }
</script>

<!-- A textarea that grows, so a long to-do can be read while it is edited.
     Enter still finishes (it blurs, which saves). See autogrow.ts. -->
<textarea
  class="field field-grow w-full"
  aria-label={label}
  {value}
  use:autogrow={{ value, onenter: () => (document.activeElement as HTMLElement | null)?.blur() }}
  enterkeyhint="done"
  onchange={commit}
></textarea>
