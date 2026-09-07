import type { Energy, TimeBucket } from './types';

/**
 * The two axes a to-do can be sized on, and the words for them — in one place,
 * because they are user-facing copy that appears in the pickers, in row
 * footnotes and in the Today picker's headings, and three copies of a label is
 * three chances for them to drift apart.
 *
 * EFFORT AND DURATION ARE INDEPENDENT. How much of your head a job takes is not
 * how long it takes: sanding a board is easy and eats an afternoon, and a
 * decision you have been avoiding is twenty minutes of hard thinking. The order
 * of each list is smallest-first, which is the order Free Time compares against.
 */
export const ENERGIES: { key: Energy; label: string; hint: string }[] = [
  { key: 'quick', label: 'Quick', hint: 'a few minutes' },
  { key: 'moderate', label: 'Moderate', hint: 'a sitting' },
  { key: 'focus', label: 'Focus', hint: 'a long block' }
];

export const DURATIONS: { key: TimeBucket; label: string }[] = [
  { key: '20min', label: '20 min' },
  { key: '1-2h', label: 'An hour or two' },
  { key: 'half day', label: 'Half a day' },
  { key: 'all day', label: 'All day' }
];

export const energyLabel = (e?: Energy): string =>
  ENERGIES.find((x) => x.key === e)?.label ?? 'Size not set';

export const durationLabel = (t?: TimeBucket): string =>
  DURATIONS.find((x) => x.key === t)?.label ?? 'Length not set';
