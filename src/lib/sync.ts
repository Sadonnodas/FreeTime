import { db } from './db';
import type { Base, Settings, ConflictLog } from './types';
import { now, uid } from './store';
import { mergeRecords, conflictFileName } from './merge';
import { getAccessToken } from './google/auth';
import {
  ensureFolders, list, readFile, readJsonArray, writeFile, DriveAuthError
} from './google/drive';
import { isGoogleConfigured } from './config';

/**
 * Background reconciliation (spec 8).
 *
 * Sync is never in the interaction path. Nothing in the app awaits it, no write
 * blocks on it, and a total failure here is invisible apart from a line in
 * Settings. That is the whole reason the local store is the source of truth.
 */

/** Table name in Dexie -> file name in Drive. The Drive names are the spec's. */
const FILES: { table: keyof typeof db & string; file: string }[] = [
  { table: 'projects', file: 'projects.json' },
  { table: 'todos', file: 'todos.json' },
  { table: 'ideas', file: 'ideas.json' },
  { table: 'buyItems', file: 'buy.json' },
  { table: 'lists', file: 'lists.json' },
  { table: 'listItems', file: 'list-items.json' },
  { table: 'habits', file: 'habits.json' },
  { table: 'habitLogs', file: 'habit-logs.json' },
  { table: 'days', file: 'days.json' },
  { table: 'captures', file: 'captures.json' }
];

export type SyncState =
  | { status: 'idle'; lastSyncAt?: string }
  | { status: 'syncing' }
  | { status: 'paused'; reason: 'no-token' | 'offline' | 'not-configured' }
  | { status: 'error'; message: string };

let current: SyncState = { status: 'idle' };
const listeners = new Set<(s: SyncState) => void>();

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

function setState(s: SyncState) {
  current = s;
  for (const fn of listeners) fn(s);
}

async function settings(): Promise<Settings | undefined> {
  return db.settings.get('settings');
}

async function patchSettings(fields: Partial<Settings>): Promise<void> {
  const existing = await settings();
  const t = now();
  if (existing) await db.settings.update('settings', { ...fields, updatedAt: t });
  else await db.settings.add({ id: 'settings', ...fields, updatedAt: t });
}

/** A short, plain-language note for Settings when a near-simultaneous edit was
 *  discarded. Quiet by default — the user is never interrupted for this. */
async function logOverwrites(table: string, overwrites: { overwritten: Base }[]): Promise<void> {
  if (!overwrites.length) return;
  const rows: ConflictLog[] = overwrites.map((o) => ({
    id: uid(),
    table,
    recordId: o.overwritten.id,
    overwrittenJson: JSON.stringify(o.overwritten),
    createdAt: now(),
    updatedAt: now()
  }));
  await db.conflicts.bulkAdd(rows);
}

/**
 * Project notes, as real .md files (spec 8.2).
 *
 * File-level last-write-wins, because prose does not merge by field. On a real
 * clash both versions survive — one under a "(conflict <date>)" name. Losing a
 * paragraph someone wrote is far worse than leaving two files to reconcile.
 */
async function syncNotes(token: string, notesFolderId: string): Promise<void> {
  const [notes, projects, remote] = await Promise.all([
    db.notes.toArray(),
    db.projects.toArray(),
    list(token, { parentId: notesFolderId })
  ]);

  const slug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

  for (const note of notes.filter((n) => !n.deletedAt)) {
    const project = projects.find((p) => p.id === note.projectId);
    if (!project) continue;

    const fileName = `${slug(project.name)}.md`;
    const existing = remote.find((f) => f.name === fileName);

    if (!existing) {
      await writeFile(token, {
        name: fileName,
        parentId: notesFolderId,
        content: note.markdown,
        mimeType: 'text/markdown'
      });
      continue;
    }

    const remoteText = await readFile(token, existing.id);
    if (remoteText === note.markdown) continue;

    const remoteNewer =
      !!existing.modifiedTime && existing.modifiedTime > note.updatedAt;

    if (remoteNewer && remoteText !== null) {
      // Their copy is newer and differs. Take it locally, but park ours beside
      // it rather than dropping the text.
      await writeFile(token, {
        name: conflictFileName(fileName),
        parentId: notesFolderId,
        content: note.markdown,
        mimeType: 'text/markdown'
      });
      await db.notes.update(note.id, { markdown: remoteText, updatedAt: now() });
    } else {
      await writeFile(token, {
        id: existing.id,
        name: fileName,
        parentId: notesFolderId,
        content: note.markdown,
        mimeType: 'text/markdown'
      });
    }
  }
}

/**
 * One full pass: pull every file, merge per record, write back whatever
 * changed on either side.
 *
 * Runs sequentially rather than in parallel — ten concurrent uploads to Drive
 * invites rate limiting, and there is no deadline here worth defending.
 */
