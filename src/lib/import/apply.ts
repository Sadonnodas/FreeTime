import { db } from '../db';
import {
  createTodo, createIdea, createBuyItem, createProject, addListItem, createList, now
} from '../store';
import { activeProjects } from '../queries';
import type { Candidate, Target } from './notion';

/**
 * Writing an import into the store (spec 9).
 *
 * Everything goes through store.ts like any other write, so imported records
 * sync exactly like typed ones.
 */

/**
 * What to do with a project name found in the export.
 *
 * This exists because of the spec's central diagnosis: the old workspace ran
 * two competing taxonomies, Projects AND Workstreams, and neither replaced the
 * other — 46 of 112 to-dos ended up with no workstream at all. The export's
 * Workstream values (VAEL, Album, Gigs, Health…) must therefore either become
 * real projects or be dropped, decided here, at import time. What they must not
 * do is quietly recreate a second hierarchy.
 */
export type ProjectChoice =
  | { kind: 'existing'; projectId: string }
  | { kind: 'create' }
  | { kind: 'drop' };

export type ProjectDecisions = Record<string, ProjectChoice>;

/** Distinct non-empty project names in the candidates, in first-seen order. */
export function projectNamesIn(candidates: Candidate[]): string[] {
  const seen: string[] = [];
  for (const c of candidates) {
    const n = c.projectName?.trim();
    if (n && !seen.includes(n)) seen.push(n);
  }
  return seen;
}

/**
 * Proposes a decision per name: match an existing project case-insensitively,
 * otherwise default to DROP.
 *
 * Defaulting to drop rather than create is deliberate. Auto-creating a project
 * per workstream is how the old system grew nine projects holding mostly
 * boilerplate; making the user opt in to each one is the "forced re-entry is a
 * useful filter" idea from spec 9, applied to the taxonomy itself.
 */
export async function proposeDecisions(names: string[]): Promise<ProjectDecisions> {
  const projects = await activeProjects();
  const out: ProjectDecisions = {};
  for (const name of names) {
    const match = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
    out[name] = match ? { kind: 'existing', projectId: match.id } : { kind: 'drop' };
  }
  return out;
}

async function resolveProjectId(
  name: string | undefined,
  decisions: ProjectDecisions,
  created: Map<string, string>
): Promise<string | undefined> {
  const key = name?.trim();
  if (!key) return undefined;

  const choice = decisions[key];
  if (!choice || choice.kind === 'drop') return undefined;
  if (choice.kind === 'existing') return choice.projectId;

  // Create once per name, however many rows reference it.
  const already = created.get(key);
  if (already) return already;
  const id = await createProject(key);
  created.set(key, id);
  return id;
}

export interface ApplyResult {
  written: number;
  projectsCreated: string[];
}

export async function applyImport(
  candidates: Candidate[],
  target: Target,
  decisions: ProjectDecisions,
  opts: { listId?: string; keepCompleted?: boolean } = {}
): Promise<ApplyResult> {
  const created = new Map<string, string>();
  let written = 0;

  for (const c of candidates) {
    const projectId = await resolveProjectId(c.projectName, decisions, created);

    if (target === 'todo') {
      const id = await createTodo(c.title, {
        projectId,
        energy: c.energy,
        date: c.date,
        notes: c.notes
      });
      // An already-done row is imported as closed, not skipped. Completed items
      // are never hidden (principle 2), and a finished thing showing up in the
      // wins feed is the whole point of keeping it.
      if (c.done && opts.keepCompleted !== false) {
        await db.todos.update(id, { completedAt: now(), updatedAt: now() });
      }
    } else if (target === 'buy') {
      await createBuyItem(c.title, { url: c.url, priceCents: c.priceCents, projectId });
    } else if (target === 'idea') {
      await createIdea(c.title, { projectId });
    } else {
      const listId = opts.listId ?? (await createList('Imported'));
      await addListItem(listId, c.title, c.url);
    }
    written++;
  }

  return { written, projectsCreated: [...created.keys()] };
}

/**
 * A markdown page imported as a project note (spec 9 — the Optreden Ardooie
 * setlist, the single richest page in the export, belongs in Bearfeet's notes).
 * Appends rather than replaces, so importing twice cannot erase existing text.
 */
export async function importNote(projectId: string, markdown: string): Promise<void> {
  const existing = await db.notes.where('projectId').equals(projectId).first();
  const body = markdown.trim();
  if (!body) return;

  if (existing) {
    await db.notes.update(existing.id, {
      markdown: `${existing.markdown.trim()}\n\n---\n\n${body}`.trim(),
      updatedAt: now()
    });
  } else {
    const t = now();
    await db.notes.add({
      id: crypto.randomUUID(),
      projectId,
      markdown: body,
      createdAt: t,
      updatedAt: t
    });
  }
}
