import { db } from './db';
import { indexById, wouldCycle } from './order';
import type {
  Base, Project, Todo, Idea, BuyItem, List, ListItem,
  Habit, HabitLog, Capture, Note, Energy, TimeBucket, ListItemState, HabitState,
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

/**
 * Put an era's projects in the order they were dragged into.
 *
 * Only the ones on screen are dragged — sleeping and finished projects are in
 * lists of their own — so the dragged names go first and every other name
 * keeps its place after them. A PERMUTATION ONLY: names the era does not have
 * are ignored and none is ever dropped, which is why this writes `tags`
 * directly rather than through setProjectTags, whose whole job is to prune.
 * Colours are stored per name, so nothing changes colour by moving.
 */
export async function reorderProjectTags(id: string, dragged: string[]): Promise<void> {
  const project = await db.projects.get(id);
  if (!project) return;
  const current = project.tags ?? [];
  const first = dragged.filter((t, i) => current.includes(t) && dragged.indexOf(t) === i);
  const tags = [...first, ...current.filter((t) => !first.includes(t))];
  if (tags.join('\u0000') === current.join('\u0000')) return;
  // Pin every colour before the positions move: an era from before colours
  // were stored falls back to POSITION (projectTagColor), and reordering would
  // otherwise repaint it.
  const tagColors = { ...(project.tagColors ?? {}) };
  for (const t of current) {
    if (!tagColors[t]) tagColors[t] = projectTagColor(current, project.tagColors, t);
  }
  await db.projects.update(id, { tags, tagColors, updatedAt: now() });
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

  // And the sleeping list, for the same reason again.
  const sleeping = (project?.sleepingTags ?? []).filter((t) => tags.includes(t));

  // And when each was finished — the same pruning, for the same reason.
  const finished = Object.fromEntries(
    Object.entries(project?.finishedTags ?? {}).filter(([t]) => tags.includes(t))
  );

  await db.projects.update(id, {
    tags,
    tagColors: colors,
    tagDescriptions: descriptions,
    sleepingTags: sleeping,
    finishedTags: finished,
    updatedAt: now()
  });
}

/**
 * Put one project inside an era to sleep, or wake it.
 *
 * Sleeping is a USER's word about their own attention, never the app's guess.
 * Nothing infers it from a gap in activity — that would be the app deciding you
 * had abandoned something, which is the same line habits hold with their three
 * states, and for the same reason.
 *
 * What it changes: the era lists it under "Sleeping" instead of among the live
 * ones, and Free Time stops offering its to-dos. What it does NOT change: the
 * project still opens, still holds everything it held, and every one of its
 * to-dos is still there to be ticked. The app stops SUGGESTING; it never
 * forbids — the same asymmetry a blocked to-do already follows.
 */
export async function setProjectTagSleeping(
  projectId: string,
  tag: string,
  sleeping: boolean
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) return;
  const current = project.sleepingTags ?? [];
  const next = sleeping
    ? current.includes(tag)
      ? current
      : [...current, tag]
    : current.filter((t) => t !== tag);
  await db.projects.update(projectId, { sleepingTags: next, updatedAt: now() });
}

export type MoveResult = 'moved' | 'name-taken' | 'nothing';

/**
 * Move a whole project from one era to another, with everything in it.
 *
 * Needed the moment an era turns out to be the wrong shape — "Music" holding a
 * mixing course, a wedding covers set and twelve songs is four eras wearing one
 * name, and splitting it up should not mean rebuilding every project by hand.
 *
 * CARRIES ALL FIVE KINDS, exactly as renaming does: to-dos, recordings, blocks,
 * shopping and the note. Miss one and it is not deleted, it is invisible, which
 * is worse — the same warning renameProjectTag carries.
 *
 * Refuses rather than merges when the destination already has a project of that
 * name. Two projects called "Mixing" silently becoming one is unrecoverable
 * without knowing which of the two each to-do came from.
 */
