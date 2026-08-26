import { generate, parseJson, hasApiKey } from './client';
import { buildDigest } from './digest';
import type { FreeTimeAnswers, PlannedSlot, SlotKind, Todo } from '../types';
import type { RotatingQuestion } from '../questions';

/**
 * The AI half of the Free Time flow (spec 5.1 and 5.2).
 *
 * Both functions here are strictly optional. Every caller must fall back to the
 * deterministic path in freetime.ts / questions.ts, which is not a degraded
 * mode — it is the path that runs whenever there is no key, no signal, or the
 * model returns something we don't trust.
 */

// ------------------------------------------------------- rotating questions

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          maps_to: {
            type: 'string',
            enum: ['time', 'energy', 'project_pull', 'mood', 'freeform']
          }
        },
        required: ['id', 'text', 'options', 'maps_to']
      }
    }
  },
  required: ['questions']
};

const QUESTION_SYSTEM = `You write one or two short questions for someone deciding what to do with free time.

They have already been asked how long they have and how their head is. Do not ask either again.

Make questions SPECIFIC to the state you are given, not generic. Good:
- "You haven't touched Campervan in six weeks - is that on purpose?"
- "What do you secretly wish you were working on?"
- "Want to finish something, or start something?"

Rules:
- 1 or 2 questions, no more.
- 2 to 4 short options each. Always include an option that declines gracefully
  ("Not really", "Nothing in particular"). Never force a choice.
- Never guilt them. A quiet project is allowed to be quiet, and "on purpose" must
  always be an acceptable answer.
- Never mention streaks, percentages, being behind, or being overdue.
- id: a short stable slug.`;

interface RawQuestions {
  questions: { id: string; text: string; options: string[]; maps_to: string }[];
}

/**
 * Asks Gemini for rotating questions. Returns null on any doubt, which the
 * caller reads as "use the static set".
 */
export async function generateQuestions(
  recentIds: string[] = []
): Promise<RotatingQuestion[] | null> {
  if (!(await hasApiKey())) return null;

  try {
    const digest = await buildDigest();
    const result = await generate({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `${digest.text}\n\n` +
                (recentIds.length
                  ? `Do not reuse these recently asked question ids: ${recentIds.join(', ')}.\n\n`
                  : '') +
                `Write the questions.`
            }
          ]
        }
      ],
      systemInstruction: QUESTION_SYSTEM,
      responseSchema: QUESTION_SCHEMA,
      maxOutputTokens: 800
    });

    const parsed = parseJson<RawQuestions>(result.text);
    if (!parsed?.questions?.length) return null;

    return parsed.questions.slice(0, 2).map((q) => {
      const mapsTo: RotatingQuestion['mapsTo'] =
        q.maps_to === 'project_pull' ? 'project_pull' : q.maps_to === 'freeform' ? 'freeform' : 'mood';

      // Map option text back to real project ids. Anything that isn't a known
      // project name stays undefined, so a hallucinated project simply means
      // "no pull" rather than a crash or a wrong assignment.
      const optionProjectIds =
        mapsTo === 'project_pull'
          ? q.options.map(
              (o) => digest.projects.find((p) => p.name.toLowerCase() === o.trim().toLowerCase())?.id
            )
          : undefined;

      return {
        id: q.id,
        text: q.text,
        options: q.options.slice(0, 4),
        mapsTo,
        optionProjectIds
      };
    });
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- slot ranking

const RANK_SCHEMA = {
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['pull', 'neglected', 'obligation'] },
          id: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['kind', 'id', 'reason']
      }
    }
  },
  required: ['slots']
};

const RANK_SYSTEM = `You choose up to three things for someone's day from a list of candidates.

Slots:
- pull: what they said they actually want to work on. The thing they'd have
  drifted to anyway - now it counts.
- neglected: something from their quietest project. It MUST be small enough for
  the energy they stated. A five-minute win when they are fried; never a big block.
- obligation: only if a candidate genuinely has a date on or before today.
  If none does, omit this slot entirely.

Rules:
- Choose ONLY from the candidate ids given. Never invent one.
- Use each id at most once.
- reason: one short line, plain and warm. Say why this one, now.
- Never imply anything is late, overdue, or behind. Undated things are waiting,
  not failing.
- Two slots is a complete day. Do not pad.`;

interface RawRank {
  slots: { kind: SlotKind; id: string; reason: string }[];
}

/**
 * Ranks an ALREADY-FILTERED candidate pool into slots.
 *
 * The pool is built by pure code in freetime.ts before this is called — the
 * model never sees, and so can never reach into, the whole database. That split
 * is the spec's (5.2), and it is what keeps a bad generation to "an odd choice
 * of three tasks" rather than something absurd.
 */
export async function rankSlots(
  pool: Todo[],
  answers: FreeTimeAnswers,
  projectName: (id?: string) => string
): Promise<PlannedSlot[] | null> {
  if (!(await hasApiKey()) || !pool.length) return null;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const candidates = pool
      .slice(0, 80)
      .map(
        (t) =>
          `${t.id} | ${t.title} | project: ${projectName(t.projectId)} | ` +
          `energy: ${t.energy ?? 'unknown'} | date: ${t.date ?? 'none'}`
      )
      .join('\n');

    const pulled = answers.projectPullId ? projectName(answers.projectPullId) : 'not stated';

    const result = await generate({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Today is ${today}.\n` +
                `Time available: ${answers.time}. Head: ${answers.brain}.\n` +
                `They said they want to work on: ${pulled}.\n\n` +
                `Candidates (id | title | project | energy | date):\n${candidates}`
            }
          ]
        }
      ],
      systemInstruction: RANK_SYSTEM,
      responseSchema: RANK_SCHEMA,
      maxOutputTokens: 700
    });

    const parsed = parseJson<RawRank>(result.text);
    if (!parsed?.slots?.length) return null;

    // Validate hard. Any id not in the pool, or any duplicate, and we throw the
    // whole answer away rather than partially trusting it.
    const byId = new Map(pool.map((t) => [t.id, t]));
    const seen = new Set<string>();
    const slots: PlannedSlot[] = [];

    for (const s of parsed.slots.slice(0, 3)) {
      const todo = byId.get(s.id);
      if (!todo || seen.has(s.id)) return null;
      if (s.kind !== 'pull' && s.kind !== 'neglected' && s.kind !== 'obligation') return null;
      // An "obligation" with no date is the model inventing a commitment.
      if (s.kind === 'obligation' && !(todo.date && todo.date <= today)) return null;
      seen.add(s.id);
      slots.push({ kind: s.kind, todo, reason: (s.reason ?? '').trim() || 'Worth a go.' });
    }

    return slots.length ? slots : null;
  } catch {
    return null;
  }
}
