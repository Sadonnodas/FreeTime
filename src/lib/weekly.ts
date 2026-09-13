import { db } from './db';
import { now } from './store';
import { displayTitle } from './memos';
import type { Project } from './types';

/**
 * Last week, looked back on — once, on the first open of a new week.
 *
 * Asked for as *"a week overview that shows your achievements when you open
 * the app"*. It is built as the WEEKLY SIBLING OF THE MONTHLY SUMMARY (spec
 * 6.2) and deliberately not as anything new, because the spec draws a hard line
 * right beside it: "no weekly planning". Planning looks FORWARD and asks what
 * you will get done, which is a target you can miss. This looks BACK and says
 * what happened, which nothing can fall short of. Every rule below is what
 * keeps it on the right side of that line.
 *
 * - **Once a week, not every open.** "When you open the app" read literally is
 *   a screen that greets you every single time, and anything that comes back
 *   uninvited is a nag. First open on or after Monday, then never again that
 *   week — keyed on having been SHOWN, not acknowledged, exactly like the
 *   monthly one and for the same reason.
 * - **Never when the week was empty.** "0 things" would be the app inventing a
 *   reproach out of nothing. An empty week is marked shown and passes silently.
 * - **No comparison with the week before, no trend, no target.** A number you
 *   can be down on is a number you can fail at.
 * - **Habits as days, never "out of 7".** "Guitar, 4 days" describes; "4/7" is
 *   a completion percentage in a trench coat, and those are banned outright.
 *
 * What counts is the definition already argued through for "where the work
 * went" (queries.ts `activityByProject`): a to-do closed, a want finished, a
 * thing bought, a memo recorded. Recording is there on purpose — for someone
 * writing songs, a hummed idea in the car IS the work of that day, and a
 * look-back that only counted ticks would call that week empty.
 *
 * Weeks start on Monday, built from date parts rather than parsed strings, for
 * the reason days.ts gives: `new Date('2026-09-07')` is UTC midnight, which is
 * the previous day anywhere west of Greenwich.
 */

export type WeeklyKind = 'closed' | 'finished' | 'bought' | 'recorded';

export interface WeeklyItem {
  id: string;
  kind: WeeklyKind;
  text: string;
  at: string;
}

export interface WeeklyGroup {
  /** The era, or undefined for things that belong nowhere yet. */
  era?: Pick<Project, 'id' | 'name' | 'tags' | 'tagColors'>;
  /** The project inside the era, if any. */
  tag?: string;
  items: WeeklyItem[];
}

export interface WeeklySummary {
  /** YYYY-MM-DD of the Monday this was shown in — the "shown" key. */
  key: string;
  /** "7 – 13 September", the week being looked back on. */
  label: string;
  total: number;
  groups: WeeklyGroup[];
  habits: { name: string; days: number }[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local midnight on the Monday of the week containing `d`. */
export function weekStart(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay: Sunday is 0. Sunday belongs to the week that began six days ago.
  const back = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - back);
  return start;
}

function weekLabel(from: Date, toExclusive: Date): string {
  const last = new Date(
    toExclusive.getFullYear(),
    toExclusive.getMonth(),
    toExclusive.getDate() - 1
  );
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'long' });
  return from.getMonth() === last.getMonth()
    ? `${from.getDate()} – ${last.getDate()} ${month(last)}`
    : `${from.getDate()} ${month(from)} – ${last.getDate()} ${month(last)}`;
}

