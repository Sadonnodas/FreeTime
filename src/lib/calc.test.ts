import { describe, it, expect } from 'vitest';
import { evaluate, answerFor, formatNumber, totalOf } from './calc';

describe('working out a sum', () => {
  it('does the four operations, in the right order, with brackets', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) × 4')).toBe(20);
    expect(evaluate('10 ÷ 4')).toBe(2.5);
    expect(evaluate('2.43 x 1.10')).toBeCloseTo(2.673);
    expect(evaluate('5 − 7')).toBe(-2);
    expect(evaluate('-3 + 1')).toBe(-2);
  });

  it('reads a comma as a decimal point', () => {
    expect(evaluate('1,5 + 1,25')).toBe(2.75);
  });

  it('refuses anything that is not arithmetic', () => {
    expect(evaluate('alert(1)')).toBeNull();
    expect(evaluate('12')).toBeNull();
    expect(evaluate('2 +')).toBeNull();
    expect(evaluate('(2 + 3')).toBeNull();
    expect(evaluate('4 / 0')).toBeNull();
  });

  it('rounds away float noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(2.75, true)).toBe('2,75');
  });
});

describe('a line ending in "="', () => {
  it('gets its answer, ignoring words in front', () => {
    const text = 'Hall\nwidth 2.43 + 1.10 =';
    expect(answerFor(text, text.length)).toBe('3.53');
    expect(answerFor('3 × 4 =', 7)).toBe('12');
    expect(answerFor('1,5 + 1 =', 9)).toBe('2,5');
  });

  it('gets nothing when there is no sum before it', () => {
    expect(answerFor('note =', 6)).toBeNull();
    expect(answerFor('12 =', 4)).toBeNull();
    expect(answerFor('2 + 2', 5)).toBeNull();
  });
});

describe('totalling a note', () => {
  it('adds the last number on each line and says which', () => {
    const t = totalOf('Milk 1.19\nEggs 3,29\nshop notes\nwood 2 x 3 = 6')!;
    expect(t.parts).toEqual([1.19, 3.29, 6]);
    expect(t.total).toBeCloseTo(10.48);
    expect(t.comma).toBe(true);
  });

  it('has nothing to total with fewer than two numbers', () => {
    expect(totalOf('just one 12')).toBeNull();
    expect(totalOf('no numbers')).toBeNull();
  });
});
