import { generate, type Content } from './client';
import { db } from '../db';
import { today } from '../store';
import { tomorrow } from '../days';
import { buildDigest } from './digest';
import {
  TOOL_DECLARATIONS, isWrite, isNavigation, isPendingEdit, runQuery, describeWrite,
  navigationTarget, type ProposedWrite, type PendingEdit
} from './tools';

/**
 * The conversational surface (spec 7.1).
 *
 * Read calls are executed and fed straight back to the model, so it can look
 * something up and then answer in one turn from the user's point of view.
 * Write calls are never executed here — they come back as proposals for the
 * user to confirm.
 */

const SYSTEM = `You are a calm assistant inside someone's personal organiser. You are talking to the person who owns it.

Use query_state before answering anything factual about their stuff. Never guess at counts or contents.

If they correct something that is NOT SAVED YET ("no, Friday", "put that in FreeTime", "drop the last one"), change it with revise_pending or drop_pending instead of proposing it again.

When they want something recorded, call the matching function. You may call several at once, and later calls may refer to an era or project created by an earlier one in the same reply — they are applied in order.

How their things are organised: ERAS are lasting areas of life (Coding, Music, Family). PROJECTS live inside an era (MTG simulator inside Coding). Nothing goes deeper than that — a project is never inside another project. To make a project, use add_project_to_era, never create_project, which makes an era. To file something into a project, give its era as projectId and the project's name as projectInEra. "In the notes write…" means append_note for that project; a project's description is only its one-line tagline.
An idea is not a to-do: only turn one into a to-do or a project when they ask.
A to-do has TWO INDEPENDENT sizes, and a sentence often gives both: energy is how much head it takes (quick / moderate / focus), takes is how long it takes on the clock (20min / 1-2h / half day / all day). "Quick, twenty minutes" is BOTH — energy quick AND takes 20min. Set only what they actually said.
A to-do can also REPEAT ("every Thursday", "Mondays and Fridays" → repeatWeekdays) or WAIT for another one they name ("after the bamboo is out" → afterTitle). A repeating to-do never takes a date as well.

Hard rules, which come from why this app exists:
- Never set a date unless they said a day. A day they said — "tomorrow", "Friday", "the 3rd" — IS stated, so resolve it against today's date below and set it. What is forbidden is inventing one because something sounds urgent: there is no concept of overdue here, and an invented date creates one.
- Never mention streaks, percentages, being behind, or catching up.
- A quiet project is allowed to be quiet. Do not editorialise about neglect.
- Do not invent work. If they are thinking out loud, just talk.
- Keep replies short. A sentence or two. They are on a phone.`;

/** How many read round trips before we stop. Guards a model that loops on
 *  query_state; three is more than any real question has needed. */
const MAX_READ_ROUNDS = 3;

/** A place the model offered to take them. Shown as a link, never followed
 *  automatically — see SAFE_TOOLS in tools.ts for why. */
export interface Suggestion {
  label: string;
  path: string;
}

export interface AssistantTurn {
  reply: string;
  /** Writes awaiting confirmation. Never applied by this function. */
  proposals: ProposedWrite[];
  /** Changes to proposals that were ALREADY waiting, by their number. */
  edits: PendingEdit[];
  suggestions: Suggestion[];
}

/**
 * The proposals waiting for a tap, shown to the model with numbers, so a
 * follow-up can refer to one — "make the second one Friday". Without this the
 * model cannot see what it proposed a message ago at all: the history keeps
 * only its reply text, not the calls.
 */
export function pendingBlock(pending: ProposedWrite[]): string {
  if (!pending.length) return '';
  const lines = pending.map((p, i) => `${i + 1}. ${p.label} — ${p.name} ${JSON.stringify(p.args)}`);
  return (
    '\n\nNOT SAVED YET (proposals waiting for them to tap Add, numbered):\n' +
    lines.join('\n') +
    '\nTo change one of these use revise_pending with its number; to remove one use ' +
    'drop_pending. Do not propose any of them again.'
  );
}

/**
 * Where the person is standing when they ask. The assistant opens over every
 * screen now, and "add a to-do to call the plumber" said from inside the
 * Garden project means Garden — the same instinct that makes adding from the
 * project screen file things there without asking.
 */
export interface AskContext {
  /** The era on screen, if any. */
  eraId?: string;
  /** The project inside it, if one is open. */
  tag?: string;
}

