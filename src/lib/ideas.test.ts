import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import {
  createProject,
  setProjectTags,
  createIdea,
  setIdeaProject,
  promoteIdea,
  ideaToProject,
  renameProjectTag,
  moveProjectTag,
  removeProjectTag
} from './store';

/**
 * Ideas belong to projects now, and can grow into one.
 *
 * Asked for as: an idea and a to-do are not the same thing. "An ear-training
 * game" might need months of thinking or turn out not to be a good idea at all,
 * so it must not be forced into a to-do list — but it can BECOME a to-do, or a
 * project. What is pinned here is the part that fails silently: an idea that
 * a rename or a move leaves behind is not deleted, it is invisible.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(reset);

describe('an idea inside a project', () => {
  it('is carried by a rename', async () => {
    const era = await createProject('Coding');
    await setProjectTags(era, ['FreeTime']);
    const idea = await createIdea('Swipe to tick', { projectId: era, tag: 'FreeTime' });

    await renameProjectTag(era, 'FreeTime', 'FreeTime app');
    expect((await db.ideas.get(idea))!.tag).toBe('FreeTime app');
  });

  it('is carried by a move to another era', async () => {
    const coding = await createProject('Coding');
    const music = await createProject('Music');
    await setProjectTags(coding, ['Ear trainer']);
    const idea = await createIdea('Interval quiz', { projectId: coding, tag: 'Ear trainer' });

    expect(await moveProjectTag(coding, 'Ear trainer', music)).toBe('moved');
    const moved = (await db.ideas.get(idea))!;
    expect(moved.projectId).toBe(music);
    expect(moved.tag).toBe('Ear trainer');
  });

  it('falls back to the era when its project is removed, and is not deleted', async () => {
    const era = await createProject('Coding');
    await setProjectTags(era, ['Old site']);
    const idea = await createIdea('Dark mode', { projectId: era, tag: 'Old site' });

    await removeProjectTag(era, 'Old site');
    const row = (await db.ideas.get(idea))!;
    expect(row.projectId).toBe(era);
    expect(row.tag).toBeUndefined();
    expect(row.deletedAt).toBeUndefined();
  });

  it('loses its project when moved to a different era by hand', async () => {
    const coding = await createProject('Coding');
    const garden = await createProject('Garden');
    await setProjectTags(coding, ['FreeTime']);
    const idea = await createIdea('Pots', { projectId: coding, tag: 'FreeTime' });

    // "FreeTime" does not exist in Garden; keeping it would point at nothing.
    await setIdeaProject(idea, garden, 'FreeTime');
    expect((await db.ideas.get(idea))!.projectId).toBe(garden);
    await setIdeaProject(idea, undefined, 'FreeTime');
    expect((await db.ideas.get(idea))!.tag).toBeUndefined();
  });

  it('becomes a to-do in the same project', async () => {
    const era = await createProject('Coding');
    await setProjectTags(era, ['FreeTime']);
    const idea = await createIdea('Swipe to tick', { projectId: era, tag: 'FreeTime' });

    const todo = (await db.todos.get(await promoteIdea(idea)))!;
    expect([todo.projectId, todo.tag]).toEqual([era, 'FreeTime']);
  });
});

describe('an idea becoming a project', () => {
  it('starts a sibling project in the same era, never a child', async () => {
    const era = await createProject('Coding');
    await setProjectTags(era, ['FreeTime']);
    const idea = await createIdea('Ear-training game', { projectId: era, tag: 'FreeTime' });

    expect(await ideaToProject(idea, era, 'Ear-training game')).toBe('started');

    // Next to FreeTime, not inside it: there is no third level to put it in.
    expect((await db.projects.get(era))!.tags).toEqual(['FreeTime', 'Ear-training game']);
  });

  it('files the idea into the project it started', async () => {
    const era = await createProject('Coding');
    const idea = await createIdea('Ear-training game', { projectId: era });

    await ideaToProject(idea, era, 'Ear-training game');
    const row = (await db.ideas.get(idea))!;
    expect([row.projectId, row.tag]).toEqual([era, 'Ear-training game']);
    expect(row.becameProjectAt).toBeTruthy();
  });

  it('keeps the long version as the description when the name was shortened', async () => {
    const era = await createProject('Coding');
    const text = 'A game where you hear two notes and guess the interval';
    const idea = await createIdea(text);

    // An unfiled idea can start a project in whichever era you choose.
    await ideaToProject(idea, era, 'Interval game');
    expect((await db.projects.get(era))!.tagDescriptions?.['Interval game']).toBe(text);
  });

  it('adds no description when the name is the idea itself', async () => {
    const era = await createProject('Coding');
    const idea = await createIdea('Ear-training game');
    await ideaToProject(idea, era, 'Ear-training game');
    expect((await db.projects.get(era))!.tagDescriptions?.['Ear-training game']).toBeUndefined();
  });

  it('refuses a name the era already has, rather than merging into it', async () => {
    const era = await createProject('Coding');
    await setProjectTags(era, ['FreeTime']);
    const idea = await createIdea('FreeTime');

    expect(await ideaToProject(idea, era, 'FreeTime')).toBe('name-taken');
    expect((await db.projects.get(era))!.tags).toEqual(['FreeTime']);
    expect((await db.ideas.get(idea))!.becameProjectAt).toBeUndefined();
  });
});
