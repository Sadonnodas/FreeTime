import { db } from './db';
import type {
  Base, Project, Todo, Idea, BuyItem, List, ListItem,
  Habit, HabitLog, Capture, Note, Energy, ListItemState, HabitState,
  HabitStateChange
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

/** Pass undefined to clear it and fall back to the generated tile. */
export async function setProjectImage(id: string, image?: string): Promise<void> {
  await db.projects.update(id, { image, updatedAt: now() });
}

/** The project's section chips, in the order they are shown. */
/**
 * The palette a new project inside an era is coloured from.
 *
 * Fixed hues rather than a random one, so two projects never come out as two
 * shades of the same green — the colour exists to stop you thinking you are on
 * the laser cutter when you are on the trigger pad, and that only works if
 * neighbouring colours are clearly different. Ordered so the first few are as
 * far apart as the wheel allows.
 */
export const PROJECT_COLORS = [
  '#e8833a', // orange
  '#4f9de8', // blue
  '#68b06a', // green
  '#c765c7', // violet
  '#e0b13e', // gold
  '#e2685f', // red
  '#43b7ad', // teal
  '#8f86e0' // indigo
];

/**
 * The colour of one project inside an era.
 *
 * Falls back to its position in the era's list rather than to grey, so every
 * project made before colours existed already has one and no migration had to
 * run over anybody's data. Deterministic, so the same project is the same
 * colour on every device without the colour ever being written down.
 */
export function projectTagColor(
  tags: string[] | undefined,
  colors: Record<string, string> | undefined,
  tag: string
): string {
  const stored = colors?.[tag];
  if (stored) return stored;
  const i = (tags ?? []).indexOf(tag);
  return PROJECT_COLORS[(i < 0 ? 0 : i) % PROJECT_COLORS.length];
}

/** The next colour not already used in this era, or the next in sequence. */
function nextColor(taken: string[]): string {
  return PROJECT_COLORS.find((c) => !taken.includes(c)) ?? PROJECT_COLORS[taken.length % PROJECT_COLORS.length];
}

export async function setProjectTags(id: string, tags: string[]): Promise<void> {
  const project = await db.projects.get(id);
  const colors = { ...(project?.tagColors ?? {}) };

  // Colour anything new, and forget anything gone, so the map cannot grow
  // forever with names nothing points at any more.
  for (const tag of tags) {
    if (!colors[tag]) colors[tag] = nextColor(Object.values(colors));
  }
  for (const tag of Object.keys(colors)) {
    if (!tags.includes(tag)) delete colors[tag];
  }

  // Descriptions follow the same rule: forget the ones whose project is gone,
  // so the map cannot fill up with names nothing points at.
  const descriptions = { ...(project?.tagDescriptions ?? {}) };
  for (const tag of Object.keys(descriptions)) {
    if (!tags.includes(tag)) delete descriptions[tag];
  }

  await db.projects.update(id, {
    tags,
    tagColors: colors,
    tagDescriptions: descriptions,
    updatedAt: now()
  });
}

/** Describe one project inside an era, or clear the description. */
export async function setProjectTagDescription(
  id: string,
  tag: string,
  text: string
): Promise<void> {
  const project = await db.projects.get(id);
  if (!project) return;
  const next = { ...(project.tagDescriptions ?? {}) };
  const trimmed = text.trim();
  if (trimmed) next[tag] = trimmed;
  else delete next[tag];
  await db.projects.update(id, { tagDescriptions: next, updatedAt: now() });
}

/** Recolour one project inside an era. */
export async function setProjectTagColor(id: string, tag: string, color: string): Promise<void> {
  const project = await db.projects.get(id);
  if (!project) return;
  await db.projects.update(id, {
    tagColors: { ...(project.tagColors ?? {}), [tag]: color },
    updatedAt: now()
  });
}

/**
 * Removing a section unfiles its to-dos rather than deleting them. Losing work
 * because a label was tidied away is exactly the kind of thing that makes a
 * store untrustworthy, and trustworthiness is the whole product.
 */
export async function removeProjectTag(projectId: string, tag: string): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) return;
  await setProjectTags(projectId, (project.tags ?? []).filter((t) => t !== tag));

  const at = now();

  const todos = (await db.todos.where('projectId').equals(projectId).toArray())
    .filter((t) => !t.deletedAt && t.tag === tag);
  await Promise.all(todos.map((t) => db.todos.update(t.id, { tag: undefined, updatedAt: at })));

  const memos = (await db.memos.where('projectId').equals(projectId).toArray())
    .filter((m) => !m.deletedAt && m.tag === tag);
  await Promise.all(memos.map((m) => db.memos.update(m.id, { tag: undefined, updatedAt: at })));

  // The note is deliberately left attached to the removed name rather than
  // merged into the project's own note, which would overwrite it. Recreate the
  // section with the same name and the lyrics come straight back.
}

