import { db } from '../db';
import { projectPulses } from '../queries';
import { ago } from '../format';

/**
 * The state digest (spec 7.3).
 *
 * Never send the whole database. Partly cost, mostly quality: a model given
 * 3,000 rows will reason about the wrong forty of them. The digest is what a
 * friend would know about your week — which projects are alive, roughly what
 * is open, what you have actually finished lately.
 *
 * Target is under ~4k tokens, which the caps below hold to comfortably.
 */

const MAX_TODO_TITLES = 150;
const COMPLETION_DAYS = 14;

export interface Digest {
  text: string;
  /** Names the model may refer to, so callers can map an answer back to an id. */
  projects: { id: string; name: string }[];
}

export async function buildDigest(): Promise<Digest> {
  const [pulses, todos, habits] = await Promise.all([
    projectPulses(),
    db.todos.toArray(),
    db.habits.toArray()
  ]);

  const live = todos.filter((t) => !t.deletedAt);
  const open = live.filter((t) => !t.completedAt);

  const since = new Date();
  since.setDate(since.getDate() - COMPLETION_DAYS);
  const sinceIso = since.toISOString();
  const recent = live.filter((t) => t.completedAt && t.completedAt >= sinceIso);

  const lines: string[] = [];

  lines.push('PROJECTS (name — last touched, closed in 30d, open count):');
  for (const p of pulses) {
    lines.push(
      `- ${p.project.name} — touched ${ago(p.lastTouchedAt)}, ${p.closedLast30} closed, ${p.openCount} open`
    );
  }

  // Titles only, grouped by project. Notes and dates are omitted deliberately:
  // they roughly double the size and the model needs neither to rank.
  lines.push('', `OPEN TO-DOS (titles only, up to ${MAX_TODO_TITLES}):`);
  const byProject = new Map<string, string[]>();
  for (const t of open.slice(0, MAX_TODO_TITLES)) {
    const name = pulses.find((p) => p.project.id === t.projectId)?.project.name ?? 'Unassigned';
    (byProject.get(name) ?? byProject.set(name, []).get(name)!).push(t.title);
  }
  for (const [name, titles] of byProject) {
    lines.push(`- ${name}: ${titles.join('; ')}`);
  }
  if (open.length > MAX_TODO_TITLES) {
    lines.push(`(…and ${open.length - MAX_TODO_TITLES} more not listed)`);
  }

  const alive = habits.filter((h) => !h.deletedAt);
  lines.push(
    '',
    'HABITS:',
    `- active: ${alive.filter((h) => h.state === 'active').map((h) => h.name).join(', ') || 'none'}`,
    `- dormant: ${alive.filter((h) => h.state === 'dormant').map((h) => h.name).join(', ') || 'none'}`
  );

  lines.push('', `CLOSED IN THE LAST ${COMPLETION_DAYS} DAYS (${recent.length}):`);
  lines.push(recent.slice(0, 40).map((t) => `- ${t.title}`).join('\n') || '- nothing yet');

  return {
    text: lines.join('\n'),
    projects: pulses.map((p) => ({ id: p.project.id, name: p.project.name }))
  };
}
