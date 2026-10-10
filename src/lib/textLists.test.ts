import { describe, it, expect } from 'vitest';
import { continueList, stripMarker } from './textLists';
import { totalOf } from './calc';

/** Type Enter at the end of `text` and return what the note becomes. */
const enter = (text: string) => continueList(text + '\n', text.length + 1);

describe('Enter in a list', () => {
  it('continues bullets in the style they were written', () => {
    expect(enter('- milk')!.text).toBe('- milk\n- ');
    expect(enter('* milk')!.text).toBe('* milk\n* ');
    expect(enter('• milk')!.text).toBe('• milk\n• ');
    expect(enter('  - indented')!.text).toBe('  - indented\n  - ');
    expect(enter('- [ ] tape')!.text).toBe('- [ ] tape\n- [ ] ');
  });

  it('counts numbers and letters on', () => {
    expect(enter('1. saw')!.text).toBe('1. saw\n2. ');
    expect(enter('9) drill')!.text).toBe('9) drill\n10) ');
    expect(enter('a. first')!.text).toBe('a. first\nb. ');
    expect(enter('B) second')!.text).toBe('B) second\nC) ');
  });

  it('puts the cursor after the new marker, even mid-note', () => {
    const text = '1. saw\n\nafter';
    const r = continueList(text, 7)!;
    expect(r.text).toBe('1. saw\n2. \nafter');
    expect(r.caret).toBe(10);
  });

  it('ends the list on an empty item', () => {
    const r = enter('- milk\n- ')!;
    expect(r.text).toBe('- milk\n');
    expect(r.caret).toBe(7);
  });

  it('leaves ordinary lines alone', () => {
    expect(enter('just a line')).toBeNull();
    expect(enter('-no space')).toBeNull();
    expect(enter('2024 was a year')).toBeNull();
  });
});

describe('a total ignores list numbering', () => {
  it('does not count "1." as a number', () => {
    expect(stripMarker('1. milk 2.40')).toBe('milk 2.40');
    const t = totalOf('1. milk 2.40\n2. eggs 3\n3. bread')!;
    expect(t.parts).toEqual([2.4, 3]);
  });
});

/**
 * EVERY PLACE PROSE IS WRITTEN CONTINUES A LIST, and this reads the sources to
 * say so — the same unusual check screens.test.ts makes, for the same reason.
 *
 * Quick notes carried lists from the day they were built while the project and
 * era notes did not, and it was reported as a bug rather than a request:
 * *"when adding a bullet point, pressing enter should add another one
 * automatically."* Nothing rendered can notice a handler that was never wired,
 * so the guard has to look at the files.
 *
 * When a fifth box for writing prose appears, add it here. Deliberately NOT
 * every textarea in the app: a title, a rename and a search box are one line
 * by design, and continuing a list in one would be nonsense.
 */
const SOURCES = import.meta.glob('./components/*.svelte', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

const read = (file: string) => {
  const source = Object.entries(SOURCES).find(([key]) => key.endsWith(file))?.[1];
  expect(source, `no such component: ${file}`).toBeTruthy();
  return source ?? '';
};

describe('prose boxes all continue a list', () => {
  it('the note widget does, in its textarea', () => {
    // The last plain textarea anybody writes prose into, and the only caller
    // this helper has left.
    expect(read('WidgetBoard.svelte')).toContain('continueListIn');
  });

  for (const [file, what] of [
    ['QuickNotes.svelte', 'a quick note'],
    ['NoteEditor.svelte', 'a project or era note']
  ] as const) {
    it(`${what} does, by holding a real list`, () => {
      // These stopped needing the helper when they stopped being textareas: a
      // contenteditable makes <ul>/<li> and the browser continues, ends and
      // nests those itself. The guard stays, pointed at what now owns the
      // behaviour — dropping it would leave the capability unwatched.
      expect(read(file)).toContain('RichNote');
    });
  }
});