async function contextLine(context?: AskContext): Promise<string> {
  if (!context?.eraId) return 'They are not looking at any particular era or project right now.';
  const era = await db.projects.get(context.eraId);
  if (!era || era.deletedAt) return 'They are not looking at any particular era or project right now.';
  if (context.tag && (era.tags ?? []).includes(context.tag)) {
    return (
      `They are looking at the project "${context.tag}" in the era ${era.name} [${era.id}]. ` +
      'When they say "here", "this project", or add something without naming a place, ' +
      `file it there: projectId ${era.id}, projectInEra "${context.tag}".`
    );
  }
  return (
    `They are looking at the era ${era.name} [${era.id}]. When they say "here" or add ` +
    'something without naming a place, file it in that era.'
  );
}

export async function ask(
  history: Content[],
  message: string,
  context?: AskContext,
  pending: ProposedWrite[] = []
): Promise<AssistantTurn> {
  const [digest, where] = await Promise.all([buildDigest(), contextLine(context)]);
  /*
   * WHAT DAY IT IS. Nothing ever told the model, so "add this for tomorrow"
   * could not become a date — it has no clock, and `date` wants YYYY-MM-DD.
   * Reported as two to-dos asked for tomorrow that arrived on Someday. The
   * weekday is given too, so "Friday" resolves without counting.
   */
  const now = new Date();
  const dateLine = `Today is ${now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })} — ${today(now)} in YYYY-MM-DD. Tomorrow is ${tomorrow(today(now))}.`;

  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: message }] }
  ];

  let reply = '';
  const proposals: ProposedWrite[] = [];
  const edits: PendingEdit[] = [];
  const suggestions: Suggestion[] = [];

  for (let round = 0; round <= MAX_READ_ROUNDS; round++) {
    const result = await generate({
      contents,
      systemInstruction: `${SYSTEM}\n\n${dateLine}\n\nWhere they are: ${where}\n\nCurrent state:\n${digest.text}${pendingBlock(pending)}`,
      tools: TOOL_DECLARATIONS,
      maxOutputTokens: 1200
    });

    if (result.text) reply = result.text;

    const writes = result.functionCalls.filter((c) => isWrite(c.name));
    const navs = result.functionCalls.filter((c) => isNavigation(c.name));
    // Only real reads go back to the model. A navigation call has no result to
    // feed back, and treating it as one would keep the loop spinning.
    const reads = result.functionCalls.filter(
      (c) => !isWrite(c.name) && !isNavigation(c.name) && !isPendingEdit(c.name)
    );

    for (const e of result.functionCalls.filter((c) => isPendingEdit(c.name))) {
      const number = Number(e.args.number);
      if (!Number.isInteger(number)) continue;
      edits.push(
        e.name === 'drop_pending'
          ? { kind: 'drop', number }
          : { kind: 'revise', number, changes: e.args }
      );
    }

    for (const w of writes) {
      if (!isWrite(w.name)) continue;
      // A model given the round-trip below sometimes calls the same write
      // again on the next round. One proposal per distinct call.
      const key = JSON.stringify([w.name, w.args]);
      if (proposals.some((p) => JSON.stringify([p.name, p.args]) === key)) continue;
      proposals.push({ name: w.name, args: w.args, label: await describeWrite(w.name, w.args) });
    }

    for (const n of navs) {
      const target = navigationTarget(n.args);
      // A model naming a screen that does not exist, or a project route with no
      // id, is dropped rather than rendered as a dead link.
      if (target && !suggestions.some((existing) => existing.path === target.path)) {
        suggestions.push(target);
      }
    }

    // No reads left to satisfy: the model has said what it is going to say.
    if (!reads.length || round === MAX_READ_ROUNDS) break;

    // The model's turn goes back VERBATIM. Rebuilding it from name and args
    // drops the thoughtSignature Gemini 3 puts on the first call, and the next
    // request is refused with a 400 — which is how this broke the assistant
    // outright the day the model changed. See Part.thoughtSignature.
    contents.push({ role: 'model', parts: result.parts });
    // And EVERY call gets an answer, in order — Gemini refuses a turn where
    // the answers do not match the calls. A write or a navigation has no
    // result, so it is told what happened to it instead: a write that went
    // unanswered would also invite the model to call it again.
    contents.push({
      role: 'user',
      parts: await Promise.all(
        result.functionCalls.map(async (c) => ({
          functionResponse: {
            name: c.name,
            response: {
              result: isWrite(c.name)
                ? 'Shown to them as a proposal. Nothing is written until they tap to confirm it.'
                : isPendingEdit(c.name)
                  ? 'Done — the proposal is changed, and still waits for them to tap Add.'
                  : isNavigation(c.name)
                    ? 'Offered to them as a link.'
                    : await runQuery(c.args)
            }
          }
        }))
      )
    });
  }

  if (!reply && proposals.length) reply = "Here's what I'll add.";
  if (!reply && edits.length) reply = 'Changed.';

  return { reply: reply || '…', proposals, edits, suggestions };
}
