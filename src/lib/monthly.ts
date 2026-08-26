import { db } from './db';
import { winsSince, type Win } from './queries';
import { now } from './store';

/**
 * The monthly arrival (spec 6.2).
 *
 * "Last month: 23 things closed across 6 projects." Shown once, on the first
 * open on or after the 1st, and then never again for that month.
 *
 * The whole design constraint is in the spec's last three words: *never nags*.
 * So it is keyed on having been SHOWN, not on having been acknowledged — if it
 * appears and the user swipes it away without reading, that still counts. A
 * summary that waits to be properly received is a summary that comes back, and
 * anything that comes back uninvited is a nag.
 */

export interface MonthlySummary {
  /** YYYY-MM of the month being summarised. */
  month: string;
  label: string;
  wins: Win[];
  projectCount: number;
}

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Null when there is nothing to say, or it has already been shown this month. */
export async function pendingMonthlySummary(): Promise<MonthlySummary | null> {
  const settings = await db.settings.get('settings');
  const thisMonth = ym(new Date());
  if (settings?.lastMonthlySummaryShown === thisMonth) return null;

  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  start.setMonth(start.getMonth() - 1);

  const all = await winsSince(start.toISOString());
  const wins = all.filter((w) => w.at < end.toISOString());

  // An empty month is not worth announcing. Saying "you closed 0 things" would
  // be the app inventing a reproach out of nothing.
  if (!wins.length) {
    await markShown(thisMonth);
    return null;
  }

  const projectIds = new Set(wins.map((w) => w.projectId).filter(Boolean));

  return {
    month: ym(start),
    label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    wins,
    projectCount: projectIds.size
  };
}

export async function markShown(month = ym(new Date())): Promise<void> {
  const existing = await db.settings.get('settings');
  const fields = { lastMonthlySummaryShown: month, updatedAt: now() };
  if (existing) await db.settings.update('settings', fields);
  else await db.settings.add({ id: 'settings', ...fields });
}
