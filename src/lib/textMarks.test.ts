import { describe, it, expect } from 'vitest';
import { toggleMark } from './textMarks';

const apply = (text: string, mark: 'bold' | 'italic' | 'underline', from: number, to = from) =>
  toggleMark(text, from, to, mark);

describe('putting a mark on', () => {
  it('wraps the selection and keeps it selected', () => {
    const r = apply('buy the paint', 'bold', 8, 13);
    expect(r.text).toBe('buy the **paint**');
    expect(r.text.slice(r.from!, r.caret)).toBe('paint');
  });

  it('opens the pair and sits inside it when nothing is selected', () => {
    // So that typing carries on in bold, which is what Cmd+B does in a
    // document and what the hand expects here.
    const r = apply('note: ', 'italic', 6);
    expect(r.text).toBe('note: **');
    expect(r.caret).toBe(7);
  });

  it('underlines with __, which is the one thing markdown does not have', () => {
    expect(apply('Lisa', 'underline', 0, 4).text).toBe('__Lisa__');
  });
});

describe('taking a mark off', () => {
  it('unwraps when the selection sits inside the marks', () => {
    // The usual case: a double-click takes the word, not the punctuation.
    const r = apply('buy the **paint**', 'bold', 10, 15);
    expect(r.text).toBe('buy the paint');
    expect(r.text.slice(r.from!, r.caret)).toBe('paint');
  });

  it('unwraps when the marks are part of the selection', () => {
    const r = apply('buy the **paint**', 'bold', 8, 17);
    expect(r.text).toBe('buy the paint');
  });

  it('unwraps an underline', () => {
    expect(apply('__Lisa__', 'underline', 2, 6).text).toBe('Lisa');
  });
});

describe('italic inside bold', () => {
  it('does NOT read one of bolditalic asterisks as its own', () => {
    // "**paint**" with "paint" selected: a naive check sees a `*` either side
    // and takes one off each, which leaves `*paint*` — the bold silently
    // becomes italic and the note means something else.
    const r = apply('buy the **paint**', 'italic', 10, 15);
    expect(r.text).toBe('buy the ***paint***');
  });

  it('still toggles a real italic off', () => {
    expect(apply('buy the *paint*', 'italic', 9, 14).text).toBe('buy the paint');
  });
});

/**
 * Both boxes that write Markdown offer the marks, read from the source the way
 * textLists.test.ts and screens.test.ts do — nothing rendered can notice a
 * handler that was never wired, and this app's recurring bug is a capability
 * landing on one screen and missing from the other.
 *
 * The note WIDGET is deliberately not here: it has no toolbar and nothing
 * renders it, so a mark written there would be asterisks for ever.
 */
const SOURCES = import.meta.glob('./components/*.svelte', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

const read = (file: string) =>
  Object.entries(SOURCES).find(([key]) => key.endsWith(file))?.[1] ?? '';

describe('bold, italic and underline are offered where notes are written', () => {
  for (const [file, what] of [
    ['NoteEditor.svelte', 'a project or era note'],
    ['QuickNotes.svelte', 'a quick note']
  ] as const) {
    it(`${what} takes the keyboard shortcut`, () => {
      expect(read(file), `no such component: ${file}`).toContain('markKey');
    });

    it(`${what} has an underline button`, () => {
      // Bold and italic predate this; underline is the one that had nowhere to
      // be written, so it is the one worth pinning.
      expect(read(file)).toContain('nderline');
    });
  }
});
