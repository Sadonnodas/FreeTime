import { describe, it, expect } from 'vitest';

/**
 * THE SAME GAP, THREE TIMES: a field added to one screen and missed on the
 * others that show the same rows.
 *
 * "Belongs to" landed on the project screens while Brain kept the gap for
 * months. A to-do's day landed on the project screen while the era overview
 * kept it for a day. Repeats landed on Brain's add form and every row editor,
 * and was missed on the project's add form — reported as *"I went into my
 * Family era, to House project, wanted to add the trash cans recurring to-do
 * there but I don't see the option. Where is it?"*
 *
 * Prose in CLAUDE.md did not stop it happening a third time, so this is the
 * check that does. It reads the SOURCE, which is unusual and deliberate: the
 * failure is never in the logic, it is a control that is simply absent from
 * one file, and nothing rendered can notice something that was never there.
 *
 * It cannot know about a screen nobody added here. When a fifth place to write
 * a to-do appears, add it to this list — that is the whole maintenance cost,
 * and it is cheaper than the bug.
 */

/*
 * Read through Vite rather than node:fs, so this file stays inside the app's
 * own browser-shaped tsconfig and needs no node types to typecheck.
 */
const SOURCES = import.meta.glob('../routes/**/+page.svelte', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

function read(path: string): string {
  const hit = Object.entries(SOURCES).find(([key]) => key.endsWith(path));
  if (!hit) throw new Error(`No such screen: ${path}`);
  return hit[1];
}

/** Every screen a to-do can be WRITTEN or EDITED on, and what each must offer. */
const SCREENS: { path: string; what: string; needs: string[] }[] = [
  {
    path: 'routes/brain/+page.svelte',
    what: 'Brain — the add form and the row editor',
    needs: ['WhenPicker', 'RepeatPicker', 'AfterPicker', 'DurationPicker', 'EnergyPicker']
  },
  {
    path: 'routes/projects/[id]/[tag]/+page.svelte',
    what: 'inside a project — the add form and the row editor',
    needs: ['WhenPicker', 'RepeatPicker', 'AfterPicker', 'DurationPicker', 'EnergyPicker']
  },
  {
    path: 'routes/projects/[id]/+page.svelte',
    what: "the era overview — where an era-level to-do lives",
    needs: ['WhenPicker', 'RepeatPicker', 'AfterPicker', 'DurationPicker', 'EnergyPicker']
  }
];

describe('every screen that writes a to-do offers the same fields', () => {
  for (const screen of SCREENS) {
    it(`${screen.what} has them all`, () => {
      const source = read(screen.path);
      const missing = screen.needs.filter((c) => !source.includes(`<${c}`));
      expect(missing).toEqual([]);
    });
  }

  it('the add forms offer the repeat, not only the row editors', () => {
    // The precise shape of the miss: RepeatPicker was in the file, bound to an
    // existing to-do, and absent from the form that writes a new one.
    for (const path of [
      'routes/brain/+page.svelte',
      'routes/projects/[id]/[tag]/+page.svelte'
    ]) {
      expect(read(path)).toContain('newRepeat');
    }
  });
});
