import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db';
import { setApiKey } from './client';
import { ask } from './assistant';

/**
 * Gemini 3 puts an opaque thoughtSignature on the first function call of a
 * turn and refuses the NEXT request with a 400 if that turn comes back without
 * it. The assistant used to rebuild the model's turn from name and args, which
 * drops the signature — so every question that needed a lookup failed, and the
 * assistant was dead the day the model changed. The API is what enforces this,
 * so it is asserted here against the request body rather than trusted.
 */

type Body = { contents: { role: string; parts: Record<string, unknown>[] }[] };

function reply(parts: Record<string, unknown>[]) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

let bodies: Body[] = [];

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await setApiKey('test-key');
  bodies = [];
});

afterEach(() => vi.unstubAllGlobals());

function stub(...responses: Record<string, unknown>[][]) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return reply(responses[i++] ?? [{ text: 'done' }]);
    })
  );
}

describe('the assistant round-trip', () => {
  it('sends the model turn back with its thoughtSignature intact', async () => {
    stub(
      [
        { functionCall: { name: 'query_state', args: { kind: 'open_todos' } }, thoughtSignature: 'SIG-abc' }
      ],
      [{ text: 'You have nothing open.' }]
    );

    const turn = await ask([], 'what is open?');

    expect(turn.reply).toBe('You have nothing open.');
    expect(bodies).toHaveLength(2);
    const modelTurn = bodies[1].contents.find((c) => c.role === 'model');
    expect(modelTurn?.parts[0].thoughtSignature).toBe('SIG-abc');
    expect(modelTurn?.parts[0].functionCall).toEqual({ name: 'query_state', args: { kind: 'open_todos' } });
  });

  it('answers every call, not just the reads', async () => {
    // A lookup and a write in the same turn. Gemini refuses a follow-up whose
    // answers do not match its calls one for one.
    stub(
      [
        { functionCall: { name: 'query_state', args: { kind: 'open_todos' } }, thoughtSignature: 'SIG-1' },
        { functionCall: { name: 'create_todo', args: { title: 'Sow the grass' } } }
      ],
      [{ text: 'Added it for you to confirm.' }]
    );

    const turn = await ask([], 'add sow the grass');

    const last = bodies[1].contents.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.parts.map((p) => (p.functionResponse as { name: string }).name)).toEqual([
      'query_state',
      'create_todo'
    ]);
    // Still a proposal. Answering the call must not have executed it.
    expect(turn.proposals.map((p) => p.name)).toEqual(['create_todo']);
    expect(await db.todos.count()).toBe(0);
  });

  it('does not propose the same write twice when the model repeats it', async () => {
    const call = { functionCall: { name: 'create_todo', args: { title: 'Pots' } } };
    stub(
      [{ ...call, thoughtSignature: 'S' }, { functionCall: { name: 'query_state', args: { kind: 'open_todos' } } }],
      [call]
    );
    const turn = await ask([], 'pots');
    expect(turn.proposals).toHaveLength(1);
  });
});
