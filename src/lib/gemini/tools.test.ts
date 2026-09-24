import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
  TOOL_DECLARATIONS, isWrite, isNavigation, WRITE_TOOLS, SAFE_TOOLS, PENDING_TOOLS,
  runQuery, applyWrite, navigationTarget, orderForApply, describeWrite, applyPendingEdits,
  isPendingEdit, proposalFields, withArgs, type WriteTool, type ProposedWrite
} from './tools';
import {
  createProject, createTodo, getNote, saveNote, setProjectTags, createIdea
} from '../store';

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
    const accounted = [...WRITE_TOOLS, ...SAFE_TOOLS, ...PENDING_TOOLS].sort();
    // A new tool must be added to WRITE_TOOLS or to SAFE_TOOLS. Failing here
    // means someone added a tool without deciding which it is — and a write
    // that landed in neither list would be treated as a read and executed
    // silently, which is exactly what spec 7.1 forbids.
    expect(declared).toEqual(accounted);
  });

  it('puts every tool in exactly one category, and only writes count as writes', () => {
    for (const { name } of TOOL_DECLARATIONS) {
      const inWrite = (WRITE_TOOLS as readonly string[]).includes(name);
      const inSafe = (SAFE_TOOLS as readonly string[]).includes(name);
      const inPending = (PENDING_TOOLS as readonly string[]).includes(name);
      expect([inWrite, inSafe, inPending].filter(Boolean)).toHaveLength(1);
      expect(isWrite(name)).toBe(inWrite);
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

/**
 * Asked for in one sentence: *"inside coding era add a project named MTG
 * simulator and in the notes write: app to create decks and simulate magic
 * games"*. That is two proposals where the second is filed under something the
 * first creates, so names are resolved when the user taps Add — not when the
 * model proposes — and places are applied before the things that go into them.
 */
describe('filing into a project, as a conversation would', () => {
  beforeEach(reset);

  /** What Assistant.svelte does when the user taps Add. */
  async function commit(writes: { name: WriteTool; args: Record<string, unknown> }[]) {
    for (const w of orderForApply(writes)) await applyWrite(w.name, w.args);
  }

  it('adds a project to an era and writes in its notes, in one reply', async () => {
    const coding = await createProject('Coding');
    await saveNote(coding, 'The era note stays as it was.');

    await commit([
      { name: 'add_project_to_era', args: { projectId: coding, name: 'MTG simulator' } },
      {
        name: 'append_note',
        // Lower case, as speech-to-text and models both tend to produce it.
        args: {
          projectId: 'coding',
          projectInEra: 'mtg simulator',
          text: 'App to create decks and simulate magic games'
        }
      }
    ]);

    expect((await db.projects.get(coding))!.tags).toEqual(['MTG simulator']);
    // Under the project's own spelling, not the model's.
    expect((await getNote(coding, 'MTG simulator'))!.markdown).toBe(
      'App to create decks and simulate magic games'
    );
    expect((await getNote(coding))!.markdown).toBe('The era note stays as it was.');
  });

  it('still works when the note is asked for before its project', async () => {
    const coding = await createProject('Coding');
    await commit([
      { name: 'append_note', args: { projectId: coding, projectInEra: 'MTG simulator', text: 'Decks' } },
      { name: 'add_project_to_era', args: { projectId: coding, name: 'MTG simulator' } }
    ]);
    expect((await getNote(coding, 'MTG simulator'))!.markdown).toBe('Decks');
  });

  it('creates an era, a project in it and a to-do in that, by name', async () => {
    await commit([
      { name: 'create_todo', args: { title: 'Card database', projectId: 'Games', projectInEra: 'MTG simulator' } },
      { name: 'add_project_to_era', args: { projectId: 'Games', name: 'MTG simulator' } },
      { name: 'create_project', args: { name: 'Games' } }
    ]);
    const era = (await db.projects.toArray())[0]!;
    const todo = (await db.todos.toArray())[0]!;
    expect([era.name, era.tags]).toEqual(['Games', ['MTG simulator']]);
    expect([todo.projectId, todo.tag]).toEqual([era.id, 'MTG simulator']);
  });

  it('files ideas and shopping into a project too', async () => {
    const van = await createProject('Campervan');
    await setProjectTags(van, ['Furniture']);
    await commit([
      { name: 'create_idea', args: { text: 'Fold-down table', projectId: van, projectInEra: 'Furniture' } },
      { name: 'create_buy_item', args: { name: 'Hinges', projectId: van, projectInEra: 'furniture' } }
    ]);
    expect((await db.ideas.toArray())[0]!.tag).toBe('Furniture');
    expect((await db.buyItems.toArray())[0]!.tag).toBe('Furniture');
  });

  it('drops a project that does not exist rather than filing into nothing', async () => {
    const coding = await createProject('Coding');
    await applyWrite('create_todo', { title: 'Misheard', projectId: coding, projectInEra: 'Nope' });
    const todo = (await db.todos.toArray())[0]!;
    // On the era, where it can be seen and moved — not on a tag no screen shows.
    expect([todo.projectId, todo.tag]).toEqual([coding, undefined]);
  });

  it('does not add a second project with the same name', async () => {
    const coding = await createProject('Coding');
    await setProjectTags(coding, ['FreeTime']);
    await applyWrite('add_project_to_era', { projectId: coding, name: 'freetime' });
    expect((await db.projects.get(coding))!.tags).toEqual(['FreeTime']);
  });

  it('never creates a project inside a project', async () => {
    // There is no argument for it: add_project_to_era takes an era and a name.
    const tool = TOOL_DECLARATIONS.find((t) => t.name === 'add_project_to_era')!;
    const props = Object.keys((tool.parameters as { properties: object }).properties);
    expect(props).not.toContain('projectInEra');
  });

  it('describes a note for a project that is only about to exist', async () => {
    const coding = await createProject('Coding');
    const label = await describeWrite('append_note', {
      projectId: coding, projectInEra: 'MTG simulator', text: 'App to create decks'
    });
    expect(label).toBe('Note in Coding · MTG simulator: App to create decks');
  });
});

describe('ideas, through the assistant', () => {
  beforeEach(reset);

  it('turns an idea into a to-do in the same project, once', async () => {
    const coding = await createProject('Coding');
    await setProjectTags(coding, ['FreeTime']);
    const idea = await createIdea('Swipe to tick', { projectId: coding, tag: 'FreeTime' });

    await applyWrite('idea_to_todo', { id: idea });
    await applyWrite('idea_to_todo', { id: idea });
    const todos = await db.todos.toArray();
    expect(todos).toHaveLength(1);
    expect(todos[0]!.tag).toBe('FreeTime');
  });

  it('grows an idea into a project in its own era', async () => {
    const coding = await createProject('Coding');
    const idea = await createIdea('A game to learn intervals', { projectId: coding });

    await applyWrite('idea_to_project', { id: idea, name: 'Interval game' });
    expect((await db.projects.get(coding))!.tags).toEqual(['Interval game']);
    expect((await db.ideas.get(idea))!.tag).toBe('Interval game');
  });

  it('needs an era for an idea that belongs nowhere', async () => {
    const coding = await createProject('Coding');
    const idea = await createIdea('Ear trainer');

    await applyWrite('idea_to_project', { id: idea, name: 'Ear trainer' });
    expect((await db.projects.get(coding))!.tags ?? []).toEqual([]);

    await applyWrite('idea_to_project', { id: idea, name: 'Ear trainer', projectId: 'Coding' });
    expect((await db.projects.get(coding))!.tags).toEqual(['Ear trainer']);
  });

  it('lets the model see the projects inside each era, and where each idea is', async () => {
    const coding = await createProject('Coding');
    await setProjectTags(coding, ['FreeTime']);
    await createIdea('Swipe', { projectId: coding, tag: 'FreeTime' });

    expect(await runQuery({ kind: 'projects' })).toEqual([
      { id: coding, name: 'Coding', projects: ['FreeTime'] }
    ]);
    const ideas = (await runQuery({ kind: 'ideas' })) as { projectInEra?: string }[];
    expect(ideas[0]!.projectInEra).toBe('FreeTime');
  });

  it('links straight to a project inside an era', () => {
    expect(
      navigationTarget({ screen: 'project', projectId: 'c1', projectInEra: 'MTG simulator' })?.path
    ).toBe('/projects/c1/MTG%20simulator');
  });
});

/**
 * "Be able to adjust assistant entries with a follow-up recording to tweak AI
 * suggestions." Proposals are numbered for the model; edits refer to those
 * numbers, and nothing reaches the store until Add.
 */
describe('changing a proposal that is not saved yet', () => {
  beforeEach(reset);

  async function proposal(name: WriteTool, args: Record<string, unknown>): Promise<ProposedWrite> {
    return { name, args, label: await describeWrite(name, args) };
  }

  it('is neither a write nor a read', () => {
    expect(isPendingEdit('revise_pending')).toBe(true);
    expect(isWrite('revise_pending')).toBe(false);
    expect(isWrite('drop_pending')).toBe(false);
  });

  it('changes only the fields given, and relabels it', async () => {
    const coding = await createProject('Coding');
    const pending = [await proposal('create_todo', { title: 'Card database', projectId: coding, energy: 'focus' })];

    const next = await applyPendingEdits(pending, [
      { kind: 'revise', number: 1, changes: { number: 1, title: 'Card database and sets' } }
    ]);
    expect(next[0]!.args).toEqual({ title: 'Card database and sets', projectId: coding, energy: 'focus' });
    expect(next[0]!.label).toBe('To-do: Card database and sets in Coding');
    expect(await db.todos.count()).toBe(0);
  });

  it('resolves every number against the list the model was shown', async () => {
    const pending = [
      await proposal('create_todo', { title: 'one' }),
      await proposal('create_todo', { title: 'two' }),
      await proposal('create_todo', { title: 'three' })
    ];
    // Drop 1 and revise 3 in one breath: "3" must still mean "three".
    const next = await applyPendingEdits(pending, [
      { kind: 'drop', number: 1 },
      { kind: 'revise', number: 3, changes: { title: 'THREE' } }
    ]);
    expect(next.map((p) => p.args.title)).toEqual(['two', 'THREE']);
  });

  it('ignores a number that is not there rather than guessing', async () => {
    const pending = [await proposal('create_todo', { title: 'only' })];
    expect(await applyPendingEdits(pending, [{ kind: 'drop', number: 4 }])).toHaveLength(1);
  });

  it('forgets the project when the era changes, unless a new one is named', async () => {
    const coding = await createProject('Coding');
    const garden = await createProject('Garden');
    const pending = [await proposal('create_todo', { title: 'Pots', projectId: coding, projectInEra: 'FreeTime' })];

    const moved = await applyPendingEdits(pending, [{ kind: 'revise', number: 1, changes: { projectId: garden } }]);
    expect(moved[0]!.args).toEqual({ title: 'Pots', projectId: garden });
  });
});

describe('finishing a project through the assistant', () => {
  beforeEach(reset);

  it('finishes the named project, in the era’s own spelling', async () => {
    const home = await createProject('Home');
    await setProjectTags(home, ['Closet']);
    expect(await describeWrite('finish_project', { projectId: 'home', projectInEra: 'closet' })).toBe(
      'Finish project: closet in Home'
    );
    await applyWrite('finish_project', { projectId: 'home', projectInEra: 'closet' });
    expect((await db.projects.get(home))!.finishedTags?.Closet).toBeTruthy();
  });

  it('finishes nothing when the project is not there', async () => {
    const home = await createProject('Home');
    await setProjectTags(home, ['Closet']);
    await applyWrite('finish_project', { projectId: home, projectInEra: 'Kitchen' });
    expect((await db.projects.get(home))!.finishedTags ?? {}).toEqual({});
  });
});

describe('editing a proposal before it is added', () => {
  it('rewords the main text and rebuilds the label from it', async () => {
    const { editableText, withEditedText } = await import('./tools');
    const p = { name: 'create_todo' as const, args: { title: 'Check app closng' }, label: 'To-do: Check app closng' };
    expect(editableText(p)).toBe('Check app closng');
    const next = (await withEditedText(p, '  Check app closing  '))!;
    expect(next.args.title).toBe('Check app closing');
    expect(next.label).toBe('To-do: Check app closing');
  });

  it('refuses an empty edit, and has nothing to edit on an action', async () => {
    const { editableText, withEditedText } = await import('./tools');
    const todo = { name: 'create_todo' as const, args: { title: 'x' }, label: 'To-do: x' };
    expect(await withEditedText(todo, '   ')).toBeNull();
    expect(editableText({ name: 'complete_todo', args: { id: 'abc' } })).toBeNull();
  });
});

/**
 * *"I told the assistant the to-do would only take 20 min and low headspace.
 * It suggested the to-do, but I couldn't adjust the other things I would
 * normally be able to adjust."* Add was the only button, so a proposal could
 * be corrected in words and in nothing else.
 */
describe('opening a proposal to check it before adding', () => {
  it('offers exactly the fields the write actually uses', () => {
    // The honest source is applyWrite. A control for an argument the apply
    // step ignores is a setting that silently does nothing.
    expect(proposalFields('create_todo')).toEqual({
      text: true, era: true, project: true, todo: true
    });
    // A buy item is filed, but has no day or sizes of its own.
    expect(proposalFields('create_buy_item').todo).toBe(false);
    // The name being typed IS the project, so there is no project inside it.
    expect(proposalFields('add_project_to_era')).toMatchObject({ era: true, project: false });
    // Ticking an existing to-do has nothing of its own to check.
    expect(Object.values(proposalFields('complete_todo')).some(Boolean)).toBe(false);
  });

  it('writes the sizes that were set on the proposal', async () => {
    const era = await createProject('Coding');
    await setProjectTags(era, ['FreeTime']);
    const p: ProposedWrite = {
      name: 'create_todo',
      args: { title: 'Check the deploy', projectId: era, projectInEra: 'FreeTime' },
      label: await describeWrite('create_todo', { title: 'Check the deploy' })
    };

    const checked = await withArgs(p, { takes: '20min', energy: 'quick' });
    await applyWrite(checked.name, checked.args);

    const todo = (await db.todos.toArray())[0]!;
    expect(todo.takes).toBe('20min');
    expect(todo.energy).toBe('quick');
    expect(todo.tag).toBe('FreeTime');
  });

  it('sets a repeat and a blocker the way the model can say them', async () => {
    // *"The assistant should be able to set all the same things I could do
    // manually."* Weekdays by name, because the model has no reason to know
    // that 0 is Sunday; the blocker by title, because the digest gives it
    // titles and no ids.
    const era = await createProject('Home');
    const bamboo = await createTodo('Remove the bamboo', { projectId: era });

    await applyWrite('create_todo', {
      title: 'Sow the grass',
      projectId: era,
      afterTitle: 'remove the bamboo',
      date: '2026-09-25',
      repeatWeekdays: ['thursday', 'monday']
    });

    const todo = (await db.todos.toArray()).find((t) => t.title === 'Sow the grass')!;
    expect(todo.repeatDays).toEqual([1, 4]);
    expect(todo.after).toBe(bamboo);
    // A repeating to-do holds no date, however the model wrote the call.
    expect(todo.date).toBeUndefined();
  });

  it('drops a blocker title that is not there rather than guessing', async () => {
    // A to-do blocked on a row that does not exist would sit unstartable with
    // nothing on screen to explain it — the dangling-link rule in order.ts.
    const era = await createProject('Nowhere in particular');
    await applyWrite('create_todo', { title: 'Grass, unblocked', projectId: era, afterTitle: 'nope' });
    const todo = (await db.todos.toArray()).find((t) => t.title === 'Grass, unblocked')!;
    expect(todo.after).toBeUndefined();
  });

  it('ignores a weekday it does not recognise', async () => {
    await applyWrite('create_todo', { title: 'Bins', repeatWeekdays: ['thurs', 'thursday'] });
    // Found by title: this file does not reset the store between tests, so an
    // index would be reading whatever an earlier test happened to write.
    const todo = (await db.todos.toArray()).find((t) => t.title === 'Bins')!;
    expect(todo.repeatDays).toEqual([4]);
  });

  it('relabels as it goes, so the card never describes the old version', async () => {
    const p: ProposedWrite = {
      name: 'create_todo',
      args: { title: 'Old words' },
      label: await describeWrite('create_todo', { title: 'Old words' })
    };
    expect((await withArgs(p, { title: 'New words' })).label).toContain('New words');
  });

  it('removes an argument rather than storing an empty one', async () => {
    // "Someday" and "Not sure" mean the field is not set, not that it is set
    // to nothing.
    const p: ProposedWrite = {
      name: 'create_todo',
      args: { title: 'x', date: '2026-09-25' },
      label: 'To-do: x'
    };
    expect('date' in (await withArgs(p, { date: undefined })).args).toBe(false);
  });
});
