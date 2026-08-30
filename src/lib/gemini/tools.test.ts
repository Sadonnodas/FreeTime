import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
  TOOL_DECLARATIONS, isWrite, isNavigation, WRITE_TOOLS, SAFE_TOOLS,
  runQuery, applyWrite, navigationTarget
} from './tools';
import { createProject, createTodo, getNote, saveNote } from '../store';

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
    const accounted = [...WRITE_TOOLS, ...SAFE_TOOLS].sort();
    // A new tool must be added to WRITE_TOOLS or to SAFE_TOOLS. Failing here
    // means someone added a tool without deciding which it is — and a write
    // that landed in neither list would be treated as a read and executed
    // silently, which is exactly what spec 7.1 forbids.
    expect(declared).toEqual(accounted);
  });

  it('never treats a safe tool as a write, or a write as safe', () => {
    for (const { name } of TOOL_DECLARATIONS) {
      const safe = (SAFE_TOOLS as readonly string[]).includes(name);
      expect(isWrite(name)).toBe(!safe);
    }
  });

  it('does not classify an unknown name as a write', () => {
    expect(isWrite('drop_everything')).toBe(false);
  });

  it('keeps navigation out of the write path', () => {
    // Navigation touches no data, so it must never queue a proposal — but it is
    // still not auto-followed; see SAFE_TOOLS.
    expect(isWrite('navigate')).toBe(false);
    expect(isNavigation('navigate')).toBe(true);
    expect(isNavigation('create_todo')).toBe(false);
  });
});

describe('navigationTarget', () => {
  it('maps a screen to a path', () => {
    expect(navigationTarget({ screen: 'buy' })?.path).toBe('/brain?section=buy');
    expect(navigationTarget({ screen: 'today' })?.path).toBe('/');
  });

  it('refuses a project link with no project, rather than making a dead one', () => {
    expect(navigationTarget({ screen: 'project' })).toBeNull();
    expect(navigationTarget({ screen: 'project', projectId: 'p1' })?.path).toBe('/projects/p1');
  });

  it('refuses a screen it does not have', () => {
    expect(navigationTarget({ screen: 'settings' })).toBeNull();
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

  it('starts a habit in the active state with a recorded cycle', async () => {
    await applyWrite('create_habit', { name: 'Play guitar' });
    const habits = await db.habits.toArray();
    expect(habits).toHaveLength(1);
    expect(habits[0]!.state).toBe('active');
    // The cycle history is what the habit detail view is built from.
    expect(await db.habitStateChanges.count()).toBe(1);
  });

  it('appends to a project note instead of replacing it', async () => {
    const p = await createProject('Music');
    await saveNote(p, 'Existing lyrics.');

    await applyWrite('append_note', { projectId: p, text: 'A line I said out loud.' });

    // Losing a page of notes to a misheard sentence is unrecoverable — there is
    // no undo anywhere in this app.
    const note = await getNote(p);
    expect(note!.markdown).toBe('Existing lyrics.\n\nA line I said out loud.');
  });

  it('writes the first note when there is nothing there yet', async () => {
    const p = await createProject('Campervan');
    await applyWrite('append_note', { projectId: p, text: 'Seal the roof seam.' });
    expect((await getNote(p))!.markdown).toBe('Seal the roof seam.');
  });

  it('ignores an append with no project rather than writing it nowhere', async () => {
    await applyWrite('append_note', { text: 'orphan' });
    expect(await db.notes.count()).toBe(0);
  });
});
