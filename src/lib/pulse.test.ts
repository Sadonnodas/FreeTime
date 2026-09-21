import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createProject, setProjectTags, createTodo, completeTodo, saveNote } from './store';
import { projectPulses } from './queries';

/**
 * What "touched" means on an era card.
 *
 * Reported as *"I have some eras that say nothing yet, even though I added
 * to-dos to them. I thought that would remove the nothing yet."* It counted
 * only work that came OUT — a ticked to-do — so an evening spent filling an
 * era registered as nothing at all.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(reset);

const pulseFor = async (id: string) => (await projectPulses()).find((p) => p.project.id === id)!;

describe('when an era was last touched', () => {
  it('says nothing yet for one that was made and never filled', async () => {
    // The era's own creation must not count, or the state could never be seen
    // and the line would be furniture.
    const era = await createProject('Campervan');
    expect((await pulseFor(era)).lastTouchedAt).toBeUndefined();
  });

  it('counts a to-do being WRITTEN, not only ticked', async () => {
    const era = await createProject('Campervan');
    await createTodo('Varnish the wood', { projectId: era });
    expect((await pulseFor(era)).lastTouchedAt).toBeDefined();
  });

  it('counts adding a project to the era', async () => {
    const era = await createProject('Campervan');
    // Backdated, so the two writes cannot share a millisecond: a tie made this
    // test fail about one run in three, which is the same clock-resolution
    // trap that once broke a deploy on CI's faster runner.
    await db.projects.update(era, { createdAt: '2026-01-01T00:00:00.000Z' });
    await setProjectTags(era, ['Bedroom']);
    expect((await pulseFor(era)).lastTouchedAt).toBeDefined();
  });

  it('counts a project added in the same millisecond the era was made', async () => {
    // An import or the assistant applying two proposals at once. The timestamps
    // are equal, so only the project itself proves anything happened.
    const era = await createProject('Music');
    const at = (await db.projects.get(era))!.createdAt;
    await db.projects.update(era, { tags: ['Mixing'], updatedAt: at });
    expect((await pulseFor(era)).lastTouchedAt).toBe(at);
  });

  it('takes the LATEST note in the era, not the first one it finds', async () => {
    // An era holds a note per project now. Picking whichever row came back
    // first reported an arbitrary date, usually not the one last written in.
    const era = await createProject('Music');
    await setProjectTags(era, ['Mixing', 'Songs']);
    await saveNote(era, 'old', 'Mixing');
    await db.notes.toCollection().modify({ updatedAt: '2026-01-01T00:00:00.000Z' });
    await saveNote(era, 'new', 'Songs');
    const newest = (await db.notes.toArray()).map((n) => n.updatedAt).sort().at(-1);

    expect((await pulseFor(era)).lastTouchedAt).toBe(newest);
  });

  it('still reports the latest moment when work comes out of it', async () => {
    const era = await createProject('Campervan');
    const id = await createTodo('Varnish the wood', { projectId: era });
    await db.todos.update(id, { createdAt: '2026-01-01T00:00:00.000Z' });
    await completeTodo(id);

    const pulse = await pulseFor(era);
    const done = (await db.todos.get(id))!.completedAt;
    expect(pulse.lastTouchedAt).toBe(done);
    expect(pulse.closedLast30).toBe(1);
    expect(pulse.openCount).toBe(0);
  });

  it('ignores a to-do that was deleted', async () => {
    const era = await createProject('Campervan');
    const id = await createTodo('Typed while testing', { projectId: era });
    await db.todos.update(id, { deletedAt: new Date().toISOString() });
    expect((await pulseFor(era)).lastTouchedAt).toBeUndefined();
  });
});
