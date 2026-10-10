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
 *
 * THE TOGGLE THAT USED TO LIVE HERE IS GONE. It put markers on the selected
 * lines for the quick-notes toolbar, and quick notes are a contenteditable
 * now — the browser makes real lists in one, so the buttons ask it rather
 * than rewriting text. What is left is what a plain textarea still needs:
 * Enter continuing a list in a project note, and reading markers off a line.
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
 * THE TEXTAREA WIRING, in one place because it was in two and then wanted to
 * be in four.
 *
 * Quick notes had this from the day lists were built and the project and era
 * NOTES did not, which is the gap that was reported: *"when adding a bullet
 * point, pressing enter should add another one automatically. Right now you
 * have to add every bullet point manually."* Exactly the shape this file
 * already records three times over — a capability landing on one screen and
 * missing from the others that do the same thing — so the wiring moved here
 * rather than being copied a third time.
 *
 * Call it from `oninput` and use what it returns, or the element's own value
 * when it returns null. It is done AFTER the fact, on the input event, rather
 * than by intercepting keydown: phone keyboards do not reliably send a key
 * event for Enter, and `insertLineBreak` / `insertParagraph` always arrive.
 */
export function continueListIn(el: HTMLTextAreaElement, inputType: string): string | null {
  if (inputType !== 'insertLineBreak' && inputType !== 'insertParagraph') return null;
  const r = continueList(el.value, el.selectionStart ?? el.value.length);
  if (!r) return null;
  // Written straight to the element as well as returned: the caret has to be
  // placed after the marker now, and waiting for the value to come back round
  // through the component would put it at the end of the line instead.
  el.value = r.text;
  el.setSelectionRange(r.caret, r.caret);
  return r.text;
}
