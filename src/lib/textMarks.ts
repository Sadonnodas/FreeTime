import type { Edit } from './textLists';

/**
 * Bold, italic and underline in plain text — the toolbar buttons and the
 * keyboard shortcuts behind them.
 *
 * Asked for from a laptop: *"I want to be able to underline, make bold or use
 * italics but I don't see a way to do that on computer. Pressing Command + B
 * doesn't work either."* It would not: quick notes are a `<textarea>`, and a
 * textarea has no formatting for Cmd+B to toggle. What a plain-text note CAN
 * carry is the same Markdown the project notes already use, so that is what
 * these write — `**bold**`, `*italic*`, `__underline__` — and markdown.ts
 * renders them wherever a note is read rather than written.
 *
 * **UNDERLINE IS OURS, AND IT IS THE ONE DEVIATION.** Markdown has no
 * underline: CommonMark reads `__text__` as bold, the same as `**text**`.
 * Underline was asked for by name, there is no other spelling for it, and
 * `**` keeps meaning bold — so nothing already written changes meaning. The
 * cost is that a note pasted into another Markdown tool shows an underline as
 * bold, which is worth it for a format that is read inside this app.
 *
 * THEY TOGGLE, because that is what every editor does with Cmd+B. Marks
 * already around the selection come off, whether the selection is inside them
 * or wrapped around them; with nothing selected the pair is inserted and the
 * caret goes between, so typing carries on in bold.
 */

export type Mark = 'bold' | 'italic' | 'underline';

export const MARKS: Record<Mark, string> = {
  bold: '**',
  italic: '*',
  underline: '__'
};

/** Cmd/Ctrl + this letter. The three every editor binds. */
const KEYS: Record<string, Mark> = { b: 'bold', i: 'italic', u: 'underline' };

/**
 * Is `text[at..]` the mark, and a mark on its own?
 *
 * The qualifier is what keeps italic out of bold's asterisks: inside
 * `**bold**` the first `*` of the pair would otherwise look like an italic
 * mark, and toggling italic would break the bold by taking half of it away.
 */
function markAt(text: string, at: number, mark: Mark): boolean {
  const m = MARKS[mark];
  if (text.slice(at, at + m.length) !== m) return false;
  if (mark !== 'italic') return true;
  return text[at - 1] !== '*' && text[at + 1] !== '*';
}

/**
 * The text with `mark` put around the selection, or taken off it.
 *
 * `from` is where the selection should start afterwards and `caret` where it
 * should end — the same shape textLists uses, so one caller can apply either.
 */
export function toggleMark(text: string, from: number, to: number, mark: Mark): Edit {
  const m = MARKS[mark];

  // Nothing selected: open the pair and sit between it.
  if (from === to) {
    const next = text.slice(0, from) + m + m + text.slice(from);
    return { text: next, caret: from + m.length, from: from + m.length };
  }

  const selected = text.slice(from, to);

  // Selected WITH its marks: "**done**" picked by double-click-and-drag.
  if (
    selected.length > m.length * 2 &&
    markAt(selected, 0, mark) &&
    markAt(selected, selected.length - m.length, mark)
  ) {
    const inner = selected.slice(m.length, selected.length - m.length);
    return { text: text.slice(0, from) + inner + text.slice(to), caret: from + inner.length, from };
  }

  // Selected INSIDE its marks: the usual case, since a double-click takes the
  // word and leaves the punctuation around it.
  if (markAt(text, from - m.length, mark) && markAt(text, to, mark)) {
    const next = text.slice(0, from - m.length) + selected + text.slice(to + m.length);
    return { text: next, caret: to - m.length, from: from - m.length };
  }

  const next = text.slice(0, from) + m + selected + m + text.slice(to);
  return { text: next, caret: to + m.length, from: from + m.length };
}

/**
 * The keyboard half, wired the way `continueListIn` is: called from the
 * textarea's own handler, it writes the element and returns the new text, or
 * null when the key was not one of ours and nothing happened.
 *
 * It writes `el.value` itself because the caret has to be placed NOW — waiting
 * for the value to come back round through the component would drop it at the
 * end of the note, which is the one place it must not be.
 */
export function markKey(e: KeyboardEvent, el: HTMLTextAreaElement): string | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const mark = KEYS[e.key.toLowerCase()];
  if (!mark) return null;
  // Cmd+U is "view source" in some browsers, and none of the three mean
  // anything in a textarea, so taking them is safe.
  e.preventDefault();
  const r = toggleMark(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, mark);
  el.value = r.text;
  el.setSelectionRange(r.from ?? r.caret, r.caret);
  return r.text;
}