/**
 * Renaming carries everything filed under the section with it — to-dos, its
 * note and its recordings — so a typo fix is not a scattering. Missing any one
 * of the three would silently detach a song's lyrics from the song.
 */
export async function renameProjectTag(
  projectId: string,
  from: string,
  to: string
): Promise<void> {
  const next = to.trim();
  const project = await db.projects.get(projectId);
  if (!project || !next || from === next) return;

  // Carry the colour over BEFORE the tags change: setProjectTags drops colours
  // for names that are gone, so doing it after would recolour the project at
  // random on rename and undo the whole point of it having a colour.
  const colors = { ...(project.tagColors ?? {}) };
  const notes = { ...(project.tagDescriptions ?? {}) };
  if (colors[from] || notes[from]) {
    if (colors[from]) {
      colors[next] = colors[from];
      delete colors[from];
    }
    if (notes[from]) {
      notes[next] = notes[from];
      delete notes[from];
    }
    await db.projects.update(projectId, {
      tagColors: colors,
      tagDescriptions: notes,
      updatedAt: now()
    });
  }
  await setProjectTags(projectId, (project.tags ?? []).map((t) => (t === from ? next : t)));

  const at = now();

  const todos = (await db.todos.where('projectId').equals(projectId).toArray())
    .filter((t) => !t.deletedAt && t.tag === from);
  await Promise.all(todos.map((t) => db.todos.update(t.id, { tag: next, updatedAt: at })));

  const memos = (await db.memos.where('projectId').equals(projectId).toArray())
    .filter((m) => !m.deletedAt && m.tag === from);
  await Promise.all(memos.map((m) => db.memos.update(m.id, { tag: next, updatedAt: at })));

  // Blocks and shopping move too. Miss either and renaming a project silently
  // strands its schematic photo or its parts list on a name nothing shows.
  const widgets = (await db.widgets.where('projectId').equals(projectId).toArray())
    .filter((w) => !w.deletedAt && w.tag === from);
  await Promise.all(widgets.map((w) => db.widgets.update(w.id, { tag: next, updatedAt: at })));

  const buys = (await db.buyItems.where('projectId').equals(projectId).toArray())
    .filter((b) => !b.deletedAt && b.tag === from);
  await Promise.all(buys.map((b) => db.buyItems.update(b.id, { tag: next, updatedAt: at })));

  await moveNoteSection(projectId, from, next);
}

// ------------------------------------------------------------------- todos

/**
 * The 5-second capture rule (spec principle 1) is enforced here: `title` is the
 * only required argument. Everything else is optional, forever, and nothing in
 * the UI may demand it later.
 */
