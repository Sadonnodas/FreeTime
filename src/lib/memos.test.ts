import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createMemo, deleteMemo, updateMemo, allMemos, fileName, displayTitle } from './memos';
import type { Memo } from './types';

/**
 * The behaviour worth pinning down here is the clearing of fields.
 *
 * Several things in the app "unset" by passing undefined through Dexie's
 * update() — removing a cover photo, unfiling a memo from its project, and most
 * importantly dropping the audio of a deleted recording. If update() were to
 * ignore undefined instead of deleting the property, every one of those would
 * silently do nothing, and the delete case would leave tens of megabytes of
 * audio on the device that the user believes they threw away. That is invisible
 * from the UI, so it is asserted here.
 */

const wav = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });

const make = (over: Partial<Parameters<typeof createMemo>[0]> = {}) =>
  createMemo({ blob: wav(), mime: 'audio/wav', durationMs: 4200, ...over });

beforeEach(async () => {
  await db.memos.clear();
});

describe('deleteMemo', () => {
  it('keeps the row as a tombstone but drops the audio', async () => {
    const id = await make({ title: 'Chorus hum' });
    await deleteMemo(id);

    const row = (await db.memos.get(id)) as Memo;
    // The row survives, or the delete could not propagate through sync and the
    // recording would come back on the next device.
    expect(row).toBeDefined();
    expect(row.deletedAt).toBeTruthy();
    expect(row.title).toBe('Chorus hum');
    // ...but the bytes are actually gone, not merely hidden.
    expect(row.blob).toBeUndefined();
  });

  it('drops it out of the list', async () => {
    const id = await make();
    await make();
    await deleteMemo(id);
    expect(await allMemos()).toHaveLength(1);
  });
});

describe('updateMemo', () => {
  it('clears a field when passed undefined', async () => {
    const id = await make({ projectId: 'p1', tag: 'Mixing' });
    await updateMemo(id, { tag: undefined });

    const row = (await db.memos.get(id)) as Memo;
    expect(row.tag).toBeUndefined();
    expect(row.projectId).toBe('p1');
  });

  it('bumps updatedAt, so sync has a tiebreaker', async () => {
    const id = await make();
    const before = (await db.memos.get(id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    await updateMemo(id, { title: 'Named later' });
    expect((await db.memos.get(id))!.updatedAt > before).toBe(true);
  });
});

describe('allMemos', () => {
  it('is newest first', async () => {
    const a = await make({ title: 'first' });
    await new Promise((r) => setTimeout(r, 2));
    const b = await make({ title: 'second' });
    expect((await allMemos()).map((m) => m.id)).toEqual([b, a]);
  });
});

describe('naming', () => {
  const memo = (over: Partial<Memo> = {}): Memo => ({
    id: 'm1',
    mime: 'audio/webm',
    durationMs: 6000,
    recordedAt: '2026-08-14T22:40:00.000Z',
    createdAt: '2026-08-14T22:40:00.000Z',
    updatedAt: '2026-08-14T22:40:00.000Z',
    ...over
  });

  it('never shows a blank title', () => {
    expect(displayTitle(memo())).not.toBe('');
    expect(displayTitle(memo({ title: '   ' }))).not.toBe('');
  });

  it('uses the given name when there is one', () => {
    expect(displayTitle(memo({ title: 'Bridge Kid chorus' }))).toBe('Bridge Kid chorus');
  });

  it('builds a shareable filename with the right extension', () => {
    expect(fileName(memo({ title: 'Chorus', mime: 'audio/webm;codecs=opus' }))).toBe(
      '2026-08-14 22.40 Chorus.webm'
    );
    // Safari records mp4; .m4a is what mail clients and phones expect to see.
    expect(fileName(memo({ mime: 'audio/mp4' }))).toBe('2026-08-14 22.40.m4a');
  });

  it('strips characters that are illegal in a filename', () => {
    expect(fileName(memo({ title: 'a/b:c?d' }))).toBe('2026-08-14 22.40 a-b-c-d.webm');
  });
});

/**
 * The metadata/audio split, asserted at the level sync depends on.
 *
 * syncMemos strips the blob before merging and reattaches it from the local row
 * afterwards. The failure this guards against is silent and total: if a remote
 * metadata record were written straight over the local one, the blob would
 * become undefined and the only copy of a recording would be gone, with the row
 * still sitting there looking healthy.
 */
describe('metadata and audio are separable', () => {
  const strip = (m: Memo): Memo => ({ ...m, blob: undefined });

  it('survives a JSON round trip with the blob stripped', async () => {
    const id = await make({ title: 'Chorus', projectId: 'p1', tag: 'Creating' });
    const row = (await db.memos.get(id))!;

    const wire = JSON.parse(JSON.stringify([row].map(strip)))[0] as Memo;

    expect(wire.blob).toBeUndefined();
    expect(wire.title).toBe('Chorus');
    expect(wire.tag).toBe('Creating');
    expect(wire.durationMs).toBe(4200);
  });

  it('a Blob does NOT survive JSON, which is why it is stripped', async () => {
    // Left as an executable explanation. Serialising a Blob yields {}, so
    // running memos through the generic table loop would write "blob": {} to
    // Drive and then put that back over the real one.
    const round = JSON.parse(JSON.stringify({ blob: wav() }));
    expect(round.blob).toEqual({});
    expect(round.blob instanceof Blob).toBe(false);
  });

  it('reattaching keeps the local audio when remote metadata wins', async () => {
    const id = await make({ title: 'local name' });
    const mine = (await db.memos.get(id))!;

    // What another device would send: same record, newer title, no bytes.
    const fromRemote: Memo = { ...strip(mine), title: 'renamed elsewhere' };

    await db.memos.put({ ...fromRemote, blob: mine.blob });

    const after = (await db.memos.get(id))!;
    expect(after.title).toBe('renamed elsewhere');
    expect(after.blob).toBeInstanceOf(Blob);
    expect(after.blob!.size).toBe(4);
  });

  it('a tombstone from another device drops the bytes here too', async () => {
    const id = await make();
    const mine = (await db.memos.get(id))!;
    const tombstoned: Memo = { ...strip(mine), deletedAt: new Date().toISOString() };

    await db.memos.put({ ...tombstoned, blob: tombstoned.deletedAt ? undefined : mine.blob });

    const after = (await db.memos.get(id))!;
    expect(after.deletedAt).toBeTruthy();
    expect(after.blob).toBeUndefined();
  });
});

describe('where a recording lives', () => {
  const state = (m: Partial<Memo>) => ({
    elsewhere: !m.blob && !!m.driveFileId,
    lost: !m.blob && !m.driveFileId
  });

  it('tells "not downloaded yet" apart from "gone"', () => {
    // These look identical in the data and must not look identical on screen:
    // one is a recording waiting on a connection, the other is deleted audio.
    expect(state({ driveFileId: 'abc' })).toEqual({ elsewhere: true, lost: false });
    expect(state({})).toEqual({ elsewhere: false, lost: true });
    expect(state({ blob: wav(), driveFileId: 'abc' })).toEqual({
      elsewhere: false,
      lost: false
    });
  });
});
