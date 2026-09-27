import type { Project } from './types';

/**
 * The order a project's sections are drawn in, per project.
 *
 * Asked for with a reading list in mind: *"I would like to be able to change
 * the order of the sections — To-dos, Ideas, To buy — so that I can put my
 * ideas list on top, as that one will be more important than to-dos for the
 * book project."* Exactly right, and it is the first time one project has
 * wanted a different shape from another: a Books project is mostly a list of
 * books, and to-dos are the footnote.
 *
 * **Stored on the era, keyed by the project's NAME**, like `tagColors` and
 * `tagDescriptions` and for the same reason — that is what every `tag` field
 * already points at. Which means it must be carried by `renameProjectTag` and
 * `moveProjectTag`, and pruned by `setProjectTags`, exactly as the other three
 * are. Missing one of those is the failure this file records three times: not
 * deleted, just silently back to default.
 *
 * **It SYNCS**, unlike the fold state. Which sections you left folded is a
 * fact about the phone in your hand; which order they belong in is a fact
 * about the project, and having to rearrange Books again on the laptop would
 * be the app forgetting something you told it.
 */

export type SectionId = 'todo' | 'ideas' | 'buy' | 'note' | 'blocks' | 'memos';

/** Every section, in the order a project has unless it says otherwise. */
export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'todo', label: 'To-dos' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'buy', label: 'To buy' },
  { id: 'note', label: 'Notes' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'memos', label: 'Recordings' }
];

const DEFAULT = SECTIONS.map((s) => s.id);

/**
 * The order to draw this project's sections in.
 *
 * **A SAVED ORDER IS A PREFERENCE, NOT A WHITELIST.** Anything it does not
 * mention is appended in the default order, so a section added to the app next
 * year appears for everyone who has ever dragged these — rather than
 * disappearing from exactly the projects whose owner cared enough to arrange
 * them. Unknown ids are dropped for the mirror-image reason: a section that no
 * longer exists cannot be rendered, and leaving it in would only make the
 * stored list drift further from the truth.
 */
export function sectionsFor(
  project: Pick<Project, 'tagSections'> | undefined,
  tag: string | undefined
): SectionId[] {
  const saved = (tag && project?.tagSections?.[tag]) || [];
  const known = saved.filter((id): id is SectionId => DEFAULT.includes(id as SectionId));
  const seen = new Set(known);
  return [...known, ...DEFAULT.filter((id) => !seen.has(id))];
}

export const sectionLabel = (id: SectionId): string =>
  SECTIONS.find((s) => s.id === id)?.label ?? id;
