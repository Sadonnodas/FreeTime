import type { Project } from './types';
import { projectTagColor } from './store';

/**
 * The colour an ERA wears, derived from its name.
 *
 * A project inside an era has a real stored colour (`Project.tagColors`), but
 * an era itself never had one — its cover just took a hue from its own name so
 * that a project with no photo still looked deliberate. That hue is now shared
 * rather than private to ProjectCover, because Brain colour-codes its rows by
 * where they live, and a dot that disagreed with the card on the Eras screen
 * would be worse than no dot at all.
 *
 * Derived, never stored: nothing to migrate, nothing to keep in step, and two
 * devices cannot disagree. Renaming an era changes its colour, which is the
 * one real cost and is the same cost its cover already pays.
 */
export function eraHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** A dot-sized version of that hue: readable on both themes at 8px. */
export function eraColor(name: string): string {
  return `hsl(${eraHue(name)} 52% 62%)`;
}

/**
 * The two colours a row wears: a wash for its project, an edge for its era.
 *
 * Shared by Brain and Today so a to-do is the same colours on both. The wash
 * alone is not enough on any screen that mixes eras: a project's colour is only
 * unique INSIDE its era, since the palette restarts for each one, so the first
 * project of two different eras is the same orange. The edge is what tells
 * those apart. An era-level row washes in its era's colour; an unfiled row gets
 * nothing, because unfiled is a valid resting state and must not be dressed up
 * as something filed.
 */
export function tintFor(
  era: Pick<Project, 'name' | 'tags' | 'tagColors'> | undefined,
  tag?: string
): { fill: string; edge: string } | undefined {
  if (!era) return undefined;
  const edge = eraColor(era.name);
  return { fill: tag ? projectTagColor(era.tags, era.tagColors, tag) : edge, edge };
}
