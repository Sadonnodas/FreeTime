<script lang="ts">
  import { liveQuery } from 'dexie';
  import { activeProjects } from '$lib/queries';
  import type { Project, Energy, TimeBucket } from '$lib/types';
  import { proposalFields, withArgs, editableText, type ProposedWrite } from '$lib/gemini/tools';
  import { autogrow } from '$lib/autogrow';
  import ProjectSelect from './ProjectSelect.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import DurationPicker from './DurationPicker.svelte';
  import EnergyPicker from './EnergyPicker.svelte';

  /**
   * A proposal, opened up and checked before it is added.
   *
   * *"When I ask the assistant to create a to-do, the only thing I can do is
   * click Add. I told it the to-do would take 20 min and low headspace — it
   * suggested the to-do, but I couldn't adjust the other things I would
   * normally be able to adjust when I do it manually."*
   *
   * The same controls as everywhere else, deliberately: WhenPicker,
   * DurationPicker, EnergyPicker, ProjectSelect. A proposal reviewed with
   * different controls from the ones that write a to-do by hand is a second
   * dialect of the same form, and the two would drift.
   *
   * ONLY FIELDS `applyWrite` ACTUALLY WRITES (`proposalFields`). A control for
   * an argument the apply step ignores is a setting that silently does
   * nothing, which is worse than not offering it.
   *
   * NOTHING IS SAVED HERE. Editing a proposal changes the proposal; the store
   * is untouched until Add, which is spec 7.1 and the whole reason proposals
   * exist.
   */
  let {
    proposal,
    onchange
  }: {
    proposal: ProposedWrite;
    onchange: (next: ProposedWrite) => void;
  } = $props();

  const erasQ = liveQuery(() => activeProjects());
  const eras = $derived(($erasQ as Project[] | undefined) ?? []);

  const fields = $derived(proposalFields(proposal.name));
  const args = $derived(proposal.args);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

  /**
   * The era named by the proposal, WHEN IT ALREADY EXISTS.
   *
   * `projectId` may hold an era's NAME rather than its id — that is what lets
   * one reply make an era and file into it before the era has an id (see
   * describeWrite). So a proposal can legitimately point at something that is
   * still a proposal itself, and the select has no option for it. Matching by
   * name as well as id is what stops this panel quietly unfiling those.
   */
  const eraRef = $derived(str(args.projectId));
  const era = $derived(
    eras.find((e) => e.id === eraRef) ??
      eras.find((e) => e.name.toLowerCase() === (eraRef ?? '').toLowerCase())
  );
  /** Named, but not here yet — an era an earlier proposal will create. */
  const pendingEra = $derived(!!eraRef && !era);

  // Seeded once on purpose: this panel is keyed to one proposal, and rebinding
  // the box from a relabelled proposal mid-typing would fight the cursor — the
  // same reason RenameField takes a value rather than binding one.
  // svelte-ignore state_referenced_locally
  let text = $state(editableText(proposal) ?? '');

  const patch = async (p: Record<string, unknown>) => onchange(await withArgs(proposal, p));

  async function saveText() {
    const trimmed = text.trim();
    // Same rule as RenameField: a row with no words cannot be read or found
    // again, so an empty edit is refused rather than saved.
    if (!trimmed) return;
    const key = proposal.name === 'create_idea' || proposal.name === 'append_note'
      ? 'text'
      : proposal.name === 'create_todo'
        ? 'title'
        : 'name';
    await patch({ [key]: trimmed });
  }
</script>

<div class="mt-2 space-y-3 border-t border-line-1 pt-3">
  {#if fields.text}
    <div>
      <p class="section-label mb-2">What it says</p>
      <textarea
        bind:value={text}
        use:autogrow={{ value: text, onenter: saveText, max: 240 }}
        onblur={saveText}
        enterkeyhint="done"
        class="field field-grow w-full"
        aria-label="What it says"
      ></textarea>
    </div>
  {/if}

  {#if fields.era}
    <div>
      <p class="section-label mb-2">Where it goes</p>
      <div class="flex gap-2">
        <select
          value={era?.id ?? ''}
          onchange={(e) =>
            patch({ projectId: e.currentTarget.value || undefined, projectInEra: undefined })}
          class="field press min-w-0 flex-1 text-sm"
          aria-label="Era"
        >
          <option value="">Nowhere yet</option>
          {#each eras as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
        </select>
        {#if fields.project}
          <div class="min-w-0 flex-1">
            <ProjectSelect
              {eras}
              eraId={era?.id}
              tag={str(args.projectInEra)}
              onpick={(id, t) => patch({ projectId: id, projectInEra: t })}
            />
          </div>
        {/if}
      </div>
      {#if pendingEra}
        <!-- The era does not exist yet, so the select above cannot show it.
             Saying so is the difference between "it is going somewhere you
             have not made yet" and "it is going nowhere". -->
        <p class="footnote mt-1">
          Going to <span class="text-ink-200">{eraRef}</span>, which another suggestion
          here creates. Picking an era above sends it somewhere that already exists
          instead.
        </p>
      {/if}
    </div>
  {/if}

  {#if fields.todo}
    <div>
      <p class="section-label mb-2">When</p>
      <WhenPicker value={str(args.date)} onpick={(date) => patch({ date })} />
    </div>
    <div>
      <p class="section-label mb-2">How long will it take?</p>
      <DurationPicker
        value={str(args.takes) as TimeBucket | undefined}
        onpick={(takes) => patch({ takes })}
      />
    </div>
    <div>
      <p class="section-label mb-2">How much headspace does it need?</p>
      <EnergyPicker
        value={str(args.energy) as Energy | undefined}
        onpick={(energy) => patch({ energy })}
      />
    </div>
  {/if}
</div>
