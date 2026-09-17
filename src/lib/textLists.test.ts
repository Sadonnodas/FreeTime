import { describe, it, expect } from 'vitest';
import { continueList, toggleList, stripMarker } from './textLists';
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

describe('the list buttons', () => {
  it('turn lines into a list, numbered in order, and back', () => {
    const text = 'saw\ndrill\nglue';
    const numbered = toggleList(text, 0, text.length, 'number').text;
    expect(numbered).toBe('1. saw\n2. drill\n3. glue');
    expect(toggleList(numbered, 0, numbered.length, 'number').text).toBe(text);
    expect(toggleList(numbered, 0, numbered.length, 'bullet').text).toBe('- saw\n- drill\n- glue');
  });

  it('works on the current line only when nothing is selected', () => {
    const text = 'title\nsaw';
    expect(toggleList(text, 8, 8, 'bullet').text).toBe('title\n- saw');
  });

  it('starts an empty line as a list item', () => {
    expect(toggleList('', 0, 0, 'bullet')).toEqual({ text: '- ', caret: 2, from: 0 });
  });
});

describe('a total ignores list numbering', () => {
  it('does not count "1." as a number', () => {
    expect(stripMarker('1. milk 2.40')).toBe('milk 2.40');
    const t = totalOf('1. milk 2.40\n2. eggs 3\n3. bread')!;
    expect(t.parts).toEqual([2.4, 3]);
  });
});
