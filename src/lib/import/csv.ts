/**
 * A small RFC 4180 CSV parser.
 *
 * Hand-written rather than pulled in as a dependency, because the interesting
 * cases are few and entirely predictable: Notion quotes any field containing a
 * comma, a newline, or a quote, and escapes an inner quote by doubling it. A
 * naive `line.split(',')` mangles every to-do with a comma in it — which, in a
 * personal backlog, is a lot of them.
 */

export type Row = Record<string, string>;

/** Splits into fields, respecting quotes. Handles newlines inside quotes. */
export function parseCsv(text: string): Row[] {
  // Strip a UTF-8 BOM. Notion exports one, and left in place it becomes part of
  // the first header name, so every lookup of that column silently misses.
  const input = text.replace(/^﻿/, '');

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // Ignore; the \n that follows ends the row.
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += ch;
    }
  }

  // A file not ending in a newline still has one last row to flush.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];

  const keys = header.map((h) => h.trim());
  return body
    // Trailing blank lines produce a single empty field, not a real row.
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** Column names present in the file, in order. */
export function headersOf(text: string): string[] {
  const first = parseCsv(text)[0];
  return first ? Object.keys(first) : [];
}
