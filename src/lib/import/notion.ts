import type { Energy } from '../types';
import type { Row } from './csv';

/**
 * Turning Notion export rows into something importable (spec 9).
 *
 * Column names are guessed, never assumed. A Notion export names columns after
 * whatever the user called their properties, so anything hardcoded would work
 * on one export and silently produce empty records on the next. Every guess is
 * shown in the UI and can be overridden before anything is written.
 */

export type Target = 'todo' | 'buy' | 'idea' | 'list_item';

export interface Mapping {
  title?: string;
  project?: string;
  energy?: string;
  date?: string;
  url?: string;
  price?: string;
  done?: string;
  notes?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** First header whose normalised name matches any candidate. */
function find(headers: string[], candidates: string[]): string | undefined {
  const wanted = candidates.map(norm);
  return (
    headers.find((h) => wanted.includes(norm(h))) ??
    headers.find((h) => wanted.some((w) => norm(h).includes(w)))
  );
}

const isUrl = (v: string) => /^https?:\/\//i.test(v.trim());
const isBool = (v: string) => ['yes', 'no', 'true', 'false', ''].includes(norm(v));

/**
 * Columns identified by what they CONTAIN, not what they are called.
 *
 * Necessary because a real Notion export names unconfigured properties
 * "Property" — and in this user's export that single name means a Yes/No flag
 * in the to-do table and a URL in the shopping list. No amount of header
 * matching can tell those apart, so the values decide.
 */
export interface ContentHints {
  urlColumn?: string;
  boolColumn?: string;
}

export function detectByContent(rows: Row[], headers: string[]): ContentHints {
  const sample = rows.slice(0, 50);
  const values = (h: string) => sample.map((r) => r[h] ?? '').filter((v) => v.trim() !== '');

  const urlColumn = headers.find((h) => {
    const v = values(h);
    return v.length > 0 && v.every(isUrl);
  });

  const boolColumn = headers.find((h) => {
    const v = values(h);
    // Needs both values present, or a column of all "No" looks boolean but
    // carries no information worth mapping.
    return v.length > 1 && v.every(isBool) && new Set(v.map(norm)).size > 1;
  });

  return { urlColumn, boolColumn };
}

/**
 * Best-effort column guesses.
 *
 * Notion always exports the title property first, so that is the fallback for
 * the title column when nothing recognisable is found — far more reliable than
 * hoping someone named it "Name".
 *
 * Pass `rows` to also identify columns by their contents, which is what makes
 * a uselessly-named "Property" column resolvable.
 */
export function guessMapping(headers: string[], target: Target, rows: Row[] = []): Mapping {
  const byContent: ContentHints = rows.length ? detectByContent(rows, headers) : {};
  const title = find(headers, ['name', 'title', 'task', 'item', 'todo']) ?? headers[0];

  const base: Mapping = {
    title,
    project: find(headers, ['project', 'workstream', 'area', 'category']),
    notes: find(headers, ['notes', 'description', 'details'])
  };

  if (target === 'todo') {
    return {
      ...base,
      // Spec 3.2: Notion's Difficulty column maps directly onto energy.
      energy: find(headers, ['difficulty', 'energy', 'effort', 'size']),
      date: find(headers, ['date', 'due', 'deadline', 'when']),
      done: find(headers, ['done', 'complete', 'completed', 'status']) ?? byContent.boolColumn
    };
  }
  if (target === 'buy') {
    return {
      ...base,
      url: find(headers, ['url', 'link', 'website']) ?? byContent.urlColumn,
      price: find(headers, ['price', 'cost', 'amount'])
    };
  }
  if (target === 'list_item') {
    return { ...base, url: find(headers, ['url', 'link']) ?? byContent.urlColumn };
  }
  return base;
}

/** Quick Win -> quick, Moderate -> moderate, Focus -> focus (spec 3.2). */
export function parseEnergy(raw?: string): Energy | undefined {
  const v = norm(raw ?? '');
  if (!v) return undefined;
  if (v.includes('quick')) return 'quick';
  if (v.includes('moderate') || v.includes('medium')) return 'moderate';
  if (v.includes('focus') || v.includes('deep') || v.includes('hard')) return 'focus';
  return undefined;
}

/**
 * Notion dates, parsed conservatively.
 *
 * Real exports look like `Feb 3`, `Mar 22`, or `Feb 3 → Feb 3` — Notion omits
 * the year for dates in the export year, and writes ranges with an arrow.
 *
 * A year-less date is REFUSED rather than guessed, and that matters more than
 * it looks. `Date.parse('Mar 22')` happily returns a date, so a naive parser
 * would import dozens of stale entries as this year's, every one of them
 * landing in the past. This app has no "overdue" state by design — a past date
 * simply means "this is a real obligation", so those rows would permanently
 * occupy the obligation slot in Free Time with months-old noise. Dropping the
 * date keeps the to-do, and an undated to-do waits patiently, which is exactly
 * what the spec wants.
 */
export function parseDate(raw?: string): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;

  // Ranges: only the start is meaningful for a single-date field.
  const start = v.split('→')[0]!.trim();

  const iso = start.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  // No explicit four-digit year, no date. See above.
  if (!/\b\d{4}\b/.test(start)) return undefined;

  const parsed = Date.parse(start);
  if (Number.isNaN(parsed)) return undefined;
  const d = new Date(parsed);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when a value looks like a date Notion wrote without a year. */
export function isYearlessDate(raw?: string): boolean {
  const v = raw?.trim();
  if (!v) return false;
  return !/\b\d{4}\b/.test(v) && /[A-Za-z]{3}|\d{1,2}\/\d{1,2}/.test(v);
}

/** "€12,50", "12.50", "$12" -> cents. */
export function parsePriceCents(raw?: string): number | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const cleaned = v.replace(/[^\d.,]/g, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

export function parseDone(raw?: string): boolean {
  const v = norm(raw ?? '');
  return v === 'yes' || v === 'true' || v === 'done' || v === 'complete' || v === 'completed';
}

export interface Candidate {
  /** Stable within one import run, for list keys and triage. */
  key: string;
  title: string;
  projectName?: string;
  energy?: Energy;
  date?: string;
  url?: string;
  priceCents?: number;
  done: boolean;
  notes?: string;
}

export function toCandidates(rows: Row[], mapping: Mapping): Candidate[] {
  return rows
    .map((row, i) => {
      const title = (mapping.title ? row[mapping.title] : '')?.trim() ?? '';
      return {
        key: `r${i}`,
        title,
        projectName: mapping.project ? row[mapping.project]?.trim() || undefined : undefined,
        energy: parseEnergy(mapping.energy ? row[mapping.energy] : undefined),
        date: parseDate(mapping.date ? row[mapping.date] : undefined),
        url: mapping.url ? row[mapping.url]?.trim() || undefined : undefined,
        priceCents: parsePriceCents(mapping.price ? row[mapping.price] : undefined),
        done: parseDone(mapping.done ? row[mapping.done] : undefined),
        notes: mapping.notes ? row[mapping.notes]?.trim() || undefined : undefined
      };
    })
    // A row with no title is an empty Notion page — the export is full of them,
    // and there is nothing to import.
    .filter((c) => c.title.length > 0);
}
