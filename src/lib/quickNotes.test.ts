import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import {
  createQuickNote, updateQuickNote, softDelete, createProject, setProjectTags, setProjectTagSleeping,
  saveNote, getNote, quickNoteToProjectNote, quickNoteToProject
} from './store';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('quick notes', () => {
  it('are written, rewritten and deleted by tombstone like everything else', async () => {
    const id = await createQuickNote('Hall');
    await updateQuickNote(id, 'Hall\n2.43 m by 1.10 m');
    const note = (await db.quickNotes.get(id))!;
    expect(note.text).toBe('Hall\n2.43 m by 1.10 m');
    expect(note.updatedAt >= note.createdAt).toBe(true);

    await softDelete('quickNotes', id);
    // Kept as a tombstone so the delete syncs instead of the note resurrecting.
    expect((await db.quickNotes.get(id))!.deletedAt).toBeTruthy();
  });
});

describe('a quick note moving on', () => {
  it("is appended to a project's notes, never replacing them, and leaves", async () => {
    const home = await createProject('Home');
    await setProjectTags(home, ['Bedroom']);
    await saveNote(home, 'Paint: Farrow 239', 'Bedroom');
    const id = await createQuickNote('Wall 3.20 wide');
    expect(await quickNoteToProjectNote(id, home, 'Bedroom')).toBe(true);
    expect((await getNote(home, 'Bedroom'))!.markdown).toBe('Paint: Farrow 239\n\nWall 3.20 wide');
    expect((await db.quickNotes.get(id))!.deletedAt).toBeTruthy();
    // A project name the era does not have lands on the era's own note.
    const other = await createQuickNote('Fuse box: left');
    await quickNoteToProjectNote(other, home, 'Nope');
    expect((await getNote(home))!.markdown).toBe('Fuse box: left');
  });

  it('becomes a project, named by the user, with the note as its notes', async () => {
    const home = await createProject('Home');
    await setProjectTags(home, ['Attic']);
    await setProjectTagSleeping(home, 'Attic', true);
    const id = await createQuickNote('Shed\nbase 2x3 m, slab 10cm');
    expect(await quickNoteToProject(id, home, 'Attic')).toBe('name-taken');
    expect(await quickNoteToProject(id, home, 'Shed')).toBe('started');
    const era = (await db.projects.get(home))!;
    expect(era.tags).toEqual(['Attic', 'Shed']);
    expect(era.sleepingTags).toEqual(['Attic']);
    expect((await getNote(home, 'Shed'))!.markdown).toBe('Shed\nbase 2x3 m, slab 10cm');
    expect((await db.quickNotes.get(id))!.deletedAt).toBeTruthy();
  });
});
