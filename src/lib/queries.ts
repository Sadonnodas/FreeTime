import { db } from './db';
import type { Project, Todo, ListItem } from './types';
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
  const [todos, listItems] = await Promise.all([
    db.todos.toArray(),
    db.listItems.toArray()
  ]);

  const fromTodos: Win[] = todos
    .filter(notDeleted)
    .filter((t) => !!t.completedAt && t.completedAt >= sinceIso)
    .map((t) => ({ id: t.id, text: t.title, at: t.completedAt!, projectId: t.projectId }));

  // Finishing a book counts. ListItems use updatedAt as the completion time
  // because 'done' is a state, not a timestamp.
  const fromLists: Win[] = listItems
    .filter(notDeleted)
    .filter((li: ListItem) => li.state === 'done' && li.updatedAt >= sinceIso)
    .map((li) => ({ id: li.id, text: li.text, at: li.updatedAt }));

  return [...fromTodos, ...fromLists].sort((a, b) => b.at.localeCompare(a.at));
}

export function startOfWeekIso(d: Date = new Date()): string {
  const copy = new Date(d);
  // Monday-first week. getDay() is 0=Sunday, so Sunday maps back six days.
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}
