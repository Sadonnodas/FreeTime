import { db } from './db';
import type { Project, Todo } from './types';
import { today } from './store';

/**
 * Read-side helpers. Kept apart from store.ts (the write side) so it stays easy
 * to see that nothing here mutates.
 */

const notDeleted = <T extends { deletedAt?: string }>(r: T): boolean => !r.deletedAt;

export async function activeProjects(): Promise<Project[]> {
  const all = await db.projects.toArray();
  return all
    .filter(notDeleted)
    .filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every live era, archived ones included.
 *
 * The planner needs these to know which projects are asleep, and an archived
 * era's sleeping list is still the truth about its projects — filtering to
 * active ones here would quietly un-sleep everything inside an era that was
 * put away.
 */
export async function allProjects(): Promise<Project[]> {
  return (await db.projects.toArray()).filter(notDeleted);
}

export async function openTodos(projectId?: string): Promise<Todo[]> {
  const all = await db.todos.toArray();
  return all
    .filter(notDeleted)
    .filter((t) => !t.completedAt)
    .filter((t) => (projectId ? t.projectId === projectId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Every live to-do, open AND closed.
 *
 * Whether one to-do is blocked depends on whether the thing before it is DONE,
 * and openTodos() has filtered exactly that away. Resolving a link against the
 * open ones alone happens to give the right answer today — a completed blocker
 * is simply absent — but only by accident, and the accident would reverse the
 * moment that filter changed.
 */
export async function allTodos(): Promise<Todo[]> {
  return (await db.todos.toArray()).filter(notDeleted);
}

/**
 * Completed items are never deleted and never hidden (spec principle 2), so
 * this is a first-class view, not a debug affordance.
 */
export async function closedTodos(projectId?: string): Promise<Todo[]> {
  const all = await db.todos.toArray();
  return all
    .filter(notDeleted)
    .filter((t): t is Todo & { completedAt: string } => !!t.completedAt)
    .filter((t) => (projectId ? t.projectId === projectId : true))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

/**
 * Obligations only — items the user gave a real date to. Note there is no
 * "overdue" concept anywhere: a past date still just means "this one is dated",
 * and undated items are not late, they are waiting.
 */
export async function datedTodos(onOrBefore = today()): Promise<Todo[]> {
  const all = await db.todos.toArray();
  return all
    .filter(notDeleted)
    .filter((t) => !t.completedAt && !!t.date && t.date <= onOrBefore)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

export interface ProjectPulse {
  project: Project;
  /**
   * When anything last happened in this era — undefined only for one made and
   * never filled. See `projectPulses` for what counts and why it is broad.
   */
  lastTouchedAt?: string;
  closedLast30: number;
  openCount: number;
}

/** Set aside, not deleted. Everything inside an archived project is kept, and
 *  restoring it is one tap from the Projects screen. */
export async function archivedProjects(): Promise<Project[]> {
  const all = await db.projects.toArray();
  return all
    .filter(notDeleted)
    .filter((p) => p.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Rows of a table that belong to one era, still alive, grouped in one pass. */
function byEra<T extends { projectId?: string; deletedAt?: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    if (r.deletedAt || !r.projectId) continue;
    const list = map.get(r.projectId);
    if (list) list.push(r);
    else map.set(r.projectId, [r]);
  }
  return map;
}

/**
 * Pulse replaces progress bars (spec 4.2). A progress bar on an open-ended
 * personal project is always wrong and always reads as failure; "last touched"
 * describes activity without implying a finish line, and a quiet era should
 * look quiet rather than behind.
 *
 * TOUCHED MEANS INTERACTED WITH, NOT FINISHED, and it used to mean only the
 * latter — the most recent COMPLETED to-do, plus a note's date. So an era you
 * had spent an evening filling with to-dos still said "nothing yet", which is
 * how it was reported: *"I have some that say nothing yet, even though I added
 * to-dos to them. I thought that would remove the nothing yet."* Fair, and the
 * broader reading is Toon's own: *"interacting with an era — adding projects,
 * to-dos, to-buys, memos — is part of planning for something and is work
 * towards that era."*
 *
 * So it now takes the latest of everything that happened in there: a to-do
 * written or ticked, an idea written or finished, a thing wanted or bought, a
 * recording made, a note or a block edited, and the era's own record changing
 * (which is what adding, renaming, recolouring or reordering a project inside
 * it does).
 *
 * **The era's own CREATION deliberately does not count**, which is the one
 * exclusion that keeps "nothing yet" meaning something: without it every era
 * would read as touched the moment it existed and the state could never be
 * seen. `updatedAt > createdAt` is "something has happened to this since it
 * was made".
 *
 * **This is one definition shared by four readers**, and broadening it moved
 * all of them on purpose rather than by accident: the Eras card, the assistant's
 * digest, the "haven't touched X in a while — on purpose?" question (which is
 * now right, where it used to ask that about an era you had filled last week),
 * and Free Time's NEGLECTED SLOT, which will no longer resurface an era you
 * have been actively planning in. That last one is the real change and it is
 * the intended one — the slot exists to bring back what has gone quiet, and an
 * era you were writing into yesterday has not.
 *
 * Reading every table here is what keeps it live: a liveQuery only re-runs for
 * the tables it actually read. Memo blobs cost nothing to scan — IndexedDB
 * hands back a reference to the stored bytes, not the bytes.
 */
export async function projectPulses(): Promise<ProjectPulse[]> {
  const [projects, todos, ideas, buys, notes, widgets, memos] = await Promise.all([
    activeProjects(),
    db.todos.toArray(),
    db.ideas.toArray(),
    db.buyItems.toArray(),
    db.notes.toArray(),
    db.widgets.toArray(),
    db.memos.toArray()
  ]);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString();

  const todosBy = byEra(todos);
  const ideasBy = byEra(ideas);
  const buysBy = byEra(buys);
  const notesBy = byEra(notes);
  const widgetsBy = byEra(widgets);
  const memosBy = byEra(memos);

  return projects.map((project) => {
    const mine = todosBy.get(project.id) ?? [];
    const completions = mine
      .map((t) => t.completedAt)
      .filter((c): c is string => !!c)
      .sort();

    const touches = [
      // What came out of it.
      ...completions,
      ...(buysBy.get(project.id) ?? []).map((b) => b.purchasedAt),
      ...(ideasBy.get(project.id) ?? []).map((i) => i.doneAt),
      ...(memosBy.get(project.id) ?? []).map((m) => m.recordedAt),
      // And what went into it, which is work on it too.
      ...mine.map((t) => t.createdAt),
      ...(ideasBy.get(project.id) ?? []).map((i) => i.createdAt),
      ...(buysBy.get(project.id) ?? []).map((b) => b.createdAt),
      // Every note in the era, not the first one found — an era with a note
      // per project used to report whichever came back first, which is an
      // arbitrary row and usually not the one last written in.
      ...(notesBy.get(project.id) ?? []).map((n) => n.updatedAt),
      ...(widgetsBy.get(project.id) ?? []).map((w) => w.updatedAt),
      // The era record itself: a project added to it, a rename, a colour, a
      // cover. Never its creation — see above.
      //
      // `tags.length` is checked as well as the timestamps, because an era
      // created and given a project in the SAME MILLISECOND (an import, the
      // assistant applying two proposals, a fast script) has
      // updatedAt === createdAt and would read as untouched while visibly
      // holding a project. Nothing seeds tags at creation, so having one is
      // itself proof that something happened afterwards.
      (project.tags ?? []).length || project.updatedAt > project.createdAt
        ? project.updatedAt
        : undefined
    ].filter((v): v is string => !!v);

    return {
      project,
      lastTouchedAt: touches.sort().at(-1),
      closedLast30: completions.filter((c) => c >= cutoffIso).length,
      openCount: mine.filter((t) => !t.completedAt).length
    };
  });
}

export interface Win {
  id: string;
  text: string;
  at: string;
  projectId?: string;
}

/**
 * Wins are derived, never logged (spec 6). There is no wins table — asking the
 * user to record their own wins is exactly the pattern that left the old habit
 * tracker with four check-ins, so the data has to come from work they already
 * did for other reasons.
 */
export async function winsSince(sinceIso: string): Promise<Win[]> {
  const [todos, ideas, eras] = await Promise.all([
    db.todos.toArray(),
    db.ideas.toArray(),
    db.projects.toArray()
  ]);

  const fromTodos: Win[] = todos
    .filter(notDeleted)
    .filter((t) => !!t.completedAt && t.completedAt >= sinceIso)
    .map((t) => ({ id: t.id, text: t.title, at: t.completedAt!, projectId: t.projectId }));

  // Finishing a book counts, and always has — this used to come from a list
  // item reaching 'done'. Ideas carry a real timestamp now rather than a state,
  // so the win has an actual moment attached to it.
  const fromIdeas: Win[] = ideas
    .filter(notDeleted)
    .filter((i) => !!i.doneAt && i.doneAt >= sinceIso)
    .map((i) => ({ id: i.id, text: i.text, at: i.doneAt!, projectId: i.projectId }));

  // A whole project finished is the biggest win there is, so it goes in the same
  // feed as a ticked to-do rather than somewhere of its own — the monthly
  // summary and the day-close both read from here.
  const fromProjects: Win[] = eras.filter(notDeleted).flatMap((era) =>
    Object.entries(era.finishedTags ?? {})
      .filter(([tag, at]) => at >= sinceIso && (era.tags ?? []).includes(tag))
      .map(([tag, at]) => ({ id: `${era.id}:${tag}`, text: `Finished ${tag}`, at, projectId: era.id }))
  );

  return [...fromTodos, ...fromIdeas, ...fromProjects].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * What a project added up to — shown on the screen where you finish it.
 *
 * Counts of things that happened, never a proportion: "14 to-dos done" is a
 * record, and "14 of 17" would be the completion percentage the spec bans,
 * arriving at the exact moment it is least deserved. The still-open ones are
 * counted separately and only so the screen can say what happens to them.
 */
export interface ProjectRecap {
  /** The earliest thing ever written in it — the closest there is to a start date. */
  startedAt?: string;
  done: number;
  open: number;
  bought: number;
  recorded: number;
  ideas: number;
}

export async function projectRecap(eraId: string, tag: string): Promise<ProjectRecap> {
  const mine = <T extends { deletedAt?: string; tag?: string }>(rows: T[]) =>
    rows.filter((r) => !r.deletedAt && r.tag === tag);
  const [todos, buys, memos, ideas, notes, widgets] = await Promise.all([
    db.todos.where('projectId').equals(eraId).toArray().then(mine),
    db.buyItems.where('projectId').equals(eraId).toArray().then(mine),
    db.memos.where('projectId').equals(eraId).toArray().then(mine),
    db.ideas.where('projectId').equals(eraId).toArray().then(mine),
    db.notes.where('projectId').equals(eraId).toArray().then(mine),
    db.widgets.where('projectId').equals(eraId).toArray().then(mine)
  ]);
  const starts = [...todos, ...buys, ...memos, ...ideas, ...notes, ...widgets]
    .map((r) => r.createdAt)
    .filter(Boolean)
    .sort();
  return {
    startedAt: starts[0],
    done: todos.filter((t) => t.completedAt).length,
    open: todos.filter((t) => !t.completedAt).length,
    bought: buys.filter((b) => b.purchasedAt).length,
    recorded: memos.length,
    ideas: ideas.length
  };
}

/**
 * The named collections in use, derived from the ideas themselves rather than
 * stored. A collection nobody has put anything in stops existing, which is the
 * right outcome: the old Lists tab could accumulate empty lists that had to be
 * tidied up by hand.
 */
export async function ideaGroups(): Promise<string[]> {
  const all = await db.ideas.toArray();
  const names = new Set<string>();
  for (const i of all) if (!i.deletedAt && i.group) names.add(i.group);
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function startOfWeekIso(d: Date = new Date()): string {
  const copy = new Date(d);
  // Monday-first week. getDay() is 0=Sunday, so Sunday maps back six days.
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}

export interface ProjectShare {
  project: Project;
  /** Discrete things that happened, not minutes. See the caveat below. */
  events: number;
  closed: number;
  bought: number;
  recorded: number;
  finished: number;
}

/**
 * Where the recorded work went, by project.
 *
 * THE HONEST CAVEAT, and it is not a small one: this can only see what was
 * written down. A project that generates to-dos looks busy; an afternoon with
 * family that nobody made a task for is invisible. So the projects most likely
 * to look thin are exactly the ones whose value never took the shape of a task,
 * which is the opposite of what a chart like this appears to be telling you.
 * The UI says so out loud, because a number that is quietly wrong is worse than
 * no number.
 *
 * It counts EVENTS rather than percentages of anything: a to-do closed, a thing
 * bought, a memo recorded, a want finished. There is no target, so there is
 * nothing to fall short of — the chart answers "where did my attention go",
 * never "how much of it should have gone here".
 */
export async function activityByProject(sinceIso: string): Promise<ProjectShare[]> {
  const [projects, todos, buys, memos, ideas] = await Promise.all([
    activeProjects(),
    db.todos.toArray(),
    db.buyItems.toArray(),
    db.memos.toArray(),
    db.ideas.toArray()
  ]);

  const within = (at?: string) => !!at && at >= sinceIso;

  return projects
    .map((project) => {
      const mine = <T extends { projectId?: string; deletedAt?: string }>(rows: T[]) =>
        rows.filter(notDeleted).filter((r) => r.projectId === project.id);

      const closed = mine(todos).filter((t) => within(t.completedAt)).length;
      const bought = mine(buys).filter((b) => within(b.purchasedAt)).length;
      const recorded = mine(memos).filter((m) => within(m.recordedAt)).length;
      const finished = mine(ideas).filter((i) => within(i.doneAt)).length;

      return {
        project,
        events: closed + bought + recorded + finished,
        closed,
        bought,
        recorded,
        finished
      };
    })
    .sort((a, b) => b.events - a.events || a.project.name.localeCompare(b.project.name));
}

/**
 * Start of the window, N months back.
 *
 * The day is clamped to the target month's length, because setMonth alone
 * overflows: six months back from the 30th of August is the 30th of February,
 * which JavaScript rolls forward into March — quietly handing back a window
 * two days shorter than asked for and dropping the end of February from it.
 * Caught by a test rather than by anyone noticing the chart was wrong.
 */
export function monthsAgoIso(months: number, from: Date = new Date()): string {
  const d = new Date(from);
  const day = d.getDate();
  // Move off the end of the month first, so the subtraction cannot overflow.
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  const lastOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastOfTarget));
  return d.toISOString();
}
