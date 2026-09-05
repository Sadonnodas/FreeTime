import type {
  Todo, Energy, TimeBucket, BrainState, FreeTimeAnswers, SlotKind, PlannedSlot
} from './types';
import { openTodos, allTodos, projectPulses, type ProjectPulse } from './queries';
import { indexById, isBlocked } from './order';
import { getDay } from './day';
import { today } from './store';
import { ago, shortDate } from './format';

/**
 * Slot selection (spec 5.2), the deterministic half.
 *
 * The spec's model is hybrid: the app filters the candidate pool by energy and
 * time in pure code, and Gemini only ranks what survives. That split exists so
 * the model can never reach into the whole database and surface something
 * absurd. Phase 4 adds the ranking layer on top of this; until then the rules
 * below do the whole job, which is exactly the mandated no-key fallback
 * (spec 7.4) rather than a stopgap.
 */

const ENERGY_ORDER: Energy[] = ['quick', 'moderate', 'focus'];
const rank = (e: Energy) => ENERGY_ORDER.indexOf(e);

/**
 * TIME AND EFFORT ARE TWO AXES, and this used to treat them as one.
 *
 * There was a TIME_CEILING mapping the window you have onto an effort ceiling —
 * twenty minutes free meant "quick wins only" — and it is simply wrong. In
 * Toon's words: "a quick win means it doesn't take much effort, but it doesn't
 * mean it can't take much time. You can spend a whole day on quick wins."
 * Sanding a board is easy and takes an afternoon; a decision you have been
 * avoiding is twenty minutes of hard thinking.
 *
 * So there are two independent filters now. How your head is bounds the EFFORT
 * (Todo.energy); how much clock you have bounds the DURATION (Todo.takes).
 */
const TIME_ORDER: TimeBucket[] = ['20min', '1-2h', 'half day', 'all day'];
const timeRank = (t: TimeBucket) => TIME_ORDER.indexOf(t);

/** How much of your head a job may take, given how your head is. */
const BRAIN_CEILING: Record<BrainState, Energy> = {
  fried: 'quick',
  normal: 'moderate',
  sharp: 'focus'
};

export const effortCeiling = (brain: BrainState): Energy => BRAIN_CEILING[brain];

/**
 * Untagged items always pass, on BOTH axes.
 *
 * This matters more than it looks: capture sets neither field (that is the
 * point of a 5-second capture), so in normal use most to-dos have both
 * undefined. Excluding unknowns would leave the pool empty and the whole flow
 * would return nothing — the filter would be technically correct and
 * practically useless. An unknown size is not a large size.
 */
function fitsEffort(todo: Todo, ceiling: Energy): boolean {
  return !todo.energy || rank(todo.energy) <= rank(ceiling);
}

/** Whether it fits the clock. A job with no estimate is not assumed to be long. */
export function fitsTime(todo: Todo, available: TimeBucket): boolean {
  return !todo.takes || timeRank(todo.takes) <= timeRank(available);
}

export interface Planner {
  /** Candidates left after the energy/time filter. */
  pool: Todo[];
  /** Picks the best remaining candidate for a slot, or null if none fits. */
  pick(kind: SlotKind, exclude: Set<string>): PlannedSlot | null;
  /** True if this kind has any alternative beyond the ones already used. */
  hasAlternative(kind: SlotKind, exclude: Set<string>): boolean;
}

/**
 * Builds a planner over the current state. Async because it reads the DB once;
 * every pick after that is synchronous, so reshuffling a slot is instant.
 */
