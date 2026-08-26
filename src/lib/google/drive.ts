import { DRIVE_FOLDER, DRIVE_NOTES_FOLDER } from '../config';

/**
 * Google Drive REST v3, hand-rolled.
 *
 * The official client library is large, assumes a bundler-unfriendly global,
 * and we need five calls. Raw fetch is smaller and clearer about exactly what
 * crosses the wire.
 *
 * Everything here works within the drive.file scope, which grants access ONLY
 * to files this app created. A practical consequence: `list` cannot see the
 * user's other files at all, so a query that finds nothing means "we never
 * made it", not "it isn't there".
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveAuthError extends Error {
  constructor() {
    super('Drive rejected the access token.');
    this.name = 'DriveAuthError';
  }
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
  });
  // 401 means the hour ran out. The caller stops and waits for a safe moment
  // to renew rather than redirecting from inside a background sync.
  if (res.status === 401) throw new DriveAuthError();
  if (!res.ok) throw new Error(`Drive ${init.method ?? 'GET'} ${res.status}: ${await res.text()}`);
  return res;
}

/** Files this app created, optionally within one folder. */
export async function list(
  token: string,
  opts: { name?: string; parentId?: string; mimeType?: string } = {}
): Promise<DriveFile[]> {
  const clauses = ['trashed = false'];
  if (opts.name) clauses.push(`name = '${opts.name.replace(/'/g, "\\'")}'`);
  if (opts.parentId) clauses.push(`'${opts.parentId}' in parents`);
  if (opts.mimeType) clauses.push(`mimeType = '${opts.mimeType}'`);

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name,modifiedTime)',
    spaces: 'drive',
    pageSize: '200'
  });
  const res = await call(token, `${API}/files?${params}`);
  return (await res.json()).files ?? [];
}

export async function createFolder(
  token: string,
  name: string,
  parentId?: string
): Promise<string> {
  const res = await call(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {})
    })
  });
  return (await res.json()).id;
}

async function findOrCreateFolder(
  token: string,
  name: string,
  parentId?: string
): Promise<string> {
  const found = await list(token, { name, parentId, mimeType: FOLDER_MIME });
  if (found[0]) return found[0].id;
  return createFolder(token, name, parentId);
}

/**
 * The app's folder, and the notes folder inside it. Rediscovered rather than
 * only remembered — clearing site data must not orphan the user's Drive copy
 * and start a duplicate FreeTime folder next to it.
 */
export async function ensureFolders(
  token: string
): Promise<{ folderId: string; notesFolderId: string }> {
  const folderId = await findOrCreateFolder(token, DRIVE_FOLDER);
  const notesFolderId = await findOrCreateFolder(token, DRIVE_NOTES_FOLDER, folderId);
  return { folderId, notesFolderId };
}

/**
 * Creates or replaces a file's contents.
 *
 * Creating needs metadata (name, parent) AND bytes in one request, which Drive
 * expresses as a multipart/related body — two parts, a JSON one and a content
 * one, separated by a boundary string. Updating is simpler: the file already
 * knows its name and parent, so uploadType=media sends bare bytes.
 */
export async function writeFile(
  token: string,
  opts: { id?: string; name: string; parentId: string; content: string; mimeType?: string }
): Promise<string> {
  const mimeType = opts.mimeType ?? 'application/json';

  if (opts.id) {
    const res = await call(token, `${UPLOAD}/files/${opts.id}?uploadType=media&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: opts.content
    });
    return (await res.json()).id;
  }

  const boundary = `ft${crypto.randomUUID().replace(/-/g, '')}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name: opts.name, parents: [opts.parentId] })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${opts.content}\r\n` +
    `--${boundary}--`;

  const res = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  return (await res.json()).id;
}

/** File contents as text, or null if the id no longer resolves. */
export async function readFile(token: string, id: string): Promise<string | null> {
  try {
    const res = await call(token, `${API}/files/${id}?alt=media`);
    return await res.text();
  } catch (err) {
    if (err instanceof DriveAuthError) throw err;
    return null;
  }
}

/** Reads and parses a JSON array, tolerating a corrupt or truncated file.
 *  Returning [] there is safe: the merge treats it as "remote has nothing",
 *  and the next write restores the full local set. */
export async function readJsonArray<T>(token: string, id: string): Promise<T[]> {
  const text = await readFile(token, id);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
