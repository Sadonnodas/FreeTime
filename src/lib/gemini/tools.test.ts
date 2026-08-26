import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { TOOL_DECLARATIONS, isWrite, WRITE_TOOLS, runQuery, applyWrite } from './tools';
import { createProject, createTodo } from '../store';

/**
 * The read/write split is the assistant's entire safety model: reads run
 * immediately, writes are only ever proposals until the user taps. A tool that
 * writes but is classified as a read would be executed silently — precisely
 * what spec 7.1 forbids — and nothing else in the system would notice.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

describe('tool classification', () => {
  it('classifies every declared tool deliberately', () => {
    const declared = TOOL_DECLARATIONS.map((t) => t.name).sort();
    const accounted = [...WRITE_TOOLS, 'query_state'].sort();
    // A new tool must be added to WRITE_TOOLS or explicitly be the read one.
    // Failing here means someone added a tool without deciding which it is.
    expect(declared).toEqual(accounted);
  });

  it('treats only query_state as safe to run unprompted', () => {
    for (const { name } of TOOL_DECLARATIONS) {
      expect(isWrite(name)).toBe(name !== 'query_state');
    }
  });

  it('does not classify an unknown name as a write', () => {
    expect(isWrite('drop_everything')).toBe(false);
  });
});

describe('query_state', () => {
  beforeEach(reset);

  it('returns ids the model can act on', async () => {
    const p = await createProject('Bearfeet');
    await createTodo('restring', { projectId: p });

    const rows = (await runQuery({ kind: 'open_todos' })) as { id: string; title: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('restring');
    expect(rows[0]!.id).toBeTruthy();
  });

  it('filters by project name', async () => {
    const a = await createProject('Music');
    const b = await createProject('Campervan');
    await createTodo('mix', { projectId: a });
    await createTodo('seal roof', { projectId: b });

    const rows = (await runQuery({ kind: 'open_todos', projectName: 'campervan' })) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it('answers unknown kinds without throwing', async () => {
    expect(await runQuery({ kind: 'nonsense' })).toHaveProperty('error');
  });
});

describe('applying a confirmed write', () => {
  beforeEach(reset);

  it('goes through the normal store, stamping updatedAt for sync', async () => {
    await applyWrite('create_todo', { title: 'from the assistant' });
    const rows = await db.todos.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('from the assistant');
    // Without these, the record would never reach Drive.
    expect(rows[0]!.updatedAt).toBeTruthy();
    expect(rows[0]!.id).toBeTruthy();
  });

  it('never sets a date unless one was given', async () => {
    await applyWrite('create_todo', { title: 'undated' });
    expect((await db.todos.toArray())[0]!.date).toBeUndefined();
  });
});
