import type { Base } from './types';

/**
 * Per-record reconciliation (spec 8.3).
 *
 * Deliberately not a CRDT. This is one person on two devices, so genuine
 * simultaneous edits to the same record are rare, and last-write-wins per
 * record is enough. Merging per record rather than per file is the part that
 * actually matters: whole-file last-write-wins would lose every to-do added on
 * the phone the moment the laptop wrote its copy.
 */

/**
 * If both sides changed a record within this window, the loser is logged.
 * Outside it, one edit is simply older than the other and there is nothing
 * interesting to say.
 */
export const CONFLICT_WINDOW_MS = 5 * 60 * 1000;

export interface Overwrite<T> {
  /** The version that won. */
  kept: T;
  /** The version that lost, kept verbatim so it can be recovered by hand. */
  overwritten: T;
}

export interface MergeResult<T> {
  merged: T[];
  /** Near-simultaneous edits where one side was discarded. Surfaced in Settings. */
  overwrites: Overwrite<T>[];
  /** True if the merged set differs from what was passed as `local`. */
  localChanged: boolean;
  /** True if the merged set differs from what was passed as `remote`. */
  remoteChanged: boolean;
}

const byId = <T extends Base>(rows: T[]): Map<string, T> =>
  new Map(rows.map((r) => [r.id, r]));

/**
 * A tombstone always survives (the spec's "union of tombstones").
 *
 * Note this beats a *newer* edit on the other side: delete on the laptop at
 * 10:00, edit on the phone at 10:05, and the record stays deleted. That is the
 * right trade here because nothing in the app ever clears a tombstone, so the
 * alternative — letting an edit resurrect a deleted record — would make deletes
 * unreliable in exactly the case sync exists to handle. The losing edit is
 * still recorded in `overwrites` if it was close in time.
 */
function withTombstone<T extends Base>(winner: T, a: T, b: T): T {
  const deletions = [a.deletedAt, b.deletedAt].filter((d): d is string => !!d).sort();
  if (!deletions.length) return winner;
  return { ...winner, deletedAt: deletions[0]! };
}

/** Field-level comparison that ignores updatedAt, which always differs. */
function sameContent<T extends Base>(a: T, b: T): boolean {
  const strip = ({ updatedAt: _u, ...rest }: T) => JSON.stringify(rest, Object.keys(rest).sort());
  return strip(a) === strip(b);
}

export function mergeRecords<T extends Base>(local: T[], remote: T[]): MergeResult<T> {
  const l = byId(local);
  const r = byId(remote);
  const merged: T[] = [];
  const overwrites: Overwrite<T>[] = [];

  let localChanged = false;
  let remoteChanged = false;

  for (const id of new Set([...l.keys(), ...r.keys()])) {
    const mine = l.get(id);
    const theirs = r.get(id);

    if (mine && !theirs) {
      merged.push(mine);
      remoteChanged = true;
      continue;
    }
    if (theirs && !mine) {
      merged.push(theirs);
      localChanged = true;
      continue;
    }
    if (!mine || !theirs) continue;

    // Higher updatedAt wins. Ties keep the local copy — an arbitrary but
    // stable choice, so repeated syncs converge instead of flapping.
    const theirsWins = theirs.updatedAt > mine.updatedAt;
    const winner = withTombstone(theirsWins ? theirs : mine, mine, theirs);
    const loser = theirsWins ? mine : theirs;

    merged.push(winner);

    if (!sameContent(mine, theirs)) {
      if (theirsWins) localChanged = true;
      else remoteChanged = true;

      const gap = Math.abs(
        new Date(mine.updatedAt).getTime() - new Date(theirs.updatedAt).getTime()
      );
      if (gap < CONFLICT_WINDOW_MS) overwrites.push({ kept: winner, overwritten: loser });
    } else if (winner.deletedAt !== mine.deletedAt) {
      localChanged = true;
    }
  }

  merged.sort((a, b) => a.id.localeCompare(b.id));
  return { merged, overwrites, localChanged, remoteChanged };
}

/**
 * Notes are markdown files, not records, so they get file-level last-write-wins
 * (spec 8.3). On a real clash both texts are kept — a note is prose someone
 * typed, and silently dropping a paragraph is far worse than leaving a second
 * file to reconcile by hand.
 */
export function conflictFileName(name: string, at = new Date()): string {
  const stem = name.replace(/\.md$/, '');
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
  return `${stem} (conflict ${stamp}).md`;
}
