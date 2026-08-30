import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import {
  createProject, setProjectTags, getNote, saveNote, renameProjectTag, removeProjectTag,
  createTodo, updateTodo, createBuyItem, updateBuyItem
} from './store';
import { addWidget, setWidgetTag, widgetsFor } from './widgets';

/**
 * A project holds a note per section, which is what makes "lyrics for this song,
 * separate from lyrics for the next" work.
 *
 * The pairing is matched in code rather than by a compound index: IndexedDB
 * skips a record when any part of a compound key is undefined, so every
 * project-level note that predates sections would have dropped straight out of
 * the index meant to keep it unique.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}
beforeEach(reset);

describe('notes per section', () => {
  it('keeps a section note apart from the project note', async () => {
    const p = await createProject('Music');
    await saveNote(p, 'general studio notes');
    await saveNote(p, 'verse one goes like this', 'Remi');

    expect((await getNote(p))!.markdown).toBe('general studio notes');
    expect((await getNote(p, 'Remi'))!.markdown).toBe('verse one goes like this');
  });

  it('keeps two songs apart', async () => {
    const p = await createProject('Music');
    await saveNote(p, 'lyrics A', 'Remi');
    await saveNote(p, 'lyrics B', 'Bridge Kid');

    expect((await getNote(p, 'Remi'))!.markdown).toBe('lyrics A');
    expect((await getNote(p, 'Bridge Kid'))!.markdown).toBe('lyrics B');
    expect(await db.notes.count()).toBe(2);
  });

  it('updates in place rather than making a second note', async () => {
    const p = await createProject('Music');
    await saveNote(p, 'first', 'Remi');
    await saveNote(p, 'second', 'Remi');

    expect(await db.notes.count()).toBe(1);
    expect((await getNote(p, 'Remi'))!.markdown).toBe('second');
  });

  it('treats a note written before sections existed as the project note', async () => {
    const p = await createProject('Music');
    // No tag at all, the shape every existing row has.
    await db.notes.add({
      id: 'legacy',
      projectId: p,
      markdown: 'from before',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    expect((await getNote(p))!.markdown).toBe('from before');
    expect(await getNote(p, 'Remi')).toBeUndefined();
  });
});

describe('renaming a section', () => {
  it('brings its to-dos, its note and its recordings with it', async () => {
    const p = await createProject('Music');
    await setProjectTags(p, ['Remi']);
    const todo = await createTodo('re-amp guitars', { projectId: p });
    await updateTodo(todo, { tag: 'Remi' });
    await saveNote(p, 'verse one', 'Remi');
    await db.memos.add({
      id: 'm1',
      mime: 'audio/wav',
      durationMs: 1000,
      recordedAt: '2026-08-01T00:00:00.000Z',
      projectId: p,
      tag: 'Remi',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    });

    await renameProjectTag(p, 'Remi', 'Remi (final)');

    // Missing any one of the three would silently detach a song's lyrics from
    // the song they belong to.
    expect((await db.projects.get(p))!.tags).toEqual(['Remi (final)']);
    expect((await db.todos.get(todo))!.tag).toBe('Remi (final)');
    expect((await db.memos.get('m1'))!.tag).toBe('Remi (final)');
    expect((await getNote(p, 'Remi (final)'))!.markdown).toBe('verse one');
  });

  it('carries a blocks and shopping through a rename too', async () => {
    // Everything a project inside an era owns has to move together. A block or
    // a part left on the old name is not deleted, it is invisible — the
    // schematic is simply not on the build any more and nothing says why.
    const p = await createProject('Crafting');
    await setProjectTags(p, ['SPD pad']);

    const block = await addWidget(p, 'image', 'SPD pad');
    const part = await createBuyItem('Piezo discs', { projectId: p, tag: 'SPD pad' });

    await renameProjectTag(p, 'SPD pad', 'Trigger pad');

    expect((await db.widgets.get(block))!.tag).toBe('Trigger pad');
    expect((await db.buyItems.get(part))!.tag).toBe('Trigger pad');
  });

  it('moves a block out to the era, and Dexie really deletes the tag', async () => {
    // update() with undefined REMOVES the property rather than ignoring it,
    // which is exactly what "belongs to the era, not a project in it" needs.
    const p = await createProject('Crafting');
    await setProjectTags(p, ['SPD pad']);
    const block = await addWidget(p, 'note', 'SPD pad');

    await setWidgetTag(block, undefined);

    expect((await db.widgets.get(block))!.tag).toBeUndefined();
    expect((await widgetsFor(p)).length).toBe(1);
  });

  it('leaves a block behind when its project is removed, rather than deleting it', async () => {
    // Same contract as a note: removing a project unfiles what it held. The
    // photo is still there, and recreating the project brings it back.
    const p = await createProject('Crafting');
    await setProjectTags(p, ['SPD pad']);
    const block = await addWidget(p, 'image', 'SPD pad');

    await removeProjectTag(p, 'SPD pad');

    expect((await db.widgets.get(block))!.tag).toBe('SPD pad');
  });
});

describe('removing a section', () => {
  it('unfiles its to-dos and recordings without deleting them', async () => {
    const p = await createProject('Music');
    await setProjectTags(p, ['Remi']);
    const todo = await createTodo('bounce stems', { projectId: p });
    await updateTodo(todo, { tag: 'Remi' });

    await removeProjectTag(p, 'Remi');

    expect((await db.projects.get(p))!.tags).toEqual([]);
    const row = await db.todos.get(todo);
    expect(row!.tag).toBeUndefined();
    expect(row!.deletedAt).toBeUndefined();
  });

  it('does not overwrite the project note with the removed section note', async () => {
    const p = await createProject('Music');
    await setProjectTags(p, ['Remi']);
    await saveNote(p, 'the project note', undefined);
    await saveNote(p, 'the song lyrics', 'Remi');

    await removeProjectTag(p, 'Remi');

    // Kept against the old name rather than merged: recreate the section and
    // the lyrics come back, and nothing was silently clobbered.
    expect((await getNote(p))!.markdown).toBe('the project note');
    expect((await getNote(p, 'Remi'))!.markdown).toBe('the song lyrics');
  });
});
