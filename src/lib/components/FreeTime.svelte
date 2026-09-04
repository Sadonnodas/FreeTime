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

  /**
   * Waiting on the rotating questions, which is a network round trip to Gemini.
   *
   * This step used to await that call with nothing on screen changing: tapping
   * "Normal" appeared to do nothing, so it got tapped again, and again, each
   * tap firing another request — until one returned and the flow lurched
   * forward. Reported exactly that way: "I pressed many buttons but it didn't
   * move on, and then suddenly it did."
   */
  let asking = $state(false);

  /**
   * Nothing in this flow may wait on the network indefinitely.
   *
   * generateQuestions has no deadline of its own, so a request that hangs would
   * hang the whole questionnaire. The static questions are not a degraded mode
   * — they are what runs with no key and no signal — so falling back to them
   * after a few seconds costs nothing.
   */
  function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
    ]);
  }

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
    // A second tap while the first is in flight would start another request
    // and race it. Ignoring it is right: the answer is already recorded.
    if (asking) return;
    brain = v;
    asking = true;
    try {
      // Gemini first, static set if it is unavailable, slow, or returns
      // anything we don't trust. The static path is not a degraded mode — it is
      // what runs with no key, no signal, or a bad generation.
      rotating = (await withTimeout(generateQuestions(), 6000)) ?? (await pickRotating());
      rotatingIndex = 0;
      step = rotating.length ? 'rotating' : 'plan';
    } finally {
      asking = false;
    }
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

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex items-center justify-between px-4 pt-safe">
    <span class="section-label py-3">Free Time</span>
    <button class="press tap px-2 text-[22px] leading-none text-ink-400" onclick={onDone} aria-label="Close">×</button>
  </div>

  <div class="flex-1 overflow-y-auto px-6">
    {#if step === 'time'}
      <h2 class="large-title py-6">How long have you got?</h2>
      <div class="space-y-3">
        {#each TIMES as t (t.value)}
          <button
            class="card press tap w-full px-5 py-5 text-left text-[17px]"
            onclick={() => chooseTime(t.value)}>{t.label}</button
          >
        {/each}
      </div>
    {:else if step === 'brain'}
      <h2 class="large-title py-6">What's your head like?</h2>
      <div class="space-y-3">
        {#each BRAINS as b (b.value)}
          <button
            class="card press tap w-full px-5 py-4 text-left transition-opacity
                   {asking && brain !== b.value ? 'opacity-40' : ''}"
            onclick={() => chooseBrain(b.value)}
            disabled={asking}
          >
            <span class="block text-[17px]">{b.label}</span>
            <span class="footnote block">{b.hint}</span>
          </button>
        {/each}
      </div>
      {#if asking}
        <!-- The answer is taken the moment it is tapped; this only says that
             the next question is being fetched. -->
        <p class="footnote mt-4 text-center">Thinking of a question…</p>
      {/if}
    {:else if step === 'rotating'}
      {@const q = rotating[rotatingIndex]}
      {#if q}
        <h2 class="large-title py-6">{q.text}</h2>
        <div class="space-y-3">
          {#each q.options as option, i (option)}
            <button
              class="card press tap w-full px-5 py-4 text-left text-[17px]"
              onclick={() => answerRotating(q, i)}>{option}</button
            >
          {/each}
        </div>
      {/if}
    {:else if building}
      <p class="py-10 text-center text-ink-400">Working it out…</p>
    {:else if slots.length}
      <h2 class="large-title py-6">
        {slots.length === 3 ? 'Here are three.' : `Here ${slots.length === 1 ? 'is one' : 'are two'}.`}
      </h2>
      <div class="space-y-3">
        {#each slots as slot (slot.todo.id)}
          <div class="card rise p-4">
            <p class="section-label">{KIND_LABEL[slot.kind]}</p>
            <p class="body mt-1">{slot.todo.title}</p>
            <p class="footnote mt-1">{slot.reason}</p>
            <div class="mt-3 flex gap-2">
              {#if canReshuffle(slot.kind)}
                <button
                  class="press tap rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
                  onclick={() => reshuffle(slot.kind, slot.todo.id)}>Something else</button
                >
              {/if}
              <button
                class="press tap rounded-xl px-4 text-sm text-ink-400"
                onclick={() => skip(slot.todo.id)}>Not today</button
              >
            </div>
          </div>
        {/each}
      </div>
      {#if slots.length < 3}
        <!-- Two is a complete day. Said plainly so a short list doesn't read
             as the app having failed to find enough. -->
        <p class="footnote mt-4 text-center">
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
        class="btn btn-primary press w-full py-4 text-[17px]"
        disabled={!slots.length}
        onclick={accept}
      >
        {slots.length ? "That's the day" : 'Nothing today'}
      </button>
    {/if}
  </div>
</div>
