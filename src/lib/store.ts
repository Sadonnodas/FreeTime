import { db } from './db';
import type {
  Base, Project, Todo, Idea, BuyItem, List, ListItem,
  Habit, HabitLog, Capture, Note, Energy, ListItemState, HabitState
} from './types';

/**
 * Every write in the app goes through this file — manual edits now, and the
 * Gemini assistant's function calls later (spec 7.1). One path in means offline
 * queueing and sync behave identically no matter who did the writing.
 *
 * Writes are local-first: they hit IndexedDB and return immediately. Nothing
 * here awaits the network, so there is never a spinner on a write.
 */

export const uid = (): string => crypto.randomUUID();
export const now = (): string => new Date().toISOString();

/**
 * Local calendar day as YYYY-MM-DD. Deliberately NOT UTC — "today" must mean
 * the user's today, or a 1am capture lands on yesterday.
 */
export function today(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stamp<T extends object>(fields: T): T & Omit<Base, 'deletedAt'> {
  const t = now();
  return { ...fields, id: uid(), createdAt: t, updatedAt: t };
}

/** Live queries filter on this rather than deleting rows. */
export const alive = <T extends Base>(r: T): boolean => !r.deletedAt;

// ---------------------------------------------------------------- projects

export async function createProject(name: string, color?: string): Promise<string> {
  const p: Project = stamp({ name: name.trim(), color, archived: false });
  await db.projects.add(p);
  return p.id;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await db.projects.update(id, { name: name.trim(), updatedAt: now() });
}

export async function archiveProject(id: string, archived = true): Promise<void> {
  await db.projects.update(id, { archived, updatedAt: now() });
}

// ------------------------------------------------------------------- todos

/**
 * The 5-second capture rule (spec principle 1) is enforced here: `title` is the
 * only required argument. Everything else is optional, forever, and nothing in
 * the UI may demand it later.
 */
export async function createTodo(
  title: string,
  opts: { projectId?: string; energy?: Energy; date?: string; notes?: string } = {}
): Promise<string> {
  const t: Todo = stamp({ title: title.trim(), ...opts });
  await db.todos.add(t);
  return t.id;
}

export async function updateTodo(id: string, patch: Partial<Todo>): Promise<void> {
  await db.todos.update(id, { ...patch, updatedAt: now() });
}

/** Completion is a timestamp, never a deletion. This timestamp IS the wins feed. */
export async function completeTodo(id: string): Promise<void> {
  const t = now();
  await db.todos.update(id, { completedAt: t, updatedAt: t });
}

/** Undo, for a mis-tap. Distinct from cleanup, which must never clear completedAt. */
export async function uncompleteTodo(id: string): Promise<void> {
  await db.todos.update(id, { completedAt: undefined, updatedAt: now() });
}

// ------------------------------------------------------------------- ideas

export async function createIdea(text: string, projectId?: string): Promise<string> {
  const i: Idea = stamp({ text: text.trim(), projectId });
  await db.ideas.add(i);
  return i.id;
}

/** One tap, and the backlink survives so the idea is not orphaned. */
export async function promoteIdea(ideaId: string): Promise<string> {
  const idea = await db.ideas.get(ideaId);
  if (!idea) throw new Error(`No idea ${ideaId}`);
  const todoId = await createTodo(idea.text, { projectId: idea.projectId });
  await db.ideas.update(ideaId, { promotedToTodoId: todoId, updatedAt: now() });
  return todoId;
}

// --------------------------------------------------------------------- buy

export async function createBuyItem(
  name: string,
  opts: { url?: string; priceCents?: number; currency?: string; projectId?: string } = {}
): Promise<string> {
  const b: BuyItem = stamp({ name: name.trim(), currency: 'EUR', ...opts });
  await db.buyItems.add(b);
  return b.id;
}

export async function markPurchased(id: string, purchased = true): Promise<void> {
  await db.buyItems.update(id, {
    purchasedAt: purchased ? now() : undefined,
    updatedAt: now()
  });
}

// ------------------------------------------------------------------- lists

export async function createList(name: string, icon?: string): Promise<string> {
  const l: List = stamp({ name: name.trim(), icon });
  await db.lists.add(l);
  return l.id;
}

export async function addListItem(
  listId: string,
  text: string,
  url?: string
): Promise<string> {
  const state: ListItemState = 'want';
  const li: ListItem = stamp({ listId, text: text.trim(), url, state });
  await db.listItems.add(li);
  return li.id;
}

/** Reaching 'done' emits a win (spec 6) even though this is not a Todo. */
export async function setListItemState(id: string, state: ListItemState): Promise<void> {
  await db.listItems.update(id, { state, updatedAt: now() });
}

// ------------------------------------------------------------------ habits

export async function createHabit(name: string): Promise<string> {
  const state: HabitState = 'active';
  const h: Habit = stamp({ name: name.trim(), state, stateChangedAt: now() });
  await db.habits.add(h);
  return h.id;
}

/**
 * Always an explicit user action. The app never infers dormancy from silence —
 * that is exactly the judgement the old habit tracker made and lost trust over.
 */
export async function setHabitState(id: string, state: HabitState): Promise<void> {
  const t = now();
  await db.habits.update(id, { state, stateChangedAt: t, updatedAt: t });
}

/** Idempotent: tapping twice in a day toggles, it never double-logs. */
export async function toggleHabitLog(habitId: string, date = today()): Promise<boolean> {
  const existing = await db.habitLogs.where('[habitId+date]').equals([habitId, date]).first();
  if (existing && !existing.deletedAt) {
    await db.habitLogs.update(existing.id, { deletedAt: now(), updatedAt: now() });
    return false;
  }
  if (existing) {
    await db.habitLogs.update(existing.id, { deletedAt: undefined, updatedAt: now() });
    return true;
  }
  const log: HabitLog = stamp({ habitId, date });
  await db.habitLogs.add(log);
  return true;
}

// ----------------------------------------------------------------- capture

/** The bottom-of-screen box. No fields, no project, no confirmation. */
export async function capture(text: string): Promise<string> {
  const c: Capture = stamp({ text: text.trim() });
  await db.captures.add(c);
  return c.id;
}

/** Inbox triage. Marks the capture sorted rather than removing it. */
export async function sortCaptureToTodo(captureId: string, projectId?: string): Promise<string> {
  const c = await db.captures.get(captureId);
  if (!c) throw new Error(`No capture ${captureId}`);
  const todoId = await createTodo(c.text, { projectId });
  await db.captures.update(captureId, { sortedAt: now(), updatedAt: now() });
  return todoId;
}

export async function sortCaptureToIdea(captureId: string, projectId?: string): Promise<string> {
  const c = await db.captures.get(captureId);
  if (!c) throw new Error(`No capture ${captureId}`);
  const ideaId = await createIdea(c.text, projectId);
  await db.captures.update(captureId, { sortedAt: now(), updatedAt: now() });
  return ideaId;
}

// ------------------------------------------------------------------- notes

export async function getNote(projectId: string): Promise<Note | undefined> {
  return db.notes.where('projectId').equals(projectId).first();
}

export async function saveNote(projectId: string, markdown: string): Promise<void> {
  const existing = await getNote(projectId);
  if (existing) {
    await db.notes.update(existing.id, { markdown, updatedAt: now() });
  } else {
    const n: Note = stamp({ projectId, markdown });
    await db.notes.add(n);
  }
}

// ------------------------------------------------------------- soft delete

type SoftDeletable =
  | 'projects' | 'todos' | 'ideas' | 'buyItems'
  | 'lists' | 'listItems' | 'habits' | 'captures';

/** Tombstone, so the delete survives a sync instead of the row resurrecting. */
export async function softDelete(table: SoftDeletable, id: string): Promise<void> {
  const patch = { deletedAt: now(), updatedAt: now() };
  await (db[table] as unknown as { update(k: string, p: object): Promise<number> })
    .update(id, patch);
}
