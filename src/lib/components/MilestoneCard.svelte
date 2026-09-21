<script lang="ts">
  import Burst from './Burst.svelte';
  import { ON_COLOR } from '$lib/habits';
  import { milestoneWhen, type Milestone } from '$lib/milestones';

  /**
   * The moment a milestone is reached.
   *
   * It says one thing — what you have now done — and it says it in the past
   * tense. There is no next target on this card, no "only 25 to go", and no
   * mention of any run that has ended, because a card that hands you the next
   * number turns an achievement into a treadmill. See milestones.ts for the
   * rule this follows.
   *
   * The whole screen, like the finished-project card: the first version of
   * that one took half the height and came back as *"why is it only using half
   * of the screen?"* This is a smaller occasion than finishing a project, so
   * it is quieter — no dinosaur, no four seconds of confetti — but it is not a
   * toast in the corner either.
   */
  let {
    milestone,
    habitName,
    color,
    onclose
  }: {
    milestone: Milestone;
    habitName: string;
    color: string;
    onclose: () => void;
  } = $props();
</script>

<div
  class="fixed inset-0 z-50 flex flex-col items-center justify-center px-8 text-center"
  style="background: linear-gradient(to bottom, color-mix(in srgb, {color} 30%, var(--color-ink-950)), var(--color-ink-950) 70%)"
  role="dialog"
  aria-label="{habitName}, {milestone.label}"
>
  <div class="relative flex items-center justify-center">
    <Burst size={240} />
    <p class="text-[72px] leading-none font-bold" style:color>{milestone.value}</p>
  </div>

  <p class="mt-6 text-[22px] font-semibold">
    {milestone.kind === 'run' ? 'weeks running' : 'times'}
  </p>
  <p class="mt-1 text-[17px] text-ink-300">{habitName}</p>
  <p class="footnote mt-4">{milestoneWhen(milestone)}</p>

  <!-- Deliberately the only thing to do here. Nothing to opt into, nothing to
       share, and nothing that says what comes next. -->
  <button
    class="press tap mt-10 rounded-2xl px-8 py-3 text-[17px] font-medium"
    style:background={color}
    style:color={ON_COLOR}
    onclick={onclose}>Good</button
  >
</div>