/** Null when there is nothing to say, or it has already been shown this week. */
export async function pendingWeeklySummary(today: Date = new Date()): Promise<WeeklySummary | null> {
  const thisMonday = weekStart(today);
  const key = ymd(thisMonday);

  const settings = await db.settings.get('settings');
  if (settings?.lastWeeklySummaryShown === key) return null;

  const lastMonday = new Date(
    thisMonday.getFullYear(),
    thisMonday.getMonth(),
    thisMonday.getDate() - 7
  );
  const fromIso = lastMonday.toISOString();
  const toIso = thisMonday.toISOString();
  const within = (at?: string) => !!at && at >= fromIso && at < toIso;
  const fromDay = ymd(lastMonday);
  const toDay = key;

  const [projects, todos, ideas, buys, memos, habits, logs] = await Promise.all([
    db.projects.toArray(),
    db.todos.toArray(),
    db.ideas.toArray(),
    db.buyItems.toArray(),
    db.memos.toArray(),
    db.habits.toArray(),
    db.habitLogs.toArray()
  ]);
  const live = <T extends { deletedAt?: string }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

  type Placed = WeeklyItem & { projectId?: string; tag?: string };
  const placed: Placed[] = [
    ...live(todos)
      .filter((t) => within(t.completedAt))
      .map((t) => ({
        id: t.id,
        kind: 'closed' as const,
        text: t.title,
        at: t.completedAt!,
        projectId: t.projectId,
        tag: t.tag
      })),
    ...live(ideas)
      .filter((i) => within(i.doneAt))
      .map((i) => ({
        id: i.id,
        kind: 'finished' as const,
        text: i.text,
        at: i.doneAt!,
        projectId: i.projectId
      })),
    ...live(buys)
      .filter((b) => within(b.purchasedAt))
      .map((b) => ({
        id: b.id,
        kind: 'bought' as const,
        text: b.name,
        at: b.purchasedAt!,
        projectId: b.projectId,
        tag: b.tag
      })),
    ...live(memos)
      .filter((m) => within(m.recordedAt))
      .map((m) => ({
        id: m.id,
        kind: 'recorded' as const,
        text: displayTitle(m),
        at: m.recordedAt,
        projectId: m.projectId,
        tag: m.tag
      }))
  ];

  const liveLogs = live(logs);
  const habitDays = live(habits)
    .map((h) => ({
      name: h.name,
      // Distinct days: two logs on one day (two devices, a double tap) are one day.
      days: new Set(
        liveLogs
          .filter((l) => l.habitId === h.id && l.date >= fromDay && l.date < toDay)
          .map((l) => l.date)
      ).size
    }))
    .filter((h) => h.days > 0)
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));

  if (!placed.length && !habitDays.length) {
    // Said nothing, and that counts as having said it — see the header.
    await markWeekShown(key);
    return null;
  }

  const eraById = new Map(projects.filter((p) => !p.deletedAt).map((p) => [p.id, p]));
  const groups = new Map<string, WeeklyGroup>();
  for (const item of placed) {
    // An era deleted since is shown as unfiled rather than dropped: the work
    // happened, even if its container has gone.
    const era = item.projectId ? eraById.get(item.projectId) : undefined;
    const tag = era ? item.tag : undefined;
    const groupKey = JSON.stringify([era?.id ?? null, tag ?? null]);
    const group = groups.get(groupKey) ?? { era, tag, items: [] };
    group.items.push({ id: item.id, kind: item.kind, text: item.text, at: item.at });
    groups.set(groupKey, group);
  }

  const ordered = [...groups.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.at.localeCompare(b.at)) }))
    // Fullest first, unfiled last — the buy list's order, for its reason: the
    // pile with no home is a pile, not a destination.
    .sort(
      (a, b) =>
        (a.era ? 0 : 1) - (b.era ? 0 : 1) ||
        b.items.length - a.items.length ||
        (a.era?.name ?? '').localeCompare(b.era?.name ?? '') ||
        (a.tag ?? '').localeCompare(b.tag ?? '')
    );

  return {
    key,
    label: weekLabel(lastMonday, thisMonday),
    total: placed.length,
    groups: ordered,
    habits: habitDays
  };
}

export async function markWeekShown(key: string = ymd(weekStart(new Date()))): Promise<void> {
  const existing = await db.settings.get('settings');
  const fields = { lastWeeklySummaryShown: key, updatedAt: now() };
  if (existing) await db.settings.update('settings', fields);
  else await db.settings.add({ id: 'settings', ...fields });
}
