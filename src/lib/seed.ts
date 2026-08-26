import { db } from './db';
import { createProject } from './store';

/**
 * The starting projects (spec 3.1) — the nine from the Notion export, plus Disc
 * Golf, which is what the user actually spends their free time on and which did
 * not appear anywhere in the old system. That omission is the clearest symptom
 * of the problem this app exists to fix, so it ships in the seed.
 *
 * The old Workstream values (VAEL, Guided Ear Training, Album, ...) are NOT
 * seeded. They become projects only if the user chooses that at import time.
 * Seeding both taxonomies is how the old workspace ended up with two competing
 * hierarchies and 46 unassigned todos.
 */
export const SEED_PROJECTS = [
  'Bearfeet',
  'Music',
  'Studio',
  'Campervan',
  'Crafting',
  'Coding',
  'Family',
  'Personal',
  'Work',
  'Disc Golf'
] as const;

/**
 * Runs once, on an empty database. Guarded by a count check rather than a flag
 * so that clearing the DB in devtools gives a clean start again.
 */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.projects.count();
  if (count > 0) return;
  for (const name of SEED_PROJECTS) {
    await createProject(name);
  }
}