/**
 * Finish a project inside an era, or take that back.
 *
 * The project-sized tick. It touches NOTHING inside the project: a to-do still
 * open when the closet is done stays open and untouched, rather than being
 * ticked on your behalf — the wins feed is made of things that were actually
 * done, and bulk-completing would fill it with things that were not. Free Time
 * simply stops suggesting them, as it does for a sleeping project.
 *
 * Finishing also takes it out of sleep: finished and set aside are different
 * things to say about a project, and it cannot be both.
 */
export async function setProjectTagFinished(
  projectId: string,
  tag: string,
  finished: boolean
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project || !(project.tags ?? []).includes(tag)) return;
  const next = { ...(project.finishedTags ?? {}) };
  if (finished) next[tag] = next[tag] ?? now();
  else delete next[tag];
  await db.projects.update(projectId, {
    finishedTags: next,
    sleepingTags: finished
      ? (project.sleepingTags ?? []).filter((t) => t !== tag)
      : project.sleepingTags ?? [],
    updatedAt: now()
  });
}

export async function moveProjectTag(
  fromEraId: string,
  tag: string,
  toEraId: string
): Promise<MoveResult> {
  if (fromEraId === toEraId) return 'nothing';
  const [from, to] = await Promise.all([
    db.projects.get(fromEraId),
    db.projects.get(toEraId)
  ]);
  if (!from || !to || !(from.tags ?? []).includes(tag)) return 'nothing';
  if ((to.tags ?? []).includes(tag)) return 'name-taken';

  // Colour, description and sleep carry over BEFORE the tags change, because
  // setProjectTags prunes all three for names it cannot see — the same trap
  // renameProjectTag documents.
  const colour = from.tagColors?.[tag];
  const description = from.tagDescriptions?.[tag];
  const asleep = (from.sleepingTags ?? []).includes(tag);
  const finishedAt = from.finishedTags?.[tag];

  await db.projects.update(toEraId, {
    finishedTags: {
      ...(to.finishedTags ?? {}),
      ...(finishedAt ? { [tag]: finishedAt } : {})
    },
    tagColors: { ...(to.tagColors ?? {}), ...(colour ? { [tag]: colour } : {}) },
    tagDescriptions: {
      ...(to.tagDescriptions ?? {}),
      ...(description ? { [tag]: description } : {})
    },
    sleepingTags: asleep ? [...(to.sleepingTags ?? []), tag] : (to.sleepingTags ?? []),
    updatedAt: now()
  });

  await setProjectTags(toEraId, [...(to.tags ?? []), tag]);
  await setProjectTags(fromEraId, (from.tags ?? []).filter((t) => t !== tag));

  const at = now();
  const move = async (
    table: 'todos' | 'memos' | 'widgets' | 'buyItems' | 'ideas'
  ): Promise<void> => {
    const rows = (await db[table].where('projectId').equals(fromEraId).toArray()).filter(
      (r) => !r.deletedAt && (r as { tag?: string }).tag === tag
    );
    await Promise.all(
      rows.map((r) => db[table].update(r.id, { projectId: toEraId, updatedAt: at }))
    );
  };
  await Promise.all([
    move('todos'), move('memos'), move('widgets'), move('buyItems'), move('ideas')
  ]);

  // The note is one row per project per section, so it moves rather than merges.
  const note = (await db.notes.where('projectId').equals(fromEraId).toArray()).find(
    (n) => !n.deletedAt && n.tag === tag
  );
  if (note) await db.notes.update(note.id, { projectId: toEraId, updatedAt: at });

  return 'moved';
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

  // Ideas go back to the era, like to-dos, so they stay visible in its overview.
  const ideas = (await db.ideas.where('projectId').equals(projectId).toArray())
    .filter((i) => !i.deletedAt && i.tag === tag);
  await Promise.all(ideas.map((i) => db.ideas.update(i.id, { tag: undefined, updatedAt: at })));

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
  const finished = { ...(project.finishedTags ?? {}) };
  // Sleep and finished carry too. Sleep USED to be lost here: setProjectTags
  // prunes the sleeping list for names it cannot see, so renaming a sleeping
  // project quietly woke it up.
  const sleeping = (project.sleepingTags ?? []).map((t) => (t === from ? next : t));
  if (colors[from]) {
    colors[next] = colors[from];
    delete colors[from];
  }
  if (notes[from]) {
    notes[next] = notes[from];
    delete notes[from];
  }
  if (finished[from]) {
    finished[next] = finished[from];
    delete finished[from];
  }
  await db.projects.update(projectId, {
    tagColors: colors,
    tagDescriptions: notes,
    sleepingTags: sleeping,
    finishedTags: finished,
    updatedAt: now()
  });
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

  // And ideas — the sixth kind. The same warning as the rest: miss it and the
  // thoughts behind a project stay on a name nothing shows.
  const ideas = (await db.ideas.where('projectId').equals(projectId).toArray())
    .filter((i) => !i.deletedAt && i.tag === from);
  await Promise.all(ideas.map((i) => db.ideas.update(i.id, { tag: next, updatedAt: at })));

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
    projectId?: string; tag?: string; energy?: Energy; takes?: TimeBucket;
    date?: string; notes?: string; after?: string;
    /** A photo taken while writing it, already resized (THUMB_EDGE). */
    image?: string;
    /** The page it came from (clip.ts). */
    url?: string;
  } = {}
): Promise<string> {
  const t: Todo = stamp({ title: title.trim(), ...opts });
  await db.todos.add(t);
  return t.id;
}

