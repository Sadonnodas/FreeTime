import { db } from './db';
import { byRank } from './rank';
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
    // Your own order (rank.ts), the same one the project screen shows.
    ideas: live(ideas)
      .filter((i) => !i.doneAt)
      .sort(byRank),
    buy: live(buys)
      .filter((b) => !b.purchasedAt)
      .sort(byRank),
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
    b.needed ? 'on the shopping list' : null,
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

// ------------------------------------------------------------ Brain's lists

/**
 * A list from Brain, as text — whatever is on screen at that moment.
 *
 * Asked for straight after the project export: *"exporting in the brain area
 * would also be nice"*. Brain cuts ACROSS eras, so the useful export is not a
 * project but the list as you have narrowed it: filtered to Coding, it is the
 * Coding to-dos; on tomorrow's day list, it is tomorrow. The caller passes the
 * rows it is already showing, so the text can never disagree with the screen.
 *
 * Grouped under "Era · Project" headings, sorted by era and then by project,
 * unfiled last — a flat list across eras is the one pile the colours on screen
 * exist to break up, and pasted without them it would read as one.
 */
export type ListKind = 'todos' | 'ideas' | 'buy';

interface Placed {
  projectId?: string;
  tag?: string;
}

export function groupByPlace<T extends Placed>(rows: T[], eras: Project[]): { heading: string; rows: T[] }[] {
  type Group = { heading: string; rows: T[]; eraName: string; order: number; filed: boolean };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const era = eras.find((e) => e.id === row.projectId);
    const tag = era ? row.tag : undefined;
    const heading = era ? [era.name, tag].filter(Boolean).join(' · ') : 'Not filed';
    if (!groups.has(heading)) {
      groups.set(heading, {
        heading,
        rows: [],
        eraName: era?.name ?? '',
        // The era's own rows first, then its projects in the era's own order —
        // the order they are listed in on the era's screen.
        order: tag ? (era?.tags ?? []).indexOf(tag) : -1,
        filed: !!era
      });
    }
    groups.get(heading)!.rows.push(row);
  }
  // Sorted by era and then by project, not by first appearance: a list sorted
  // newest-first would otherwise print Campervan, Coding, Campervan, Coding,
  // and a page is read top to bottom by project. Unfiled last. Rows inside a
  // group keep the order they had on screen.
  return [...groups.values()]
    .sort(
      (a, b) =>
        Number(b.filed) - Number(a.filed) ||
        a.eraName.localeCompare(b.eraName) ||
        a.order - b.order
    )
    .map(({ heading, rows: r }) => ({ heading, rows: r }));
}

export function listToMarkdown(
  kind: ListKind,
  title: string,
  rows: (Todo | Idea | BuyItem)[],
  eras: Project[],
  /** Every live to-do, so "after …" resolves even when the blocker is filtered out. */
  allTodos: Todo[] = []
): string {
  const out: string[] = [`# ${title}`];
  const byId = indexById(allTodos);
  const withDetails = (text: string, details: string[]) =>
    details.length ? `${text} — ${details.join(' · ')}` : text;

  for (const group of groupByPlace(rows as (Placed & (Todo | Idea | BuyItem))[], eras)) {
    out.push('', `## ${group.heading}`, '');
    for (const row of group.rows) {
      if (kind === 'todos') {
        const t = row as Todo;
        const box = t.completedAt ? '[x]' : '[ ]';
        out.push(withDetails(`- ${box} ${t.title}`, t.completedAt ? [] : todoDetails(t, blockerOf(t, byId))));
      } else if (kind === 'ideas') {
        const i = row as Idea;
        out.push(`- ${i.doneAt ? '~~' + i.text + '~~' : i.text}`);
      } else {
        const b = row as BuyItem;
        const box = b.purchasedAt ? '[x]' : '[ ]';
        out.push(withDetails(`- ${box} ${b.name}${(b.qty ?? 1) > 1 ? ` ×${b.qty}` : ''}`, buyDetails(b)));
      }
    }
  }
  if (!rows.length) out.push('', 'Nothing here.');
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------ money on paper

/**
 * What a set of shopping comes to — for the printed buy list, per project and
 * across everything.
 *
 * Asked for as *"to-buys separated for all projects, with quantity, cost and
 * total cost for all things within a project and also total cost across
 * everything"*. Two honesty rules, because a printed total is read as THE
 * number and nobody re-adds it in the shop:
 *
 * - **Per currency, never blended.** The list on screen sums everything as if
 *   it were one currency, which is fine while it all is. On paper, a single
 *   item priced in dollars would silently become euros inside a total that
 *   looks exact. So amounts are kept apart by currency and printed side by side.
 * - **Unpriced items are counted, not ignored.** A total over twelve things of
 *   which four have no price is not the cost of twelve things, and it must say
 *   so beside the number rather than let the number stand for all of them.
 */
export interface Totals {
  /** Cents per currency code, in the order each currency first appeared. */
  byCurrency: { currency: string; cents: number }[];
  /** How many items carry no price and so are not in the amounts. */
  unpriced: number;
  /** How many things, counting quantity: "Sleeves ×2" is two. */
  pieces: number;
}

export function totalsOf(items: BuyItem[]): Totals {
  const map = new Map<string, number>();
  let unpriced = 0;
  let pieces = 0;
  for (const b of items) {
    pieces += b.qty ?? 1;
    if (!b.priceCents) {
      unpriced++;
      continue;
    }
    const currency = b.currency || 'EUR';
    map.set(currency, (map.get(currency) ?? 0) + buyLineTotal(b));
  }
  return { byCurrency: [...map].map(([currency, cents]) => ({ currency, cents })), unpriced, pieces };
}

/** "€ 23,90", or "€ 23,90 + $ 12.00" when currencies are mixed; "—" when nothing is priced. */
export function formatTotals(t: Totals): string {
  return t.byCurrency.length ? t.byCurrency.map((c) => money(c.cents, c.currency)).join(' + ') : '—';
}
