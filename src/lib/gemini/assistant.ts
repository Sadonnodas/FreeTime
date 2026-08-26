import { generate, type Content } from './client';
import { buildDigest } from './digest';
import {
  TOOL_DECLARATIONS, isWrite, runQuery, describeWrite, type ProposedWrite
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

When they want something recorded, call the matching function. You may call several at once.

Hard rules, which come from why this app exists:
- Never set a date unless they stated a real deadline. There is no concept of overdue here, and an invented date creates one.
- Never mention streaks, percentages, being behind, or catching up.
- A quiet project is allowed to be quiet. Do not editorialise about neglect.
- Do not invent work. If they are thinking out loud, just talk.
- Keep replies short. A sentence or two. They are on a phone.`;

/** How many read round trips before we stop. Guards a model that loops on
 *  query_state; three is more than any real question has needed. */
const MAX_READ_ROUNDS = 3;

export interface AssistantTurn {
  reply: string;
  /** Writes awaiting confirmation. Never applied by this function. */
  proposals: ProposedWrite[];
}

export async function ask(history: Content[], message: string): Promise<AssistantTurn> {
  const digest = await buildDigest();

  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: message }] }
  ];

  let reply = '';
  const proposals: ProposedWrite[] = [];

  for (let round = 0; round <= MAX_READ_ROUNDS; round++) {
    const result = await generate({
      contents,
      systemInstruction: `${SYSTEM}\n\nCurrent state:\n${digest.text}`,
      tools: TOOL_DECLARATIONS,
      maxOutputTokens: 1200
    });

    if (result.text) reply = result.text;

    const reads = result.functionCalls.filter((c) => !isWrite(c.name));
    const writes = result.functionCalls.filter((c) => isWrite(c.name));

    for (const w of writes) {
      if (!isWrite(w.name)) continue;
      proposals.push({ name: w.name, args: w.args, label: await describeWrite(w.name, w.args) });
    }

    // No reads left to satisfy: the model has said what it is going to say.
    if (!reads.length || round === MAX_READ_ROUNDS) break;

    contents.push({
      role: 'model',
      parts: result.functionCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))
    });
    contents.push({
      role: 'user',
      parts: await Promise.all(
        reads.map(async (c) => ({
          functionResponse: {
            name: c.name,
            response: { result: await runQuery(c.args) }
          }
        }))
      )
    });
  }

  if (!reply && proposals.length) {
    reply = proposals.length === 1 ? "Here's what I'll add." : "Here's what I'll add.";
  }

  return { reply: reply || '…', proposals };
}
