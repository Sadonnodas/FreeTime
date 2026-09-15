import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import {
  createProject, setProjectTags, setProjectTagDescription, createTodo, updateTodo, setTodoAfter,
  completeTodo, createIdea, createBuyItem, saveNote, softDelete
} from './store';
import { collectProject, toMarkdown, demoteHeadings, EVERYTHING, JUST_TODOS } from './export';
import type { BuyItem } from './types';

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

describe('exporting a list from Brain', () => {
  it('groups what is on screen under era and project, unfiled last', async () => {
    const { listToMarkdown } = await import('./export');
    const coding = await createProject('Coding');
    await setProjectTags(coding, ['FreeTime']);
    const a = await createTodo('Swipe to tick', { projectId: coding, tag: 'FreeTime' });
    const b = await createTodo('Book the ferry');
    const c = await createTodo('Readme', { projectId: coding });
    const rows = (await db.todos.bulkGet([a, b, c])).filter(Boolean) as never[];
    const eras = await db.projects.toArray();

    // By era, then the era's own rows before its projects; the unfiled pile last.
    expect(listToMarkdown('todos', 'To-dos', rows, eras)).toBe(
      [
        '# To-dos',
        '',
        '## Coding',
        '',
        '- [ ] Readme',
        '',
        '## Coding · FreeTime',
        '',
        '- [ ] Swipe to tick',
        '',
        '## Not filed',
        '',
        '- [ ] Book the ferry',
        ''
      ].join('\n')
    );
  });

  it('ticks what is already done, and says so when the list is empty', async () => {
    const { listToMarkdown } = await import('./export');
    const t = await createTodo('Done one');
    await completeTodo(t);
    const rows = [(await db.todos.get(t))!];
    expect(listToMarkdown('todos', 'To-dos', rows, [])).toContain('- [x] Done one');
    expect(listToMarkdown('ideas', 'Ideas', [], [])).toContain('Nothing here.');
  });
});

describe('what a printed shopping list comes to', () => {
  const item = (over: Partial<BuyItem>): BuyItem => ({
    id: Math.random().toString(36), name: 'x', createdAt: '', updatedAt: '', ...over
  });

  it('multiplies by quantity and counts pieces', async () => {
    const { totalsOf } = await import('./export');
    const t = totalsOf([item({ priceCents: 450, qty: 2, currency: 'EUR' }), item({ priceCents: 100, currency: 'EUR' })]);
    expect(t.byCurrency).toEqual([{ currency: 'EUR', cents: 1000 }]);
    expect(t.pieces).toBe(3);
  });

  it('keeps currencies apart instead of blending them into one number', async () => {
    const { totalsOf, formatTotals } = await import('./export');
    const t = totalsOf([item({ priceCents: 1000, currency: 'EUR' }), item({ priceCents: 500, currency: 'USD' })]);
    expect(t.byCurrency.map((c) => c.currency)).toEqual(['EUR', 'USD']);
    expect(formatTotals(t)).toContain(' + ');
  });

  it('counts what has no price rather than pretending the total covers it', async () => {
    const { totalsOf, formatTotals } = await import('./export');
    const t = totalsOf([item({ priceCents: 300 }), item({}), item({ qty: 4 })]);
    expect(t.unpriced).toBe(2);
    expect(t.pieces).toBe(6);
    expect(formatTotals(totalsOf([item({})]))).toBe('—');
  });
});

describe('grouping for paper', () => {
  it('sorts by era and then by the era’s own project order, not by first appearance', async () => {
    const { groupByPlace } = await import('./export');
    const eras = [
      { id: 'c', name: 'Coding', tags: ['FreeTime', 'MTG'] },
      { id: 'v', name: 'Campervan', tags: ['Furniture', 'Electrics'] }
    ] as never[];
    const rows = [
      { projectId: 'v', tag: 'Electrics' },
      { projectId: 'c', tag: 'MTG' },
      {},
      { projectId: 'v', tag: 'Furniture' },
      { projectId: 'c', tag: 'FreeTime' }
    ];
    expect(groupByPlace(rows, eras).map((g) => g.heading)).toEqual([
      'Campervan · Furniture',
      'Campervan · Electrics',
      'Coding · FreeTime',
      'Coding · MTG',
      'Not filed'
    ]);
  });
});
