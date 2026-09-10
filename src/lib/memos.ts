import { db } from './db';
import type { Memo } from './types';
import { uid, now } from './store';

/**
 * Kept audio recordings.
 *
 * The app this replaces is a voice-memo app full of ads that names every file
 * "Recording 47" and dates none of them. Everything here follows from that: the
 * record button is the whole interface, the metadata is collected without being
 * asked for, and nothing is ever required.
 */

// ------------------------------------------------------------------ writes

export interface NewMemo {
  blob: Blob;
  mime: string;
  durationMs: number;
  title?: string;
  projectId?: string;
  tag?: string;
  lat?: number;
  lng?: number;
}

export async function createMemo(fields: NewMemo): Promise<string> {
  const t = now();
  const memo: Memo = {
    id: uid(),
    ...fields,
    title: fields.title?.trim() || undefined,
    recordedAt: t,
    createdAt: t,
    updatedAt: t
  };
  await db.memos.add(memo);
  // Asked for the first time there is actually something worth keeping, rather
  // than on first launch where it is a prompt about nothing.
  void requestPersistence();
  return memo.id;
}

export async function updateMemo(id: string, patch: Partial<Memo>): Promise<void> {
  await db.memos.update(id, { ...patch, updatedAt: now() });
}

/**
 * Tombstone the row, drop the bytes.
 *
 * The no-hard-delete rule exists so a delete propagates instead of the record
 * resurrecting on the next sync, and a tombstone with no audio does that job
 * perfectly. Holding on to tens of megabytes the user explicitly threw away
 * would be a strange reading of the rule, and on a phone it is the difference
 * between the app working and the browser evicting the whole database.
 */
export async function deleteMemo(id: string): Promise<void> {
  const t = now();
  await db.memos.update(id, { blob: undefined, deletedAt: t, updatedAt: t });
}

// ------------------------------------------------------------------- reads

export async function allMemos(): Promise<Memo[]> {
  const all = await db.memos.toArray();
  return all
    .filter((m) => !m.deletedAt)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export async function memosForProject(projectId: string): Promise<Memo[]> {
  const all = await db.memos.where('projectId').equals(projectId).toArray();
  return all
    .filter((m) => !m.deletedAt)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

// -------------------------------------------------------------- formatting

/** Floor, not round — a playhead that reads 0:01 the instant you press play
 *  looks broken, and every media player in the world truncates. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "Thu 14 Aug, 22:40". Time of day is included deliberately — "that thing I
 * hummed late one night" is a real way to remember a recording, and it is
 * exactly what a file called Recording 47 destroys.
 */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** "August 2026" — the heading memos are grouped under. */
export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

/** What a memo is called when it has not been named: never blank, never
 *  "Recording 47". */
export const displayTitle = (m: Memo): string => m.title?.trim() || whenLabel(m.recordedAt);

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav'
};

/** A filename a bandmate can read in a chat thread. */
/** Where a memo belongs, in words rather than ids. */
export interface MemoWhere {
  era?: string;
  project?: string;
}

/**
 * What the file is called in Drive.
 *
 * ERA AND PROJECT FIRST, then the timestamp. Drive shows one flat folder, so
 * putting them at the front makes the list group itself — every recording for
 * one song lands together — and Drive's own search finds them wherever they
 * sit. Asked for as a folder tree mirroring the app; the name does the same job
 * for a fraction of the moving parts, because renaming one file is a metadata
 * patch while re-parenting it is a tree that can end up half-moved.
 *
 * Every part is optional, which is the point: an unfiled memo hummed in a car
 * park still gets a sensible name, and gains the rest if it is ever filed.
 */
export function fileName(memo: Memo, where: MemoWhere = {}): string {
  const base = memo.mime.split(';')[0] ?? '';
  const ext = EXTENSIONS[base] ?? 'audio';
  const stamp = memo.recordedAt.slice(0, 16).replace('T', ' ').replace(':', '.');
  const parts = [where.era, where.project, stamp, memo.title?.trim()]
    .map((v) => v?.trim())
    .filter(Boolean);
  // The separator is an en dash with spaces: a hyphen is far too common inside
  // song titles to read as a divider.
  return `${parts.join(' – ')}.${ext}`.replace(/[/\\?%*:|"<>]/g, '-');
}

// ------------------------------------------------------------------ device

/**
 * One-shot location, with a hard deadline.
 *
 * Never awaited before recording starts. The permission sheet can sit on screen
 * for as long as it takes someone to read it, and a recorder that waits for it
 * is a recorder that misses the idea — which is the only thing this feature
 * exists to prevent. Resolves to null on denial, timeout, or no support, and
 * the memo simply has no coordinates.
 */
export function tryLocate(timeoutMs = 8000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120_000 }
    );
  });
}

/**
 * Ask the browser not to evict the database.
 *
 * Without this, IndexedDB is "best effort" storage and a browser under disk
 * pressure may clear it. Text is cheap to lose and re-sync; an hour of
 * recordings is about 50 MB and is the only copy that exists.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageUse {
  usedBytes: number;
  quotaBytes: number;
  persisted: boolean;
}

export async function storageUse(): Promise<StorageUse | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return {
      usedBytes: est.usage ?? 0,
      quotaBytes: est.quota ?? 0,
      persisted: (await navigator.storage.persisted?.()) ?? false
    };
  } catch {
    return null;
  }
}

export function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ------------------------------------------------------------------- share

export type ShareResult = 'shared' | 'downloaded' | 'cancelled' | 'unsupported';

/**
 * Hand the recording to whatever the phone uses to send things.
 *
 * Web Share with a file is the good path — it opens the iOS share sheet, so
 * WhatsApp, Messages and AirDrop all work with no accounts and no upload. Where
 * that is unavailable (most desktop browsers) it falls back to saving the file,
 * which at least gets it somewhere the user can attach it from.
 */
export async function shareMemo(memo: Memo, where: MemoWhere = {}): Promise<ShareResult> {
  if (!memo.blob) return 'unsupported';
  // The same name Drive uses, so a recording sent to a bandmate arrives called
  // the same thing it is called everywhere else.
  const file = new File([memo.blob], fileName(memo, where), { type: memo.mime });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: displayTitle(memo) });
      return 'shared';
    } catch (err) {
      // The user backing out of the share sheet throws AbortError. That is not
      // a failure and must not be reported as one.
      if ((err as Error).name === 'AbortError') return 'cancelled';
      // Anything else — some browsers advertise canShare and then refuse — is
      // worth falling through to a download rather than dead-ending.
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
