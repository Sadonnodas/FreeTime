import { today } from './store';
import { shiftDay, dayPhrase } from './days';
import type { Todo } from './types';

/**
 * DEADLINES — `Todo.by`, the day a thing has to be done before.
 *
 * Asked for with the case that makes it different from everything else the
 * app has: *"I need to make an appointment with the garage because my car
 * needs to go to the technical controle. If I don't go there before a certain
 * date I'll get a fine."*
 *
 * WHY `date` COULD NOT DO IT. A date is a day you chose — it feeds Brain's day
 * list and Today's "Also on today's list", and you move it whenever the day
 * turns out wrong. Putting the inspection on the 15th says "I plan to do it on
 * the 15th", which is exactly the thing you are then free to push to the 16th,
 * and the 17th, with nothing anywhere remembering that the 15th was not your
 * idea. A deadline is the opposite kind of fact: somebody else set it, and it
 * does not move because your Tuesday did.
 *
 * So they are two fields and BOTH can be set. Plan it for Thursday, needed
 * before the 15th; change the plan and the deadline stays put.
 *
 * WHAT IT IS NOT. There is no overdue state here, and this is the feature most
 * likely to grow one by accident, so the rules are worth stating flat:
 *
 *   - The row says "Before Fri 15 Nov" and goes on saying exactly that after
 *     the 15th. No red, no "3 days late", no bold, no badge, no sort that
 *     quietly promotes it further the longer it sits.
 *   - Nothing counts a missed deadline. Nothing records that one passed.
 *     Ticking it late is ticking it, and it goes into the wins feed like any
 *     other closed to-do.
 *   - It does not arrive on Today the day it is set. It arrives when it is
 *     close enough to act on, which is what makes it a reminder rather than
 *     a thing sitting on the calmest screen in the app for two months.
 *
 * The only thing a deadline earns is EARLY ATTENTION: from `BY_WINDOW` days
 * out it comes to Today under "Coming up" and becomes eligible for Free Time's
 * obligation slot, and it stays there until it is ticked. Staying is the
 * point — the car still needs its inspection on the 16th — and it is safe
 * here in a way it would not be for a recurring chore, because there is
 * exactly ONE of these rows however many days pass. See `Todo.repeatDays` for
 * the pile that the other design would have built.
 */

/**
 * How many days ahead a deadline starts showing up.
 *
 * A week: long enough to ring a garage, short enough that Today is not a list
 * of everything happening this month. One number, used by the Today screen and
 * by Free Time both, so the two cannot disagree about what "coming up" means.
 */
export const BY_WINDOW = 7;

/** The last day a deadline can fall on and still be worth raising now. */
export const byHorizon = (ref: string = today()): string => shiftDay(ref, BY_WINDOW);

/**
 * Is this deadline close enough to act on? True for anything inside the window
 * AND for anything already past, which is the half that matters: a deadline
 * that goes quiet the moment it expires is a reminder that stops reminding you
 * at precisely the wrong moment.
 */
export function byDue(todo: Pick<Todo, 'by'>, ref: string = today()): boolean {
  return !!todo.by && todo.by <= byHorizon(ref);
}

/**
 * "Before tomorrow", "Before Fri 15 Nov", "Before yesterday".
 *
 * `dayPhrase` lowercases only the three relative names, so the sentence reads
 * either way round. Yesterday's deadline gets the same construction as next
 * week's on purpose: it is a statement of the day, not a verdict on it.
 */
export const byLabel = (iso: string, ref: string = today()): string =>
  `Before ${dayPhrase(iso, ref)}`;

/**
 * The deadlines to raise now, soonest first.
 *
 * Ticked ones drop out the next day rather than instantly: one finished TODAY
 * stays on the list, ticked, so the tap does not pull the row out from under
 * the thumb that made it — the same rule the shopping list follows for
 * something bought today. Tomorrow it is simply gone, which is where a done
 * thing belongs on a forward-looking list. It is still in the wins feed, in
 * its project, and everywhere else completed work is kept; this list is the
 * one surface whose whole job is what has not happened yet.
 *
 * `skip` is whatever Today is already showing elsewhere — the three slots and
 * the day list — because a to-do that is planned for today does not also need
 * telling you it is due this week.
 */
export function comingUp(todos: Todo[], skip: Set<string> = new Set(), ref: string = today()): Todo[] {
  return todos
    .filter(
      (t) =>
        byDue(t, ref) &&
        !skip.has(t.id) &&
        // A completed one leaves tomorrow; see above.
        (!t.completedAt || t.completedAt.slice(0, 10) === ref)
    )
    .sort((a, b) => a.by!.localeCompare(b.by!) || a.createdAt.localeCompare(b.createdAt));
}
