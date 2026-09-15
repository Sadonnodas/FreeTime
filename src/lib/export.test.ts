import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import {
  createProject, setProjectTags, setProjectTagDescription, createTodo, updateTodo, setTodoAfter,
  completeTodo, createIdea, createBuyItem, saveNote, softDelete
} from './store';
import { collectProject, toMarkdown, demoteHeadings, EVERYTHING, JUST_TODOS } from './export';

/**
 * A project exported as text is mostly for pasting somewhere else — "right now
 * I have to manually type over my coding to-dos from FreeTime to Claude Code"
 * — so the exact shape of the text is the feature, and it is pinned here.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(reset);

async function mtg() {
  const era = await createProject('Coding');
  await setProjectTags(era, ['MTG simulator', 'FreeTime']);
  await setProjectTagDescription(era, 'MTG simulator', 'Build decks and play them out');
  return era;
}

describe('exporting a project as text', () => {
  it('gives just the to-dos as a checklist, and nothing else', async () => {
    const era = await mtg();
    const first = await createTodo('Card database', { projectId: era, tag: 'MTG simulator' });
    const second = await createTodo('Shuffle and draw', { projectId: era, tag: 'MTG simulator' });
    // Written a minute apart. Created back to back they can share a millisecond
    // on a fast machine, and then the order is a tie — which is how this test
    // passed locally and failed in CI.
    await db.todos.update(first, { createdAt: '2026-09-01T10:00:00.000Z' });
    await db.todos.update(second, { createdAt: '2026-09-01T10:01:00.000Z' });
    await createIdea('Online play', { projectId: era, tag: 'MTG simulator' });
    await saveNote(era, 'Some notes', 'MTG simulator');

    const text = toMarkdown((await collectProject(era, 'MTG simulator'))!, JUST_TODOS);

    expect(text).toBe(
      [
        '# MTG simulator',
        '',
        'Coding',
        '',
        '> Build decks and play them out',
        '',
        '## To-dos',
        '',
        '- [ ] Card database',
        '- [ ] Shuffle and draw',
        ''
      ].join('\n')
    );
  });

  it('keeps each project to itself', async () => {
    const era = await mtg();
    await createTodo('Mine', { projectId: era, tag: 'MTG simulator' });
    await createTodo('Someone else’s', { projectId: era, tag: 'FreeTime' });
    await createTodo('The era’s own', { projectId: era });

    const text = toMarkdown((await collectProject(era, 'MTG simulator'))!, JUST_TODOS);
    expect(text).toContain('Mine');
    expect(text).not.toContain('Someone else');
    expect(text).not.toContain('era’s own');
  });

  it('orders a chain the way it has to happen, and says what each waits for', async () => {
    const era = await mtg();
    const rules = await createTodo('Rules engine', { projectId: era, tag: 'MTG simulator' });
    const data = await createTodo('Card database', { projectId: era, tag: 'MTG simulator' });
    await db.todos.update(rules, { createdAt: '2026-09-01T10:00:00.000Z' });
    await db.todos.update(data, { createdAt: '2026-09-01T10:01:00.000Z' });
    await setTodoAfter(rules, data);
    await updateTodo(data, { energy: 'focus', takes: 'half day' });

    const text = toMarkdown((await collectProject(era, 'MTG simulator'))!, JUST_TODOS);
    const lines = text.split('\n').filter((l) => l.startsWith('- ['));
    expect(lines).toEqual([
      '- [ ] Card database — Focus · Half a day',
      '- [ ] Rules engine — after “Card database”'
    ]);
  });

  it('leaves finished and deleted things out unless Done is asked for', async () => {
    const era = await mtg();
    const done = await createTodo('Pick a stack', { projectId: era, tag: 'MTG simulator' });
    await completeTodo(done);
    const gone = await createTodo('Typo', { projectId: era, tag: 'MTG simulator' });
    await softDelete('todos', gone);

    const data = (await collectProject(era, 'MTG simulator'))!;
    expect(toMarkdown(data, JUST_TODOS)).not.toContain('Pick a stack');
    expect(toMarkdown(data, ['done'])).toContain('- [x] Pick a stack');
    expect(toMarkdown(data, [...EVERYTHING, 'done'])).not.toContain('Typo');
  });

  it('drops a section with nothing in it rather than printing an empty heading', async () => {
    const era = await mtg();
    await createTodo('Only this', { projectId: era, tag: 'MTG simulator' });
    const text = toMarkdown((await collectProject(era, 'MTG simulator'))!, EVERYTHING);
    expect(text).toContain('## To-dos');
    for (const empty of ['## Ideas', '## To buy', '## Notes', '## Blocks', '## Recordings']) {
      expect(text).not.toContain(empty);
    }
  });

  it('prices shopping per line and adds up what is left', async () => {
    const era = await mtg();
    await createBuyItem('Sleeves', { projectId: era, tag: 'MTG simulator', priceCents: 450, qty: 2 });
    const text = toMarkdown((await collectProject(era, 'MTG simulator'))!, ['buy']);
    expect(text).toMatch(/- \[ \] Sleeves ×2 — .*9[.,]00.* \(.*4[.,]50.* each\)/);
    expect(text).toMatch(/Still to buy: .*9[.,]00/);
  });

  it('keeps notes readable under the export’s own headings', async () => {
    const era = await mtg();
    await saveNote(era, '# Architecture\nSvelte front end', 'MTG simulator');
    const text = toMarkdown((await collectProject(era, 'MTG simulator'))!, ['notes']);
    expect(text).toContain('## Notes\n\n### Architecture\nSvelte front end');
  });

  it('refuses a project that is not there', async () => {
    const era = await mtg();
    expect(await collectProject(era, 'Nope')).toBeNull();
  });
});

describe('demoteHeadings', () => {
  it('pushes headings down and stops at six', () => {
    expect(demoteHeadings('# A\n##### B\nnot # a heading')).toBe('### A\n###### B\nnot # a heading');
  });
});