export async function syncNow(): Promise<SyncState> {
  if (!isGoogleConfigured()) {
    const s: SyncState = { status: 'paused', reason: 'not-configured' };
    setState(s);
    return s;
  }
  if (!navigator.onLine) {
    const s: SyncState = { status: 'paused', reason: 'offline' };
    setState(s);
    return s;
  }

  const token = await getAccessToken();
  if (!token) {
    // The hour ran out. Local writes carry on regardless; the next safe moment
    // renews the token and this picks up where it left off.
    const s: SyncState = { status: 'paused', reason: 'no-token' };
    setState(s);
    return s;
  }

  setState({ status: 'syncing' });

  try {
    const { folderId, notesFolderId } = await ensureFolders(token);
    const remoteFiles = await list(token, { parentId: folderId });
    const ids: Record<string, string> = {};

    for (const { table, file } of FILES) {
      const existing = remoteFiles.find((f) => f.name === file);
      const local = (await (db[table] as never as { toArray(): Promise<Base[]> }).toArray()) ?? [];
      const remote = existing ? await readJsonArray<Base>(token, existing.id) : [];

      const { merged, overwrites, localChanged, remoteChanged } = mergeRecords(local, remote);

      if (localChanged) {
        applyingRemote = true;
        try {
          await (db[table] as never as { bulkPut(rows: Base[]): Promise<unknown> }).bulkPut(merged);
        } finally {
          applyingRemote = false;
        }
      }
      await logOverwrites(table, overwrites);

      if (remoteChanged || !existing) {
        const id = await writeFile(token, {
          id: existing?.id,
          name: file,
          parentId: folderId,
          content: JSON.stringify(merged, null, 2)
        });
        ids[file] = id;
      } else if (existing) {
        ids[file] = existing.id;
      }
    }

    await syncNotes(token, notesFolderId);

    const lastSyncAt = now();
    await patchSettings({
      driveFolderId: folderId,
      driveNotesFolderId: notesFolderId,
      driveFileIds: ids,
      lastSyncAt
    });

    const s: SyncState = { status: 'idle', lastSyncAt };
    setState(s);
    return s;
  } catch (err) {
    if (err instanceof DriveAuthError) {
      const s: SyncState = { status: 'paused', reason: 'no-token' };
      setState(s);
      return s;
    }
    const s: SyncState = { status: 'error', message: (err as Error).message };
    setState(s);
    return s;
  }
}

// ------------------------------------------------------------- triggers (8.4)

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let intervalTimer: ReturnType<typeof setInterval> | undefined;
let running = false;

/** Serialised: a second pass never starts on top of a first. */
async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await syncNow();
  } finally {
    running = false;
  }
}

/** Called after any write. Debounced, so a burst of captures is one sync. */
export function scheduleSync(delayMs = 10_000): void {
  if (applyingRemote) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void runOnce(), delayMs);
}

/**
 * Set while sync writes merged records into the local store. Without it, our
 * own bulkPut would look like a user edit, schedule another sync, and the app
 * would chase its own tail — harmlessly, but forever.
 */
let applyingRemote = false;

/**
 * Subscribes to every table's writes via Dexie's own hooks, rather than making
 * store.ts call out to sync after each mutation. One registration covers every
 * write path there will ever be, including the Gemini assistant's in phase 4 —
 * a list of manual call sites would have quietly missed those.
 */
function watchWrites(): () => void {
  const events = ['creating', 'updating', 'deleting'] as const;
  const bump = () => scheduleSync();
  const registered: { table: { hook: (n: string) => { unsubscribe(f: unknown): void } }; event: string }[] = [];

  for (const table of db.tables) {
    // Sync writes its own bookkeeping here; watching it would be self-referential.
    if (table.name === 'settings' || table.name === 'conflicts') continue;
    for (const event of events) {
      (table as unknown as { hook(n: string, f: unknown): void }).hook(event, bump);
      registered.push({ table: table as never, event });
    }
  }

  return () => {
    for (const { table, event } of registered) table.hook(event).unsubscribe(bump);
  };
}

/**
 * Wires up the spec's triggers: on focus, after writes (via scheduleSync), and
 * on a slow interval while the app is in front. Nothing here is awaited by the
 * UI, and the interval is cleared when the tab is hidden so a backgrounded
 * phone is not quietly burning battery on Drive calls.
 */
export function startSync(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') void runOnce();
  };

  const stopWatching = watchWrites();

  void runOnce();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);
  intervalTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void runOnce();
  }, 5 * 60 * 1000);

  return () => {
    stopWatching();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onVisible);
    clearInterval(intervalTimer);
    clearTimeout(debounceTimer);
  };
}
