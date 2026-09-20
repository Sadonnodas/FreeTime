import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db';
import { setApiKey } from './client';
import { ask } from './assistant';
import { createProject } from '../store';
import { describeWrite, applyWrite, TOOL_DECLARATIONS } from './tools';

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

  it('turns "add a project and write in its notes" into two proposals, writing nothing', async () => {
    const coding = await createProject('Coding');
    stub([
      { functionCall: { name: 'add_project_to_era', args: { projectId: coding, name: 'MTG simulator' } }, thoughtSignature: 'S' },
      {
        functionCall: {
          name: 'append_note',
          args: { projectId: coding, projectInEra: 'MTG simulator', text: 'App to create decks and simulate magic games' }
        }
      },
      { text: 'Here you go.' }
    ]);

    const turn = await ask(
      [],
      'inside coding era add a project named MTG simulator and in the notes write: app to create decks and simulate magic games'
    );

    expect(turn.proposals.map((p) => p.label)).toEqual([
      'New project: MTG simulator in Coding',
      'Note in Coding · MTG simulator: App to create decks and simulate magic games'
    ]);
    // Proposals only. Nothing exists until the user taps Add.
    expect((await db.projects.get(coding))!.tags ?? []).toEqual([]);
    expect(await db.notes.count()).toBe(0);
  });

  it('tells the model which projects live inside each era', async () => {
    const coding = await createProject('Coding');
    await db.projects.update(coding, { tags: ['FreeTime'] });
    stub([{ text: 'ok' }]);
    await ask([], 'hi');
    const system = (bodies[0] as unknown as { systemInstruction: { parts: { text: string }[] } })
      .systemInstruction.parts[0]!.text;
    expect(system).toContain(`Coding [${coding}] — FreeTime`);
  });

  it('shows the model what is waiting, and turns "no, Friday" into an edit, not a second proposal', async () => {
    const pending = [
      { name: 'create_todo' as const, args: { title: 'Dentist' }, label: await describeWrite('create_todo', { title: 'Dentist' }) }
    ];
    stub([
      { functionCall: { name: 'revise_pending', args: { number: 1, date: '2026-09-18' } }, thoughtSignature: 'S' },
      { text: 'Moved it to Friday.' }
    ]);

    const turn = await ask([], 'no, make that Friday', undefined, pending);

    const system = (bodies[0] as unknown as { systemInstruction: { parts: { text: string }[] } })
      .systemInstruction.parts[0]!.text;
    expect(system).toContain('NOT SAVED YET');
    expect(system).toContain('1. To-do: Dentist');
    expect(turn.edits).toEqual([
      { kind: 'revise', number: 1, changes: { number: 1, date: '2026-09-18' } }
    ]);
    expect(turn.proposals).toEqual([]);
  });

  /**
   * *"Add two to-dos for tomorrow... both are quick, 20 minutes to-dos"* came
   * back undated and unsized. Two causes, both here: nothing ever told the
   * model what day it is, so "tomorrow" could not become YYYY-MM-DD; and
   * create_todo had no `takes` argument at all, so the twenty minutes had
   * nowhere to go.
   */
  it('tells the model what day it is, so a stated "tomorrow" can be a date', async () => {
    stub([{ text: 'ok' }]);
    await ask([], 'add a to-do for tomorrow');
    const system = (bodies[0] as unknown as { systemInstruction: { parts: { text: string }[] } })
      .systemInstruction.parts[0]!.text;

    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(system).toContain(iso);
    expect(system).toContain('Tomorrow is');
    // And the rule still forbids the thing it was written for.
    expect(system).toMatch(/Never set a date unless they said a day/);
  });

  it('offers both sizes on create_todo, since a sentence usually gives both', async () => {
    const todo = TOOL_DECLARATIONS.find((t) => t.name === 'create_todo')!;
    const props = todo.parameters.properties as Record<string, { enum?: string[] }>;

    // "Quick" is energy and "20 minutes" is takes — two axes, and the tool
    // used to offer only the first.
    expect(props.energy!.enum).toContain('quick');
    expect(props.takes!.enum).toContain('20min');
    expect(props.takes!.enum).toEqual(['20min', '1-2h', 'half day', 'all day']);
  });

  it('writes the duration the model asked for', async () => {
    const era = await createProject('Family');
    stub([
      {
        functionCall: {
          name: 'create_todo',
          args: { title: 'Finn medication', projectId: era, energy: 'quick', takes: '20min' }
        },
        thoughtSignature: 'S'
      },
      { text: 'Added.' }
    ]);

    const turn = await ask([], 'add finn medication, quick, 20 minutes');
    const p = turn.proposals[0]!;
    await applyWrite(p.name, p.args);

    const written = (await db.todos.toArray())[0]!;
    expect(written.takes).toBe('20min');
    expect(written.energy).toBe('quick');
  });

  it('tells the model which project is on screen', async () => {
    const coding = await createProject('Coding');
    await db.projects.update(coding, { tags: ['MTG simulator'] });
    stub([{ text: 'ok' }]);
    await ask([], 'add a to-do here', { eraId: coding, tag: 'MTG simulator' });
    const system = (bodies[0] as unknown as { systemInstruction: { parts: { text: string }[] } })
      .systemInstruction.parts[0]!.text;
    expect(system).toContain(`projectId ${coding}, projectInEra "MTG simulator"`);
  });
});
