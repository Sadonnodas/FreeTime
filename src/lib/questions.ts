import { db } from './db';
import type { Project } from './types';
import { projectPulses } from './queries';
import { ago } from './format';
import { now } from './store';

/**
 * Free Time questions (spec 5.1).
 *
 * Two are always asked; beyond those, 1-2 rotate so the flow doesn't feel
 * identical every time. Phase 4 lets Gemini generate the rotating ones from app
 * state — this file is the static fallback the spec requires for offline and
 * no-key operation, and it stays the path most people hit most of the time.
 *
 * A few of these are templated from real pulse data, so even without a model
 * the rotation can ask something specific rather than generic. That is the
 * whole point of the spec's examples: "You haven't touched Campervan in six
 * weeks" lands; "How are you feeling?" does not.
 */

export interface RotatingQuestion {
  id: string;
  text: string;
  options: string[];
  /** project_pull answers feed the pull slot; the rest are flavour for now. */
  mapsTo: 'project_pull' | 'mood' | 'freeform';
  /** Present when an option maps to a real project. Parallel to `options`. */
  optionProjectIds?: (string | undefined)[];
}

const NO_REPEAT_DAYS = 7;

/** Generic pool — always available, no state required. */
const STATIC_POOL: Omit<RotatingQuestion, 'optionProjectIds'>[] = [
  {
    id: 'nagging',
    text: 'Anything nagging at you that you keep not doing?',
    options: ['Yes, and I know what', 'Yes, vaguely', 'No'],
    mapsTo: 'mood'
  },
  {
    id: 'finish-or-start',
    text: 'Want to finish something, or start something?',
    options: ['Finish', 'Start', 'Either'],
    mapsTo: 'mood'
  },
  {
    id: 'hands-or-head',
    text: 'Hands or head today?',
    options: ['Hands', 'Head', 'Neither, really'],
    mapsTo: 'mood'
  },
  {
    id: 'alone-or-around',
    text: 'On your own, or around other people?',
    options: ['On my own', 'Around people'],
    mapsTo: 'mood'
  },
  {
    id: 'outside',
    text: 'Do you want to be outside?',
    options: ['Yes', 'Not fussed', 'No'],
    mapsTo: 'mood'
  },
  {
    id: 'owe-yourself',
    text: 'Is there something you owe yourself right now?',
    options: ['Yes', 'No idea', 'No'],
    mapsTo: 'mood'
  },
  {
    id: 'small-or-real',
    text: 'Something small and satisfying, or something that actually moves?',
    options: ['Small and satisfying', 'Something that moves', 'Surprise me'],
    mapsTo: 'mood'
  },
  {
    id: 'yesterday',
    text: 'Still carrying anything from yesterday?',
    options: ['Yes', 'No'],
    mapsTo: 'mood'
  }
];

const PULL_WORDINGS = [
  'What do you secretly wish you were working on?',
  'If nothing else existed, where would you go?',
  "What's actually pulling at you?",
  'Where would you drift if nobody asked?'
];

async function history(): Promise<Record<string, string>> {
  const s = await db.settings.get('settings');
  return s?.questionHistory ?? {};
}

async function remember(ids: string[]): Promise<void> {
  const s = await db.settings.get('settings');
  const t = now();
  const questionHistory = { ...(s?.questionHistory ?? {}) };
  for (const id of ids) questionHistory[id] = t;
  if (s) {
    await db.settings.update('settings', { questionHistory, updatedAt: t });
  } else {
    await db.settings.add({ id: 'settings', questionHistory, updatedAt: t });
  }
}

function seenRecently(hist: Record<string, string>, id: string): boolean {
  const at = hist[id];
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < NO_REPEAT_DAYS * 86_400_000;
}

/**
 * The pull question. Always asked, because the pull slot depends on it — but
 * the wording rotates so it doesn't read like a form field.
 *
 * Options are the liveliest projects plus an explicit out. "Nothing in
 * particular" has to be there: forcing a choice would make this a required
 * field, and required fields are what killed the last system.
 */
export async function buildPullQuestion(hist?: Record<string, string>): Promise<RotatingQuestion> {
  const h = hist ?? (await history());
  const pulses = await projectPulses();

  const fresh = PULL_WORDINGS.filter((_, i) => !seenRecently(h, `pull-${i}`));
  const idx = PULL_WORDINGS.indexOf(fresh[0] ?? PULL_WORDINGS[0]!);

  // Only offer projects with something open — an empty project is a dead end.
  const offerable = pulses
    .filter((p) => p.openCount > 0)
    .sort((a, b) => (b.lastTouchedAt ?? '').localeCompare(a.lastTouchedAt ?? ''))
    .slice(0, 5);

  return {
    id: `pull-${idx}`,
    text: PULL_WORDINGS[idx]!,
    mapsTo: 'project_pull',
    options: [...offerable.map((p) => p.project.name), 'Nothing in particular'],
    optionProjectIds: [...offerable.map((p) => p.project.id), undefined]
  };
}

/**
 * State-aware questions, built from pulse data rather than a model. Only
 * returned when the state actually warrants them — asking "is that on purpose?"
 * about a project touched yesterday would be nonsense.
 */
async function stateQuestions(): Promise<RotatingQuestion[]> {
  const pulses = await projectPulses();
  const out: RotatingQuestion[] = [];

  const stale = pulses
    .filter((p) => p.openCount > 0 && p.lastTouchedAt)
    .filter((p) => Date.now() - new Date(p.lastTouchedAt!).getTime() > 30 * 86_400_000)
    .sort((a, b) => a.lastTouchedAt!.localeCompare(b.lastTouchedAt!));

  if (stale[0]) {
    const p = stale[0];
    out.push({
      id: `stale-${p.project.id}`,
      text: `You haven't touched ${p.project.name} in ${ago(p.lastTouchedAt)} — is that on purpose?`,
      // "On purpose" is a real, respectable answer. The app does not get to
      // decide that a quiet project is a failing one.
      options: ['On purpose', 'Not really', "Hadn't noticed"],
      mapsTo: 'mood'
    });
  }

  const busiest = [...pulses].sort((a, b) => b.openCount - a.openCount)[0];
  if (busiest && busiest.openCount >= 8) {
    out.push({
      id: `piled-${busiest.project.id}`,
      text: `${busiest.project.name} has ${busiest.openCount} open. Want to make a dent, or leave it?`,
      options: ['Make a dent', 'Leave it'],
      mapsTo: 'mood'
    });
  }

  return out;
}

/**
 * Picks the rotating questions for one run: the pull question, plus one other
 * that hasn't been shown in the last 7 days. State-aware ones are preferred
 * over generic ones when they apply.
 */
export async function pickRotating(): Promise<RotatingQuestion[]> {
  const h = await history();

  const pull = await buildPullQuestion(h);
  const stateful = (await stateQuestions()).filter((q) => !seenRecently(h, q.id));
  const generic = STATIC_POOL.filter((q) => !seenRecently(h, q.id));

  // If everything has been seen recently, fall back to the full pool rather
  // than showing nothing — the 7-day rule is a preference, not a hard gate.
  const extras = stateful.length ? stateful : generic.length ? generic : STATIC_POOL;
  const extra = extras[0];

  const chosen = extra ? [pull, extra as RotatingQuestion] : [pull];
  await remember(chosen.map((q) => q.id));
  return chosen;
}

export type { Project };
