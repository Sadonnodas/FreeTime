import { db } from '../db';
import {
  createTodo, createIdea, createBuyItem, capture, uid, now
} from '../store';
import { activeProjects } from '../queries';
import type { ExtractedItem } from './extract';
import type { QueuedAudio } from '../types';
import { extractFromAudio } from './extract';
import { hasApiKey } from './client';

/**
 * Writing extracted items into the store.
 *
 * Everything goes through store.ts, exactly like a manual edit (spec 7.1), so
 * these writes queue offline, bump updatedAt, and sync identically. The model
 * never touches Drive and never touches Dexie directly.
 */

/** Matches a spoken project name to a real one. Case- and space-insensitive,
 *  and nothing more — a fuzzy match that guesses wrong silently files work
 *  under the wrong project, which is worse than leaving it unassigned. */
async function resolveProjectId(name?: string): Promise<string | undefined> {
  if (!name?.trim()) return undefined;
  const wanted = name.trim().toLowerCase();
  const projects = await activeProjects();
  return projects.find((p) => p.name.toLowerCase() === wanted)?.id;
}

export async function commitItems(items: ExtractedItem[]): Promise<number> {
  let written = 0;

  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    const projectId = await resolveProjectId(item.projectName);

    switch (item.kind) {
      case 'todo':
        await createTodo(text, { projectId, energy: item.energy });
        break;
      case 'idea':
        await createIdea(text, { projectId });
        break;
      case 'buy':
        await createBuyItem(text, { url: item.url, projectId });
        break;
      default:
        // Anything else — including 'list_item' from an older prompt still in
        // flight — is a thought. A want is a thought with no action attached,
        // and it lands unfiled, which is a resting state rather than a loss.
        await createIdea(text, { projectId });
        break;
    }
    written++;
  }

  return written;
}

// ------------------------------------------------------------- offline queue

export async function queueAudio(blob: Blob, durationMs: number): Promise<string> {
  const row: QueuedAudio = {
    id: uid(),
    blob,
    durationMs,
    attempts: 0,
    createdAt: now(),
    updatedAt: now()
  };
  await db.audioQueue.add(row);
  return row.id;
}

export async function pendingAudioCount(): Promise<number> {
  return (await db.audioQueue.toArray()).filter((a) => !a.processedAt && !a.deletedAt).length;
}

/**
 * Drains the queue. Called when connectivity returns.
 *
 * Items are only marked processed once their contents are safely in the store,
 * so a failure halfway leaves the recording queued rather than half-imported.
 * Nothing is auto-committed silently: extraction results still land in the
 * inbox as captures if the user never saw a review screen, because a silent AI
 * write is exactly what erodes trust in the store.
 */
export async function processQueue(): Promise<number> {
  if (!navigator.onLine || !(await hasApiKey())) return 0;

  const pending = (await db.audioQueue.toArray())
    .filter((a) => !a.processedAt && !a.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let done = 0;
  for (const row of pending) {
    try {
      const { items, transcript } = await extractFromAudio({ wav: row.blob });
      if (items.length) await commitItems(items);
      else if (transcript.trim()) await capture(transcript.trim());
      await db.audioQueue.update(row.id, { processedAt: now(), updatedAt: now() });
      done++;
    } catch (err) {
      await db.audioQueue.update(row.id, {
        attempts: row.attempts + 1,
        lastError: (err as Error).message,
        updatedAt: now()
      });
      // Stop on the first failure. If the key is wrong or we are rate limited,
      // grinding through the rest just burns quota to fail identically.
      break;
    }
  }
  return done;
}
