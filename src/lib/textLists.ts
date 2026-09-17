/**
 * Bulleted and numbered lists in plain text — the phone's Notes behaviour.
 *
 * Asked for (after a misread: "sum up" meant an OPSOMMING, a list) as
 *   -            1.
 *   -     or     2.       "and variations of those".
 * The text stays plain — it syncs, it is searched, it is pasted elsewhere —
 * so a list is just its markers, and these helpers do the two things that
 * make typing one pleasant: Enter continues the list, and Enter on an empty
 * item ends it. Plus a toggle for the toolbar buttons.
 *
 * Markers understood: "-", "*", "•" (with an optional "[ ]" checkbox after),
 * "1." "1)", and single letters "a." "a)". Indentation is kept.
 */

export interface Edit {
  text: string;
  caret: number;
  /** Where the changed lines start, so a toggle can keep them selected. */
  from?: number;
}

interface Marker {
  indent: string;
  /** The marker as written, including its trailing space(s). */
  marker: string;
  content: string;
  next: string;
}

const BULLET = /^(\s*)([-*•])(\s+)(\[[ xX]\]\s+)?(.*)$/;
const NUMBER = /^(\s*)(\d{1,4})([.)])(\s+)(.*)$/;
const LETTER = /^(\s*)([a-zA-Z])([.)])(\s+)(.*)$/;

export function parseMarker(line: string): Marker | null {
  let m = BULLET.exec(line);
  if (m) {
    const box = m[4] ? '[ ] ' : '';
    return {
      indent: m[1],
      marker: m[2] + m[3] + (m[4] ?? ''),
      content: m[5],
      next: `${m[2]} ${box}`
    };
  }
  m = NUMBER.exec(line);
  if (m) {
    return { indent: m[1], marker: m[2] + m[3] + m[4], content: m[5], next: `${Number(m[2]) + 1}${m[3]} ` };
  }
  m = LETTER.exec(line);
  if (m) {
    const code = m[2].charCodeAt(0);
    const last = m[2] === 'z' || m[2] === 'Z';
    if (last) return null;
    return { indent: m[1], marker: m[2] + m[3] + m[4], content: m[5], next: `${String.fromCharCode(code + 1)}${m[3]} ` };
  }
  return null;
}

/** The line with any list marker taken off — for totals, titles and toggles. */
export function stripMarker(line: string): string {
  const m = parseMarker(line);
  return m ? m.indent + m.content : line;
}

/**
 * Called right AFTER a line break was typed at `caret` (so `text[caret - 1]`
 * is the new "\n"). Continues the list from the line above, or ends it when
 * that line was an empty item. Null when the line above was not a list item.
 */
export function continueList(text: string, caret: number): Edit | null {
  if (text[caret - 1] !== '\n') return null;
  const prevEnd = caret - 1;
  const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
  const prev = text.slice(prevStart, prevEnd);
  const m = parseMarker(prev);
  if (!m) return null;

  if (!m.content.trim()) {
    // Enter on an empty item: the list is over. The empty item goes, and the
    // cursor sits on a plain empty line where it was.
    const next = text.slice(0, prevStart) + text.slice(caret);
    return { text: next, caret: prevStart };
  }
  const insert = m.indent + m.next;
  return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length };
}

/**
 * The toolbar: make the selected lines a bulleted or numbered list, or, when
 * they already all are one of that kind, plain lines again. Numbering starts
 * at 1 and follows the lines.
 */
export function toggleList(text: string, from: number, to: number, kind: 'bullet' | 'number'): Edit {
  const start = text.lastIndexOf('\n', from - 1) + 1;
  let end = text.indexOf('\n', to);
  if (end < 0) end = text.length;
  const lines = text.slice(start, end).split('\n');
  const isKind = (l: string) => (kind === 'bullet' ? BULLET.test(l) : NUMBER.test(l));
  // An empty line is not "already a list" — it is where one is about to start.
  const allAlready = lines.some((l) => l.trim()) && lines.every((l) => !l.trim() || isKind(l));
  let n = 0;
  const changed = lines.map((l) => {
    if (allAlready) return stripMarker(l);
    if (!l.trim() && lines.length > 1) return l;
    const m = /^(\s*)(.*)$/.exec(stripMarker(l))!;
    n++;
    return m[1] + (kind === 'bullet' ? '- ' : `${n}. `) + m[2];
  });
  const block = changed.join('\n');
  const next = text.slice(0, start) + block + text.slice(end);
  return { text: next, caret: start + block.length, from: start };
}
