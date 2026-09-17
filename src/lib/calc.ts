import { stripMarker } from './textLists';

/**
 * Sums in quick notes: a line ending in "=" is worked out, and a note can be
 * totalled.
 *
 * Asked for as *"add, sum up and numbers in the quick notes"*. The notes are
 * where measurements and prices get written down in a hurry, so the arithmetic
 * belongs there too — the way the phone's own Notes app does it: type
 * `2.43 + 1.10 =` and the answer appears after the "=".
 *
 * NEVER `eval`. A note syncs, so anything evaluated from one is text that
 * arrived from another device; this is a small parser that knows numbers,
 * + − × ÷, brackets and nothing else, and returns null for anything it does
 * not understand rather than guessing.
 *
 * A comma is a decimal point ("1,10"), because that is how numbers are written
 * here; thousands separators are not supported, since "1,100" would otherwise
 * be ambiguous and a wrong sum is worse than none.
 */

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^\d+(?:[.,]\d+)?|^[.,]\d+/.exec(src.slice(i));
    if (num) {
      tokens.push({ kind: 'num', value: Number(num[0].replace(',', '.')) });
      i += num[0].length;
      continue;
    }
    const op = { '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', x: '*', X: '*', '×': '*', '/': '/', '÷': '/', ':': '/', '(': '(', ')': ')' }[ch];
    if (!op) return null;
    tokens.push({ kind: 'op', value: op });
    i++;
  }
  return tokens;
}

/** The value of an arithmetic expression, or null if it is not one. */
export function evaluate(src: string): number | null {
  const tokens = tokenize(src);
  if (!tokens || !tokens.length) return null;
  // One bare number is not a sum; "=" after it has nothing to work out.
  if (!tokens.some((t) => t.kind === 'op' && t.value !== '(' && t.value !== ')')) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.kind === 'op' && peek()!.value === v;

  function primary(): number | null {
    const t = peek();
    if (!t) return null;
    if (t.kind === 'num') {
      pos++;
      return t.value;
    }
    if (isOp('-')) {
      pos++;
      const v = primary();
      return v === null ? null : -v;
    }
    if (isOp('+')) {
      pos++;
      return primary();
    }
    if (isOp('(')) {
      pos++;
      const v = sum();
      if (v === null || !isOp(')')) return null;
      pos++;
      return v;
    }
    return null;
  }
  function product(): number | null {
    let left = primary();
    while (left !== null && (isOp('*') || isOp('/'))) {
      const op = peek()!.value;
      pos++;
      const right = primary();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function sum(): number | null {
    let left = product();
    while (left !== null && (isOp('+') || isOp('-'))) {
      const op = peek()!.value;
      pos++;
      const right = product();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  const result = sum();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

/**
 * A result written the way the inputs were: rounded away from float noise
 * (0.1 + 0.2 is 0.3), with a comma if the expression used one.
 */
export function formatNumber(value: number, comma = false): string {
  const rounded = Math.round(value * 1e8) / 1e8;
  const text = String(rounded);
  return comma ? text.replace('.', ',') : text;
}

/**
 * If the text before `caret` ends a line with "expression =", the answer to
 * write after it. The expression is the stretch of the line before "=" that
 * parses — so "Hall 2.43 + 1.10 =" works, the words in front ignored.
 */
export function answerFor(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  if (!before.endsWith('=')) return null;
  const line = before.slice(before.lastIndexOf('\n') + 1, -1);
  // Try the longest tail of the line that is a valid expression.
  for (let start = 0; start < line.length; start++) {
    if (start > 0 && !/[\s(]/.test(line[start - 1])) continue;
    const expr = line.slice(start);
    const value = evaluate(expr);
    if (value !== null) return formatNumber(value, /\d,\d/.test(expr));
  }
  return null;
}

export interface Total {
  /** The number taken from each line that has one, in order. */
  parts: number[];
  total: number;
  comma: boolean;
}

/**
 * The note added up: the LAST number on each line that has one.
 *
 * Last, because that is where a price or an answer sits — "milk 1.19",
 * "2.43 + 1.10 = 3.53" — and one per line, because a line like "2.43 by 1.10"
 * is one measurement and not two amounts. That is a guess about what the
 * numbers mean, so the screen always shows the parts it added, never just the
 * total.
 */
export function totalOf(text: string): Total | null {
  const parts: number[] = [];
  let comma = false;
  for (const raw of text.split('\n')) {
    // "1. milk" is a list item, not the number one.
    const line = stripMarker(raw);
    const nums = line.match(/-?\d+(?:[.,]\d+)?/g);
    if (!nums) continue;
    const last = nums[nums.length - 1];
    if (/\d,\d/.test(last)) comma = true;
    parts.push(Number(last.replace(',', '.')));
  }
  if (parts.length < 2) return null;
  return { parts, total: parts.reduce((a, b) => a + b, 0), comma };
}
