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

export async function openTodos(projectId?: string): Promise<Todo[]> {
  const all = await db.todos.toArray();
  return all
    .filter(notDeleted)
    .filter((t) => !t.completedAt)
    .filter((t) => (projectId ? t.projectId === projectId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  /** ISO timestamp of the most recent completion or note edit; undefined if never. */
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

/**
 * Pulse replaces progress bars (spec 4.2). A progress bar on an open-ended
 * personal project is always wrong and always reads as failure; "last touched"
 * and "closed recently" describe activity without implying a finish line.
 * A quiet project should look quiet, not behind.
 */
export async function projectPulses(): Promise<ProjectPulse[]> {
  const [projects, todos, notes] = await Promise.all([
    activeProjects(),
    db.todos.toArray(),
    db.notes.toArray()
  ]);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString();

  return projects.map((project) => {
    const mine = todos.filter(notDeleted).filter((t) => t.projectId === project.id);
    const completions = mine
      .map((t) => t.completedAt)
      .filter((c): c is string => !!c)
      .sort();
    const note = notes.filter(notDeleted).find((n) => n.projectId === project.id);

    const candidates = [completions.at(-1), note?.updatedAt].filter((v): v is string => !!v);

    return {
      project,
      lastTouchedAt: candidates.sort().at(-1),
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
  const [todos, ideas] = await Promise.all([db.todos.toArray(), db.ideas.toArray()]);

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

  return [...fromTodos, ...fromIdeas].sort((a, b) => b.at.localeCompare(a.at));
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
