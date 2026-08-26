<script lang="ts">
  import type {
    TimeBucket, BrainState, FreeTimeAnswers, PlannedSlot, SlotKind
  } from '$lib/types';
  import { createPlanner, planDay, type Planner } from '$lib/freetime';
  import { pickRotating, type RotatingQuestion } from '$lib/questions';
  import { setDaySlots } from '$lib/day';
  import { generateQuestions, rankSlots } from '$lib/gemini/plan';
  import { activeProjects } from '$lib/queries';

  /**
   * The Free Time flow (spec 5). Two fixed questions, one or two rotating ones,
   * then three slots you can reshuffle or throw away.
   *
   * Everything here runs on local rules. Phase 4 adds Gemini ranking on top —
   * it does not replace this, because the spec requires a working non-AI path
   * for every AI feature.
   */
  let { onDone }: { onDone: () => void } = $props();

  type Step = 'time' | 'brain' | 'rotating' | 'plan';
  let step = $state<Step>('time');

  let time = $state<TimeBucket | null>(null);
  let brain = $state<BrainState | null>(null);
  let projectPullId = $state<string | undefined>(undefined);

  let rotating = $state<RotatingQuestion[]>([]);
  let rotatingIndex = $state(0);

  let slots = $state<PlannedSlot[]>([]);
  let planner = $state<Planner | null>(null);
  let building = $state(false);

  const TIMES: { value: TimeBucket; label: string }[] = [
    { value: '20min', label: '20 minutes' },
    { value: '1-2h', label: 'An hour or two' },
    { value: 'half day', label: 'Half a day' },
    { value: 'all day', label: 'All day' }
  ];

  // Maps straight onto the energy ceiling — no scoring, no interpretation.
  const BRAINS: { value: BrainState; label: string; hint: string }[] = [
    { value: 'fried', label: 'Fried', hint: 'Quick wins only' },
    { value: 'normal', label: 'Normal', hint: 'Up for something moderate' },
    { value: 'sharp', label: 'Sharp', hint: 'Good for a focus block' }
  ];

  async function chooseTime(v: TimeBucket) {
    time = v;
    step = 'brain';
  }

  async function chooseBrain(v: BrainState) {
    brain = v;
    // Gemini first, static set if it is unavailable or returns anything we
    // don't trust. The static path is not a degraded mode — it is what runs
    // with no key, no signal, or a bad generation.
    rotating = (await generateQuestions()) ?? (await pickRotating());
    rotatingIndex = 0;
    step = rotating.length ? 'rotating' : 'plan';
    if (step === 'plan') await build();
  }

  async function answerRotating(q: RotatingQuestion, i: number) {
    if (q.mapsTo === 'project_pull') projectPullId = q.optionProjectIds?.[i];
    if (rotatingIndex + 1 < rotating.length) {
      rotatingIndex += 1;
    } else {
      step = 'plan';
      await build();
    }
  }

  const answers = (): FreeTimeAnswers => ({
    time: time!,
    brain: brain!,
    projectPullId
  });

  async function build() {
    building = true;
    const a = answers();
    planner = await createPlanner(a);

    // The pool is already narrowed by pure code, so the model ranks a filtered
    // shortlist and can never reach into the whole database (spec 5.2).
    const projects = await activeProjects();
    const nameFor = (id?: string) =>
      projects.find((p) => p.id === id)?.name ?? 'Unassigned';

    const ranked = await rankSlots(planner.pool, a, nameFor);
    slots = ranked ?? (await planDay(a));
    building = false;
  }

  /** Swap one slot for the next candidate its own rule would pick. */
  function reshuffle(kind: SlotKind, currentId: string) {
    if (!planner) return;
    const used = new Set(slots.map((s) => s.todo.id));
    const next = planner.pick(kind, used);
    if (!next) return;
    slots = slots.map((s) => (s.todo.id === currentId ? next : s));
  }

  /** No confirmation, no "are you sure", no guilt copy. It just goes. */
  function skip(id: string) {
    slots = slots.filter((s) => s.todo.id !== id);
  }

  async function accept() {
    await setDaySlots(slots.map((s) => s.todo.id));
    onDone();
  }

  /** Excludes everything currently on screen, so "something else" is always
   *  genuinely something else rather than a shuffle back to the same item. */
  const canReshuffle = (kind: SlotKind) =>
    !!planner && planner.hasAlternative(kind, new Set(slots.map((s) => s.todo.id)));

  const KIND_LABEL: Record<SlotKind, string> = {
    pull: 'The pull',
    neglected: 'The neglected',
    obligation: 'The obligation'
  };
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-ink-950">
  <div class="flex items-center justify-between px-4 pt-safe">
    <span class="py-3 text-xs uppercase tracking-wide text-ink-400">Free Time</span>
    <button class="tap px-2 text-ink-400" onclick={onDone} aria-label="Close">×</button>
  </div>

  <div class="flex-1 overflow-y-auto px-6">
    {#if step === 'time'}
      <h2 class="py-6 text-2xl font-semibold">How long have you got?</h2>
      <div class="space-y-3">
        {#each TIMES as t (t.value)}
          <button
            class="tap w-full rounded-2xl border border-ink-700 bg-ink-900 px-5 py-5 text-left text-lg"
            onclick={() => chooseTime(t.value)}>{t.label}</button
          >
        {/each}
      </div>
    {:else if step === 'brain'}
      <h2 class="py-6 text-2xl font-semibold">What's your head like?</h2>
      <div class="space-y-3">
        {#each BRAINS as b (b.value)}
          <button
            class="tap w-full rounded-2xl border border-ink-700 bg-ink-900 px-5 py-4 text-left"
            onclick={() => chooseBrain(b.value)}
          >
            <span class="block text-lg">{b.label}</span>
            <span class="block text-sm text-ink-400">{b.hint}</span>
          </button>
        {/each}
      </div>
    {:else if step === 'rotating'}
      {@const q = rotating[rotatingIndex]}
      {#if q}
        <h2 class="py-6 text-2xl font-semibold leading-snug">{q.text}</h2>
        <div class="space-y-3">
          {#each q.options as option, i (option)}
            <button
              class="tap w-full rounded-2xl border border-ink-700 bg-ink-900 px-5 py-4 text-left text-lg"
              onclick={() => answerRotating(q, i)}>{option}</button
            >
          {/each}
        </div>
      {/if}
    {:else if building}
      <p class="py-10 text-center text-ink-400">Working it out…</p>
    {:else if slots.length}
      <h2 class="py-6 text-2xl font-semibold">
        {slots.length === 3 ? 'Here are three.' : `Here ${slots.length === 1 ? 'is one' : 'are two'}.`}
      </h2>
      <div class="space-y-3">
        {#each slots as slot (slot.todo.id)}
          <div class="rounded-2xl border border-ink-700 bg-ink-900 p-4">
            <p class="text-xs uppercase tracking-wide text-ink-400">{KIND_LABEL[slot.kind]}</p>
            <p class="mt-1 text-lg leading-snug">{slot.todo.title}</p>
            <p class="mt-1 text-sm text-ink-400">{slot.reason}</p>
            <div class="mt-3 flex gap-2">
              {#if canReshuffle(slot.kind)}
                <button
                  class="tap rounded-lg bg-ink-800 px-3 text-sm text-ink-200"
                  onclick={() => reshuffle(slot.kind, slot.todo.id)}>Something else</button
                >
              {/if}
              <button
                class="tap rounded-lg px-3 text-sm text-ink-400"
                onclick={() => skip(slot.todo.id)}>Not today</button
              >
            </div>
          </div>
        {/each}
      </div>
      {#if slots.length < 3}
        <!-- Two is a complete day. Said plainly so a short list doesn't read
             as the app having failed to find enough. -->
        <p class="mt-4 text-center text-xs text-ink-400">
          {slots.length === 2 ? 'Two is a complete day.' : 'One real thing is enough.'}
        </p>
      {/if}
    {:else}
      <div class="py-12 text-center">
        <p class="text-lg">Nothing fits that right now.</p>
        <p class="mt-2 text-sm text-ink-400">
          Either the pile is empty or nothing in it is small enough. Both are fine.
        </p>
      </div>
    {/if}
  </div>

  <div class="p-6 pb-safe">
    {#if step === 'plan' && !building}
      <button
        class="w-full rounded-2xl bg-accent py-4 text-lg font-medium text-ink-950 disabled:opacity-30"
        disabled={!slots.length}
        onclick={accept}
      >
        {slots.length ? "That's the day" : 'Nothing today'}
      </button>
    {/if}
  </div>
</div>