export async function createPlanner(answers: FreeTimeAnswers): Promise<Planner> {
  const [open, all, pulses, day] = await Promise.all([
    openTodos(), allTodos(), projectPulses(), getDay()
  ]);

  const ceiling = effortCeiling(answers.brain);
  const alreadyToday = new Set(day?.slots ?? []);
  const byId = indexById(all);

  /*
   * Three constraints. The first two are independent axes: your head bounds
   * the effort, the clock bounds the duration, and neither implies the other.
   *
   * The third is whether it can be started at all. Offering "sow the grass"
   * while the garden is still full of bamboo is the worst kind of suggestion —
   * it looks like a plan and it is not one — and it is exactly what this flow
   * exists to avoid. Note the asymmetry, which is deliberate: the app will not
   * OFFER a blocked to-do, but nothing stops you choosing or ticking one.
   * Suggestion is the app's job; permission is not.
   */
  const pool = open.filter(
    (t) =>
      !alreadyToday.has(t.id) &&
      !isBlocked(t, byId) &&
      fitsEffort(t, ceiling) &&
      fitsTime(t, answers.time)
  );

  // Quietest first: never-touched projects lead, then oldest last-touch.
  const byQuietest = [...pulses].sort((a, b) => {
    if (!a.lastTouchedAt && !b.lastTouchedAt) return a.project.name.localeCompare(b.project.name);
    if (!a.lastTouchedAt) return -1;
    if (!b.lastTouchedAt) return 1;
    return a.lastTouchedAt.localeCompare(b.lastTouchedAt);
  });
  const byLiveliest = [...byQuietest].reverse();

  const pulseFor = (projectId?: string): ProjectPulse | undefined =>
    pulses.find((p) => p.project.id === projectId);

  const available = (exclude: Set<string>) => pool.filter((t) => !exclude.has(t.id));

  /**
   * The pull — the thing they'd have drifted to anyway, which now counts.
   * If they named a project, take from it. If they skipped the question, fall
   * back to the liveliest project: momentum is the best available guess at
   * where they were already heading.
   */
  function pickPull(exclude: Set<string>): PlannedSlot | null {
    const left = available(exclude);
    if (!left.length) return null;

    if (answers.projectPullId) {
      const named = left.filter((t) => t.projectId === answers.projectPullId);
      if (named.length) {
        return {
          kind: 'pull',
          todo: named[0]!,
          reason: 'You said this is where you actually want to be.'
        };
      }
    }

    for (const p of byLiveliest) {
      const hit = left.find((t) => t.projectId === p.project.id);
      if (hit) {
        return { kind: 'pull', todo: hit, reason: `${p.project.name} has momentum right now.` };
      }
    }
    // Unassigned to-dos are still perfectly good things to do.
    return { kind: 'pull', todo: left[0]!, reason: 'Straight off the top of the pile.' };
  }

  /**
   * The neglected — quietest project by pulse. Already sized to the stated
   * energy by the pool filter, so a fried evening can never surface a focus
   * block here. This is the slot most likely to read as nagging, which is why
   * it is skippable with a single tap and no confirmation.
   */
  function pickNeglected(exclude: Set<string>): PlannedSlot | null {
    const left = available(exclude);
    for (const p of byQuietest) {
      // Don't hand back the project they just said they want — that isn't neglect.
      if (p.project.id === answers.projectPullId) continue;
      const hit = left.find((t) => t.projectId === p.project.id);
      if (!hit) continue;
      const reason = p.lastTouchedAt
        ? `Quietest project — ${p.project.name}, last touched ${ago(p.lastTouchedAt)}.`
        : `${p.project.name} hasn't been touched yet.`;
      return { kind: 'neglected', todo: hit, reason };
    }
    return null;
  }

  /**
   * The obligation — only if one genuinely exists. Note there is no "overdue"
   * framing anywhere: a date in the past is just a date, and the copy says when
   * it was set, not how late it is.
   */
  function pickObligation(exclude: Set<string>): PlannedSlot | null {
    const t = today();
    const dated = available(exclude)
      .filter((todo) => !!todo.date && todo.date <= t)
      .sort((a, b) => a.date!.localeCompare(b.date!));
    if (!dated.length) return null;
    const hit = dated[0]!;
    return {
      kind: 'obligation',
      todo: hit,
      reason: hit.date === t ? 'Dated for today.' : `Dated ${shortDate(hit.date!)}.`
    };
  }

  function pick(kind: SlotKind, exclude: Set<string>): PlannedSlot | null {
    if (kind === 'pull') return pickPull(exclude);
    if (kind === 'neglected') return pickNeglected(exclude);
    return pickObligation(exclude);
  }

  return {
    pool,
    pick,
    hasAlternative: (kind, exclude) => pick(kind, exclude) !== null
  };
}

/** The spec's table order, which is how the three are shown. */
const DISPLAY_ORDER: SlotKind[] = ['pull', 'neglected', 'obligation'];

/**
 * The opening three.
 *
 * Slots are *filled* most-constrained-first (obligation, then pull, then
 * neglected) and *shown* in the spec's table order. That split matters: the
 * pull can draw from anything in the pool, so letting it go first lets it
 * swallow the only dated item and leave the obligation slot empty — the one
 * genuine commitment in the day gets quietly relabelled as a whim.
 *
 * If there is no real obligation the slot is filled with a second pull rather
 * than left empty — but if neither exists, two slots ship as-is. Two is a
 * complete day, and padding it with something the rules don't actually endorse
 * would be the app inventing work.
 */
export async function planDay(answers: FreeTimeAnswers): Promise<PlannedSlot[]> {
  const planner = await createPlanner(answers);
  const used = new Set<string>();
  const slots: PlannedSlot[] = [];

  for (const kind of ['obligation', 'pull', 'neglected'] as const) {
    const slot = planner.pick(kind, used);
    if (slot) {
      used.add(slot.todo.id);
      slots.push(slot);
    }
  }

  slots.sort((a, b) => DISPLAY_ORDER.indexOf(a.kind) - DISPLAY_ORDER.indexOf(b.kind));

  if (slots.length < 3 && !slots.some((s) => s.kind === 'obligation')) {
    const second = planner.pick('pull', used);
    if (second) {
      used.add(second.todo.id);
      slots.push({ ...second, reason: 'A second pull — no obligations today.' });
    }
  }

  return slots.slice(0, 3);
}
