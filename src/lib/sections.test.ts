import { describe, it, expect, beforeEach } from 'vitest';
import { sectionsFor, SECTIONS } from './sections';
import { db } from './db';
import {
  createProject, setProjectTags, setProjectSections, renameProjectTag, moveProjectTag
} from './store';

const order = async (eraId: string, tag: string) =>
  sectionsFor(await db.projects.get(eraId), tag);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('the order a project draws its sections in', () => {
  it('is the default until somebody changes it', () => {
    expect(sectionsFor(undefined, 'Books to read')).toEqual(SECTIONS.map((s) => s.id));
    expect(sectionsFor({ tagSections: {} }, 'Books to read')[0]).toBe('todo');
  });

  it('puts the ideas first when that is what was asked for', async () => {
    const era = await createProject('Books');
    await setProjectTags(era, ['Books to read']);
    await setProjectSections(era, 'Books to read', ['ideas', 'todo']);

    expect((await order(era, 'Books to read'))[0]).toBe('ideas');
  });

  it('appends anything the saved order does not mention', async () => {
    // A saved order is a preference, not a whitelist: a section added to the
    // app next year must not vanish from exactly the projects whose owner
    // cared enough to arrange them.
    const era = await createProject('Books');
    await setProjectTags(era, ['Books to read']);
    await setProjectSections(era, 'Books to read', ['ideas']);

    const got = await order(era, 'Books to read');
    expect(got[0]).toBe('ideas');
    expect([...got].sort()).toEqual([...SECTIONS.map((s) => s.id)].sort());
  });

  it('drops a section that no longer exists', () => {
    expect(sectionsFor({ tagSections: { X: ['gone', 'ideas'] } }, 'X')[0]).toBe('ideas');
  });

  it('belongs to ONE project, not to the era', async () => {
    const era = await createProject('Books');
    await setProjectTags(era, ['Books to read', 'Writing']);
    await setProjectSections(era, 'Books to read', ['ideas', 'todo']);

    expect((await order(era, 'Books to read'))[0]).toBe('ideas');
    expect((await order(era, 'Writing'))[0]).toBe('todo');
  });

  it('survives a rename, like the colour and the description', async () => {
    // setProjectTags prunes name-keyed maps for names it cannot see, so this
    // has to be carried BEFORE the tags change — the trap three other fields
    // have already fallen into.
    const era = await createProject('Books');
    await setProjectTags(era, ['Books to read']);
    await setProjectSections(era, 'Books to read', ['ideas', 'todo']);
    await renameProjectTag(era, 'Books to read', 'Reading list');

    expect((await order(era, 'Reading list'))[0]).toBe('ideas');
  });

  it('travels with the project to another era', async () => {
    const books = await createProject('Books');
    const life = await createProject('Life');
    await setProjectTags(books, ['Books to read']);
    await setProjectSections(books, 'Books to read', ['ideas', 'todo']);

    expect(await moveProjectTag(books, 'Books to read', life)).toBe('moved');
    expect((await order(life, 'Books to read'))[0]).toBe('ideas');
  });

  it('is forgotten when the project is', async () => {
    const era = await createProject('Books');
    await setProjectTags(era, ['Books to read']);
    await setProjectSections(era, 'Books to read', ['ideas', 'todo']);
    await setProjectTags(era, []);

    // The map must not fill up with names nothing points at.
    expect((await db.projects.get(era))!.tagSections ?? {}).toEqual({});
  });
});
