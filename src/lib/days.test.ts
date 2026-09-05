import { describe, it, expect } from 'vitest';
import { shiftDay, tomorrow, dayLabel, dayPhrase } from './days';

describe('naming a day', () => {
  it('shifts across a month boundary', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('shifts across a leap day', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(tomorrow('2028-02-29')).toBe('2028-03-01');
  });

  it('stays on the local day', () => {
    // Built from parts, never new Date('2026-09-05') — that is UTC midnight,
    // which is the day before anywhere west of Greenwich, so a "Tomorrow" list
    // would quietly file things on today.
    expect(shiftDay('2026-09-05', 0)).toBe('2026-09-05');
  });

  it('names the three days worth naming', () => {
    expect(dayLabel('2026-09-05', '2026-09-05')).toBe('Today');
    expect(dayLabel('2026-09-06', '2026-09-05')).toBe('Tomorrow');
    expect(dayLabel('2026-09-04', '2026-09-05')).toBe('Yesterday');
  });

  it('falls back to a weekday, not a bare number', () => {
    // "the 12th" means nothing; "Saturday" means something.
    const label = dayLabel('2026-09-12', '2026-09-05');
    expect(label).not.toBe('Today');
    expect(label).toMatch(/Sat/);
  });

  it('lowercases only the names that are not dates', () => {
    expect(dayPhrase('2026-09-06', '2026-09-05')).toBe('tomorrow');
    expect(dayPhrase('2026-09-12', '2026-09-05')).toMatch(/Sat/);
  });
});
