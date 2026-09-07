<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A "+ Add" button that becomes the field, with the list underneath it.
   *
   * WHY, in Toon's words: "it's not very clean to see the add bar above the
   * to do's that are already there". A text input parked permanently over a
   * list is a piece of furniture you read past on every visit, and it competes
   * with the thing you actually came to look at. A button is one quiet line.
   *
   * WHAT MUST NOT COME BACK. The field used to vanish by itself — it showed
   * only while the list was empty or while the add sheet had just chosen it, so
   * writing one to-do made it disappear with no control left behind and nothing
   * to say why. That is a different failure from this: here the button is
   * always there, the state is yours, and the field goes away only when you
   * close it.
   *
   * THE FAST PATH SURVIVES. Opening focuses the field, so the tap that opens it
   * is the tap that starts writing. Adding does NOT close it and re-focuses, so
   * five to-dos are still type-Enter-type-Enter and not five taps on a button.
   */
  let {
    label,
    placeholder,
    open = $bindable(false),
    onadd,
    extra
  }: {
    /** The closed button's text, after the "+". */
    label: string;
    placeholder: string;
    /** Bindable so a sheet elsewhere on the page can open it and put the cursor here. */
    open?: boolean;
    onadd: (text: string) => unknown;
    /** Anything that belongs under the field while writing — the size and date
     *  pickers. Given the current text, so it can stay out of the way until
     *  there is something to describe. */
    extra?: Snippet<[string]>;
  } = $props();

  let text = $state('');
  let field = $state<HTMLInputElement | undefined>();

  $effect(() => {
    if (open) field?.focus();
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const t = text.trim();
    // Enter on an empty field means "I am done", which is the same thing the
    // button says at that moment. One path, so the two cannot disagree.
    if (!t) {
      open = false;
      return;
    }
    text = '';
    await onadd(t);
    field?.focus();
  }
</script>

{#if open}
  <form onsubmit={submit} class="mb-2">
    <div class="flex gap-2">
      <input
        bind:this={field}
        bind:value={text}
        {placeholder}
        class="field min-w-0 flex-1"
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            text = '';
            open = false;
          }
        }}
      />
      <!--
        One button doing both jobs, rather than a disabled Add sitting next to a
        Close. With something typed it adds; with an empty field the only thing
        left to do is stop, so it says so.
      -->
      <button class="btn press {text.trim() ? 'btn-primary' : 'btn-secondary'}">
        {text.trim() ? 'Add' : 'Done'}
      </button>
    </div>

    {#if extra}{@render extra(text)}{/if}
  </form>
{:else}
  <!--
    Solid and quiet, NOT the dashed outline the project screen's "+ Add to
    <project>" uses. That one is the primary way in and covers every kind of
    thing; this is a shortcut to one of them, and two identical dashed boxes
    stacked at the top of a project read as the same button drawn twice.

    The text is accent-coloured for the opposite reason: muted grey on a faint
    grey ground sits directly above rows of the same shape, and reads as an
    empty to-do rather than as a control.
  -->
  <button
    class="press tap mb-2 w-full rounded-xl bg-surface-1 text-sm font-medium text-accent"
    onclick={() => (open = true)}
  >
    + {label}
  </button>
{/if}