export async function createTodo(
  title: string,
  opts: {
    projectId?: string; tag?: string; energy?: Energy; date?: string; notes?: string;
  } = {}
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

export async function createIdea(
  text: string,
  opts: { projectId?: string; group?: string } = {}
): Promise<string> {
  const i: Idea = stamp({ text: text.trim(), ...opts });
  await db.ideas.add(i);
  return i.id;
}

/**
 * File an idea under a project, or take it back out.
 *
 * This is the axis that matters. An idea starts unfiled — you had it on a walk
 * and there may be no project for it yet — and moves to a project when one
 * exists to hold it. Projects are the app's only grouping anywhere else, and
 * having a second, invented one just for ideas was a competing hierarchy of
 * exactly the kind that killed the previous system.
 */
export async function setIdeaProject(id: string, projectId?: string): Promise<void> {
  await db.ideas.update(id, { projectId, updatedAt: now() });
}

/** Read, watched, listened to. A want can be finished without ever having been
 *  a task, and finishing one is a win (spec 6). */
export async function toggleIdeaDone(id: string, done = true): Promise<void> {
  await db.ideas.update(id, { doneAt: done ? now() : undefined, updatedAt: now() });
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
  opts: {
    url?: string;
    priceCents?: number;
    currency?: string;
    projectId?: string;
    /** The project inside the era, as Todo.tag. */
    tag?: string;
    qty?: number;
    image?: string;
  } = {}
): Promise<string> {
  const b: BuyItem = stamp({ name: name.trim(), currency: 'EUR', ...opts });
  await db.buyItems.add(b);
  return b.id;
}

export async function updateBuyItem(id: string, patch: Partial<BuyItem>): Promise<void> {
  await db.buyItems.update(id, { ...patch, updatedAt: now() });
}

/** Needed soon rather than eventually. A flag, never a scale — see BuyItem. */
export async function toggleBuyNeeded(id: string, needed = true): Promise<void> {
  await db.buyItems.update(id, { needed: needed || undefined, updatedAt: now() });
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

async function recordStateChange(habitId: string, state: HabitState, at: string): Promise<void> {
  const change: HabitStateChange = stamp({ habitId, state, at });
  await db.habitStateChanges.add(change);
}

export async function createHabit(name: string): Promise<string> {
  const state: HabitState = 'active';
  const at = now();
  const h: Habit = stamp({ name: name.trim(), state, stateChangedAt: at });
  await db.habits.add(h);
  await recordStateChange(h.id, state, at);
  return h.id;
}

/**
 * Always an explicit user action. The app never infers dormancy from silence —
 * that is exactly the judgement the old habit tracker made and lost trust over.
 */
export async function setHabitState(id: string, state: HabitState): Promise<void> {
  const existing = await db.habits.get(id);
  // Re-selecting the current state is a no-op, not a new cycle. Otherwise
  // fiddling with the dropdown would manufacture a history of changes that
  // never happened.
  if (!existing || existing.state === state) return;

  const t = now();
  await db.habits.update(id, { state, stateChangedAt: t, updatedAt: t });
  await recordStateChange(id, state, t);
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

/**
 * The bottom-of-screen box. No fields, no project, no confirmation.
 *
 * It writes an unfiled Idea rather than its own Capture row. The two were
 * always the same thing — a thought you have not decided about yet — and
 * keeping them apart meant the inbox needed two sorting buttons where one
 * ("make it a to-do") does the job. Living unfiled is still a valid resting
 * state; it just has one fewer tab to live in.
 */
export async function capture(text: string): Promise<string> {
  return createIdea(text);
}

// ------------------------------------------------------------------- notes

/**
 * A project's note, or one of its sections'.
 *
 * `section` undefined is the project's own note — the one that was there before
 * sections existed. A named section gets its own, which is what makes "lyrics
 * for this song, separate from lyrics for the next" work.
 *
 * Matched in code rather than by a compound index; see the version 6 comment in
 * db.ts for why that index would have quietly excluded every existing note.
 */
const sameSection = (a?: string, b?: string) => (a ?? '') === (b ?? '');

export async function getNote(projectId: string, section?: string): Promise<Note | undefined> {
  const rows = await db.notes.where('projectId').equals(projectId).toArray();
  return rows.find((n) => !n.deletedAt && sameSection(n.tag, section));
}

export async function saveNote(
  projectId: string,
  markdown: string,
  section?: string
): Promise<void> {
  const existing = await getNote(projectId, section);
  if (existing) {
    await db.notes.update(existing.id, { markdown, updatedAt: now() });
  } else {
    const n: Note = stamp({ projectId, markdown, tag: section });
    await db.notes.add(n);
  }
}

/** Renaming a section has to bring its note along, or the lyrics detach from
 *  the song they belong to. */
export async function moveNoteSection(
  projectId: string,
  from: string,
  to?: string
): Promise<void> {
  const note = await getNote(projectId, from);
  if (note) await db.notes.update(note.id, { tag: to, updatedAt: now() });
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
