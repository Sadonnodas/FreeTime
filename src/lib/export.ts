import { db } from './db';
import { getNote } from './store';
import { memosForProject, mmss, displayTitle } from './memos';
import { widgetsFor } from './widgets';
import { indexById, readyFirst, blockerOf } from './order';
import { energyLabel, durationLabel } from './sizes';
import { money } from './format';
import type { Todo, Idea, BuyItem, Memo, Widget, Project } from './types';

/**
 * Taking a project OUT of the app — to paper, or into another tool.
 *
 * Asked for with two uses in one breath: *"if I planned a project for a while
 * and then one day want to really work on it I could just export the project
 * and print it out"*, and *"right now I have to manually type over my coding
 * to-dos from FreeTime to Claude Code"*. Then, a message later: *"export only
 * to-dos etc."*
 *
 * ONE COLLECTION, TWO OUTPUTS. The text you paste and the page you print are
 * the same content in different clothes, so they are built from the same
 * `ProjectExport` and cannot drift into listing different things. The text is
 * Markdown because that is the one format both destinations already read:
 * Claude Code, a notes app and an email all take `- [ ] Card database` as a
 * checklist, and nothing has to know FreeTime exists.
 *
 * The page is printed by the browser — "Save as PDF" is in every print dialog,
 * including the iPhone share sheet — rather than by a PDF library. A library
 * would be the app's third runtime dependency, paid for on every page load to
 * produce a worse PDF than the browser's own typesetting does for free.
 *
 * SECTIONS ARE CHOSEN, NOT FIXED. "Just the to-dos" is the Claude Code case and
 * "everything" is the printing case, and a project export that could only do
 * one of those would be the wrong tool half the time.
 */

export type ExportSection = 'todos' | 'done' | 'ideas' | 'buy' | 'notes' | 'blocks' | 'recordings';

export const EXPORT_SECTIONS: { key: ExportSection; label: string }[] = [
  { key: 'todos', label: 'To-dos' },
  { key: 'done', label: 'Done' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'buy', label: 'To buy' },
  { key: 'notes', label: 'Notes' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'recordings', label: 'Recordings' }
];

/**
 * Everything worth taking along, and nothing that is only history. Finished
 * to-dos are off by default: a printout for getting on with a project is a
 * list of what is left, and the done ones are one tap away for anyone who
 * wants the record.
 */
export const EVERYTHING: ExportSection[] = ['todos', 'ideas', 'buy', 'notes', 'blocks', 'recordings'];
export const JUST_TODOS: ExportSection[] = ['todos'];

export interface ExportTodo {
  todo: Todo;
  /** The open to-do this one waits for, if any. */
  after?: Todo;
}

export interface ProjectExport {
  era: Pick<Project, 'id' | 'name' | 'tags' | 'tagColors'>;
  tag: string;
  description?: string;
  /** Ready first, then each chain in the order it has to happen — as on screen. */
  open: ExportTodo[];
  done: Todo[];
  ideas: Idea[];
  buy: BuyItem[];
  note?: string;
  blocks: Widget[];
  recordings: Memo[];
}

/** Everything one project holds, read once. Null if the project is gone. */
export async function collectProject(eraId: string, tag: string): Promise<ProjectExport | null> {
  const era = await db.projects.get(eraId);
  if (!era || era.deletedAt || !(era.tags ?? []).includes(tag)) return null;

  const live = <T extends { deletedAt?: string; tag?: string }>(rows: T[]) =>
    rows.filter((r) => !r.deletedAt && r.tag === tag);

  const [eraTodos, ideas, buys, note, widgets, memos] = await Promise.all([
    db.todos.where('projectId').equals(eraId).toArray(),
    db.ideas.where('projectId').equals(eraId).toArray(),
    db.buyItems.where('projectId').equals(eraId).toArray(),
    getNote(eraId, tag),
    widgetsFor(eraId),
    memosForProject(eraId)
  ]);

  // "Comes after" resolves against every live to-do in the era, as the project
  // screen does: the blocker may have been moved out to the era since.
  const byId = indexById(eraTodos.filter((t) => !t.deletedAt));
  const mine = live(eraTodos);

  return {
    era,
    tag,
    description: era.tagDescriptions?.[tag],
    open: readyFirst(mine.filter((t) => !t.completedAt)).map((todo) => ({
      todo,
      after: blockerOf(todo, byId)
    })),
    done: mine
      .filter((t) => !!t.completedAt)
      .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!)),
    ideas: live(ideas)
      .filter((i) => !i.doneAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    buy: live(buys)
      .filter((b) => !b.purchasedAt)
      .sort((a, b) => (b.needed ? 1 : 0) - (a.needed ? 1 : 0) || a.createdAt.localeCompare(b.createdAt)),
    note: note?.markdown?.trim() || undefined,
    blocks: live(widgets).filter((w) => blockHasContent(w)),
    recordings: live(memos)
  };
}