export async function updateTodo(id: string, patch: Partial<Todo>): Promise<void> {
  await db.todos.update(id, { ...patch, updatedAt: now() });
}

/**
 * Say which to-do this one has to wait for, or clear it.
 *
 * The picker only offers links that cannot close a loop, so the guard here is a
 * backstop — for the assistant, for an import, and for anything written on
 * another device. It refuses rather than throws: a refused link leaves the
 * to-do exactly as it was, which is the safe end of getting this wrong.
 */
export async function setTodoAfter(id: string, afterId?: string): Promise<boolean> {
  if (afterId) {
    const byId = indexById((await db.todos.toArray()).filter(alive));
    if (wouldCycle(id, afterId, byId)) return false;
  }
  // Dexie's update() with undefined DELETES the property, which is what clearing
  // a link has to do — an `after` left pointing anywhere would keep blocking.
  await db.todos.update(id, { after: afterId, updatedAt: now() });
  return true;
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
  opts: { projectId?: string; tag?: string; group?: string; url?: string } = {}
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
/** Fixing the wording of a thought. Same reason to-dos can be renamed: it was
 *  typed in five seconds and five seconds is not long enough to be right. */
export async function updateIdea(id: string, patch: Partial<Idea>): Promise<void> {
  await db.ideas.update(id, { ...patch, updatedAt: now() });
}

/**
 * Where an idea lives: an era, and optionally a project inside it.
 *
 * Changing the era clears the project, because a project name belongs to ONE
 * era — "Mixing" carried from Music into Garden would point at nothing, which is
 * the invisible-not-deleted failure renaming warns about.
 */
export async function setIdeaProject(id: string, projectId?: string, tag?: string): Promise<void> {
  await db.ideas.update(id, { projectId, tag: projectId ? tag : undefined, updatedAt: now() });
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
  const todoId = await createTodo(idea.text, { projectId: idea.projectId, tag: idea.tag });
  await db.ideas.update(ideaId, { promotedToTodoId: todoId, updatedAt: now() });
  return todoId;
}

export type IdeaToProjectResult = 'started' | 'name-taken' | 'nothing';

/**
 * An idea grows into a project of its own.
 *
 * Asked for alongside ideas-in-projects: *"An idea can become a to do or even a
 * project."* Making a to-do was already one tap; this is its bigger sibling.
 *
 * THE NEW PROJECT IS A SIBLING, NEVER A CHILD. An idea filed inside the
 * "FreeTime" project that becomes "Ear-training game" creates that project
 * next to FreeTime in the same era. A project inside a project is the third
 * level the depth rule exists to forbid, and an idea turning into one is
 * precisely how that level would sneak in.
 *
 * The idea is not consumed. It is filed INTO the project it started, so the
 * original thought is the first thing inside it, and marked with when that
 * happened. If the name was shortened from the idea's text — "Ear-training
 * game" from three sentences about intervals — the full text becomes the
 * project's description, unless it already has one: the long version is the
 * best line anyone is going to write about why this project exists.
 *
 * Refuses rather than merging when the era already has a project by that name,
 * for the reason `moveProjectTag` gives: two things silently becoming one
 * cannot be undone.
 */
export async function ideaToProject(
  ideaId: string,
  eraId: string,
  name: string
): Promise<IdeaToProjectResult> {
  const trimmed = name.trim();
  const [idea, era] = await Promise.all([db.ideas.get(ideaId), db.projects.get(eraId)]);
  if (!idea || idea.deletedAt || !era || !trimmed) return 'nothing';
  if ((era.tags ?? []).includes(trimmed)) return 'name-taken';

  // A new name gets its colour from the era's palette here, as any project does.
  await setProjectTags(eraId, [...(era.tags ?? []), trimmed]);

  if (trimmed !== idea.text.trim()) {
    const fresh = await db.projects.get(eraId);
    if (!fresh?.tagDescriptions?.[trimmed]) {
      await db.projects.update(eraId, {
        tagDescriptions: { ...(fresh?.tagDescriptions ?? {}), [trimmed]: idea.text.trim() },
        updatedAt: now()
      });
    }
  }

  const at = now();
  await db.ideas.update(ideaId, {
    projectId: eraId,
    tag: trimmed,
    becameProjectAt: at,
    updatedAt: at
  });
  return 'started';
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

/**
 * Put habits in the order they were dragged into. Every habit named gets its
 * position, so the order survives a sync as a whole rather than half-applied.
 */
export async function reorderHabits(ids: string[]): Promise<void> {
  const at = now();
  await db.transaction('rw', db.habits, async () => {
    for (const [order, id] of ids.entries()) await db.habits.update(id, { order, updatedAt: at });
  });
}

export async function renameHabit(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.habits.update(id, { name: trimmed, updatedAt: now() });
}

export async function setHabitColor(id: string, color: string): Promise<void> {
  await db.habits.update(id, { color, updatedAt: now() });
}

/**
 * How often a habit is meant to come round: a number of times a week, or
 * undefined for "most days", which is what every habit was before this.
 *
 * `undefined` really removes the field (Dexie's update deletes a property set
 * to undefined — see memos.ts), which is what we want: a habit back on "most
 * days" must not carry a stale rhythm that another device would read.
 */
/** What language dictation listens for. Device-local, like every setting. */
export async function saveDictationLang(dictationLang: string): Promise<void> {
  const existing = await db.settings.get('settings');
  const at = now();
  if (existing) await db.settings.update('settings', { dictationLang, updatedAt: at });
  else await db.settings.add({ id: 'settings', dictationLang, updatedAt: at });
}

export async function setHabitRhythm(id: string, timesPerWeek?: number): Promise<void> {
  await db.habits.update(id, { timesPerWeek, updatedAt: now() });
}

export async function createHabit(name: string): Promise<string> {
  const state: HabitState = 'active';
  const at = now();
  // The first palette colour no other habit is wearing, so a new one stands
  // apart from the ones already on Today.
  const used = new Set(
    (await db.habits.toArray()).filter((x) => !x.deletedAt && x.color).map((x) => x.color)
  );
  const color = PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[used.size % PROJECT_COLORS.length];
  const h: Habit = stamp({ name: name.trim(), state, stateChangedAt: at, color });
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

/**
 * Add text to the END of a project's (or an era's) notes, never replacing —
 * the append_note rule: a clipped paragraph must not overwrite a page.
 */
export async function appendToNote(eraId: string, text: string, tag?: string): Promise<void> {
  const era = await db.projects.get(eraId);
  const section = tag && (era?.tags ?? []).includes(tag) ? tag : undefined;
  const existing = (await getNote(eraId, section))?.markdown ?? '';
  await saveNote(eraId, existing.trim() ? `${existing.trimEnd()}\n\n${text}` : text, section);
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

// ------------------------------------------------------------ quick notes

export async function createQuickNote(text = ''): Promise<string> {
  const n = stamp({ text });
  await db.quickNotes.add(n);
  return n.id;
}

export async function updateQuickNote(id: string, text: string): Promise<void> {
  await db.quickNotes.update(id, { text, updatedAt: now() });
}

/**
 * A quick note moved into a project's (or an era's) notes: APPENDED, never
 * replacing, the same rule as the assistant's append_note — a measurement must
 * not overwrite a page of notes. The quick note is then removed, because it
 * has moved rather than been copied; two copies of a number drift apart.
 */
export async function quickNoteToProjectNote(
  noteId: string,
  eraId: string,
  tag?: string
): Promise<boolean> {
  const [note, era] = await Promise.all([db.quickNotes.get(noteId), db.projects.get(eraId)]);
  const text = note?.text.trim();
  if (!note || note.deletedAt || !era || !text) return false;
  const section = tag && (era.tags ?? []).includes(tag) ? tag : undefined;
  const existing = (await getNote(eraId, section))?.markdown ?? '';
  await saveNote(eraId, existing.trim() ? `${existing.trimEnd()}\n\n${text}` : text, section);
  await softDelete('quickNotes', noteId);
  return true;
}

/**
 * A quick note that turned out to be the start of something: a new project in
 * an era, named by the note's first line (or whatever was typed), with the
 * whole note as that project's notes. A SIBLING in the era, like every project
 * — nothing is ever created under anything else. Refuses a name the era
 * already has, including a sleeping or finished one, rather than merging.
 */
export async function quickNoteToProject(
  noteId: string,
  eraId: string,
  name: string
): Promise<'started' | 'name-taken' | 'nothing'> {
  const trimmed = name.trim();
  const [note, era] = await Promise.all([db.quickNotes.get(noteId), db.projects.get(eraId)]);
  if (!note || note.deletedAt || !era || !trimmed) return 'nothing';
  if ((era.tags ?? []).includes(trimmed)) return 'name-taken';
  await setProjectTags(eraId, [...(era.tags ?? []), trimmed]);
  const text = note.text.trim();
  // A note that is only the name has nothing more to keep.
  if (text && text !== trimmed) await saveNote(eraId, text, trimmed);
  await softDelete('quickNotes', noteId);
  return 'started';
}

/**
 * Where a dragged item now sits (rank.ts `placement`). Usually one write — the
 * item that moved — and the whole visible list only when its neighbours left
 * no room.
 */
export async function setRanks(
  table: 'todos' | 'ideas' | 'buyItems',
  writes: { id: string; rank: number }[]
): Promise<void> {
  if (!writes.length) return;
  const at = now();
  const t = db[table] as unknown as { update(k: string, p: object): Promise<number> };
  await db.transaction('rw', db[table], async () => {
    for (const w of writes) await t.update(w.id, { rank: w.rank, updatedAt: at });
  });
}

type SoftDeletable =
  | 'projects' | 'todos' | 'ideas' | 'buyItems'
  | 'lists' | 'listItems' | 'habits' | 'captures' | 'quickNotes';

/** Tombstone, so the delete survives a sync instead of the row resurrecting. */
export async function softDelete(table: SoftDeletable, id: string): Promise<void> {
  const patch = { deletedAt: now(), updatedAt: now() };
  await (db[table] as unknown as { update(k: string, p: object): Promise<number> })
    .update(id, patch);
}
