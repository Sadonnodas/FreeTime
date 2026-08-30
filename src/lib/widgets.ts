import { db } from './db';
import type { Widget, WidgetKind, WidgetLink, Todo } from './types';
import { uid, now, today } from './store';
import { resizeImage } from './images';

/**
 * Project widgets — the configurable blocks above a project's three tabs.
 */

export const WIDGET_KINDS: { kind: WidgetKind; label: string; hint: string }[] = [
  { kind: 'countdown', label: 'Countdown', hint: 'Days until a date that matters' },
  { kind: 'note', label: 'Pinned note', hint: 'A few lines kept in view' },
  { kind: 'activity', label: 'Activity', hint: 'What you closed, week by week' },
  { kind: 'counts', label: 'Counts', hint: 'Open, and closed this month' },
  { kind: 'links', label: 'Links', hint: 'Things you keep opening' },
  { kind: 'image', label: 'Photo', hint: 'A picture of the thing' },
  { kind: 'memos', label: 'Recordings', hint: 'Voice memos filed here' }
];

export async function widgetsFor(projectId: string): Promise<Widget[]> {
  const all = await db.widgets.where('projectId').equals(projectId).toArray();
  return all.filter((w) => !w.deletedAt).sort((a, b) => a.order - b.order);
}

export async function addWidget(
  projectId: string,
  kind: WidgetKind,
  tag?: string
): Promise<string> {
  const existing = await widgetsFor(projectId);
  const t = now();
  const w: Widget = {
    id: uid(),
    projectId,
    tag,
    kind,
    // Wide by default for the kinds that need the room; the rest pair up.
    size:
      kind === 'note' || kind === 'links' || kind === 'image' || kind === 'memos'
        ? 'wide'
        : 'small',
    order: existing.length,
    createdAt: t,
    updatedAt: t
  };
  await db.widgets.add(w);
  return w.id;
}

export async function updateWidget(id: string, patch: Partial<Widget>): Promise<void> {
  await db.widgets.update(id, { ...patch, updatedAt: now() });
}

/** Move a block to another project inside the era, or out to the era itself. */
export async function setWidgetTag(id: string, tag?: string): Promise<void> {
  // Dexie's update() DELETES a property given undefined, which is what we want
  // here: no tag means the block belongs to the era rather than to a project.
  await db.widgets.update(id, { tag, updatedAt: now() });
}

export async function removeWidget(id: string): Promise<void> {
  await db.widgets.update(id, { deletedAt: now(), updatedAt: now() });
}

/** Swaps a widget with its neighbour and renumbers, so order stays dense. */
export async function moveWidget(id: string, direction: -1 | 1): Promise<void> {
  const widget = await db.widgets.get(id);
  if (!widget) return;

  const siblings = await widgetsFor(widget.projectId);
  const index = siblings.findIndex((w) => w.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= siblings.length) return;

  const reordered = [...siblings];
  [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];

  const t = now();
  await Promise.all(
    reordered.map((w, i) => db.widgets.update(w.id, { order: i, updatedAt: t }))
  );
}

// ------------------------------------------------------------ derived data

/** Whole days from today until `date`. Negative once it has passed. */
export function daysUntil(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y!, m! - 1, d!);
  target.setHours(0, 0, 0, 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Countdown copy.
 *
 * A past date says "12 days ago", never "12 days overdue" — nothing in this
 * app is ever late, and a widget is exactly where that language would creep
 * back in.
 */
export function countdownLabel(date: string): { value: string; caption: string } {
  const days = daysUntil(date);
  if (days === 0) return { value: 'Today', caption: '' };
  if (days === 1) return { value: 'Tomorrow', caption: '' };
  if (days === -1) return { value: 'Yesterday', caption: '' };
  if (days > 0) return { value: String(days), caption: days === 1 ? 'day' : 'days' };
  return { value: String(-days), caption: 'days ago' };
}

/** Completions per week for the last `weeks` weeks, oldest first. */
export async function activityByWeek(projectId: string, weeks = 12): Promise<number[]> {
  const todos = await db.todos.where('projectId').equals(projectId).toArray();
  const done = todos
    .filter((t): t is Todo & { completedAt: string } => !t.deletedAt && !!t.completedAt)
    .map((t) => new Date(t.completedAt).getTime());

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  // Back to the most recent Monday, then back `weeks - 1` further.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);

  const buckets = new Array<number>(weeks).fill(0);
  for (const at of done) {
    const week = Math.floor((at - start.getTime()) / (7 * 86_400_000));
    if (week >= 0 && week < weeks) buckets[week]! += 1;
  }
  return buckets;
}

export interface ProjectCounts {
  open: number;
  closedThisMonth: number;
}

export async function projectCounts(projectId: string): Promise<ProjectCounts> {
  const todos = (await db.todos.where('projectId').equals(projectId).toArray()).filter(
    (t) => !t.deletedAt
  );
  const monthStart = today().slice(0, 7);
  return {
    open: todos.filter((t) => !t.completedAt).length,
    closedThisMonth: todos.filter((t) => t.completedAt?.slice(0, 7) === monthStart).length
  };
}

/** The next dated, still-open to-do in this project — the countdown's default. */
export async function nextDated(projectId: string): Promise<Todo | undefined> {
  const todos = (await db.todos.where('projectId').equals(projectId).toArray()).filter(
    (t) => !t.deletedAt && !t.completedAt && !!t.date
  );
  return todos.sort((a, b) => a.date!.localeCompare(b.date!))[0];
}

// ----------------------------------------------------------------- images

/** Lives in images.ts now, so project covers can use it too. Re-exported here
 *  because the widget board has always imported it from this module. */
export { resizeImage };

export type { WidgetLink };