/** Blocks that say something on paper. An activity chart or a memo widget is a
 *  live view of other data, and exporting its frame would print an empty box. */
export function blockHasContent(w: Widget): boolean {
  switch (w.kind) {
    case 'note':
      return !!w.text?.trim();
    case 'links':
      return !!w.links?.length;
    case 'countdown':
      return !!w.date;
    case 'image':
      return !!w.image;
    default:
      return false;
  }
}

/** What a to-do's line says after its title: size, length, what it waits for, its date. */
export function todoDetails(t: Todo, after?: Todo): string[] {
  return [
    t.energy ? energyLabel(t.energy) : null,
    t.takes ? durationLabel(t.takes) : null,
    after ? `after “${after.title}”` : null,
    t.date ? `by ${t.date}` : null
  ].filter((x): x is string => !!x);
}

export const buyLineTotal = (b: BuyItem) => (b.priceCents ?? 0) * (b.qty ?? 1);

export function buyDetails(b: BuyItem): string[] {
  const qty = (b.qty ?? 1) > 1 ? b.qty! : 1;
  return [
    b.needed ? 'needed' : null,
    b.priceCents
      ? qty > 1
        ? `${money(buyLineTotal(b), b.currency)} (${money(b.priceCents, b.currency)} each)`
        : money(b.priceCents, b.currency)
      : null,
    b.url ?? null
  ].filter((x): x is string => !!x);
}

/**
 * A note's own headings pushed down below the export's, so a "# Chorus" inside
 * the notes does not come out as big as the project's title and flatten the
 * structure. Markdown stops at six; anything deeper stays at six.
 */
export function demoteHeadings(markdown: string, by = 2): string {
  return markdown.replace(/^(#{1,6})(\s)/gm, (_, hashes: string, space: string) =>
    '#'.repeat(Math.min(6, hashes.length + by)) + space
  );
}

/**
 * The project as Markdown, with only the chosen sections. Empty sections are
 * left out rather than printed as a heading over nothing.
 */
export function toMarkdown(data: ProjectExport, sections: Iterable<ExportSection>): string {
  const on = new Set(sections);
  const out: string[] = [`# ${data.tag}`, '', `${data.era.name}`];
  if (data.description) out.push('', `> ${data.description}`);

  const section = (title: string, lines: string[]) => {
    if (lines.length) out.push('', `## ${title}`, '', ...lines);
  };
  const withDetails = (text: string, details: string[]) =>
    details.length ? `${text} — ${details.join(' · ')}` : text;

  if (on.has('todos')) {
    section(
      'To-dos',
      data.open.map(({ todo, after }) =>
        withDetails(`- [ ] ${todo.title}`, [...todoDetails(todo, after), ...(todo.image ? ['has a photo'] : [])])
      )
    );
  }
  if (on.has('done')) {
    section('Done', data.done.map((t) => `- [x] ${t.title}`));
  }
  if (on.has('ideas')) {
    section('Ideas', data.ideas.map((i) => `- ${i.text}`));
  }
  if (on.has('buy')) {
    const lines = data.buy.map((b) =>
      withDetails(`- [ ] ${b.name}${(b.qty ?? 1) > 1 ? ` ×${b.qty}` : ''}`, buyDetails(b))
    );
    const total = data.buy.reduce((sum, b) => sum + buyLineTotal(b), 0);
    if (lines.length && total) lines.push('', `Still to buy: ${money(total, data.buy[0]?.currency)}`);
    section('To buy', lines);
  }
  if (on.has('notes') && data.note) {
    section('Notes', [demoteHeadings(data.note)]);
  }
  if (on.has('blocks')) {
    const lines: string[] = [];
    for (const w of data.blocks) {
      const title = w.title ? `**${w.title}**` : null;
      if (w.kind === 'note') lines.push([title, w.text!.trim()].filter(Boolean).join('\n'), '');
      if (w.kind === 'countdown') lines.push(`${title ?? '**Date**'}: ${w.date}`, '');
      if (w.kind === 'links') {
        if (title) lines.push(title);
        lines.push(...w.links!.map((l) => `- [${l.label || l.url}](${l.url})`), '');
      }
      // A photo cannot travel as text. Said, so the export does not quietly
      // look like it had no pictures.
      if (w.kind === 'image') lines.push(`${title ?? '**Photo**'} (photo — see the printed version)`, '');
    }
    while (lines.at(-1) === '') lines.pop();
    section('Blocks', lines);
  }
  if (on.has('recordings')) {
    section(
      'Recordings',
      data.recordings.map((m) => `- ${displayTitle(m)} (${mmss(m.durationMs)})`)
    );
  }

  return out.join('\n') + '\n';
}
