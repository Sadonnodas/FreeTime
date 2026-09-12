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
