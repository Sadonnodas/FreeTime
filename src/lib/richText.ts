import { renderMarks } from './markdown';

/**
 * The computer's rich editor for quick notes: what you see is bold, not
 * `**bold**`.
 *
 * WHY THIS EXISTS AT ALL, since the file it replaces argued the other way.
 * Marks were added as Markdown and came straight back: *"instead of really
 * going bold or putting italics I get `**what I typed**`"*. A `<textarea>`
 * holds characters and nothing else, so the syntax has to be on screen
 * somewhere — there is no setting that makes a textarea show bold. The only
 * way to type into formatted text is a `contenteditable`, which is what
 * [RichNote.svelte](components/RichNote.svelte) is.
 *
 * **WHAT IS STORED DOES NOT CHANGE.** A note is still plain Markdown in
 * IndexedDB: it syncs as JSON, merges per record, moves into a project's
 * notes, is searched and totalled as text. The editor renders that Markdown
 * on the way in and writes it back on the way out — the HTML never reaches
 * the database, which is the half of CLAUDE.md's "no contenteditable" rule
 * that was always the real one.
 *
 * **ONLY FOUR THINGS ARE STYLED**: bold, italic, underline, and bulleted or
 * numbered lists. Everything else a note might hold — a heading, a link, a
 * quote, a stray asterisk in "2 * 3" — travels through as literal text and
 * comes back out byte for byte. That is the rule that makes this safe:
 * opening a note must never change it, so anything not understood is not
 * touched.
 */

/**
 * The shape this walker needs from a DOM node, and nothing more.
 *
 * Written structurally because the test runner has no DOM — and a serialiser
 * that can quietly mangle a note is exactly the code that has to be tested
 * rather than eyeballed in a browser.
 */
export interface Nodeish {
  nodeType: number;
  nodeName: string;
  textContent?: string | null;
  childNodes: ArrayLike<Nodeish>;
  /** Only `data-check` is ever read, and only off a list item. */
  getAttribute?: (name: string) => string | null;
}

const TEXT = 3;
const ELEMENT = 1;

const kids = (n: Nodeish): Nodeish[] => Array.from(n.childNodes ?? []);
const name = (n: Nodeish): string => (n.nodeType === ELEMENT ? n.nodeName.toUpperCase() : '');

/** Things that start their own line. */
const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4']);

const MARK_FOR: Record<string, string> = {
  B: '**',
  STRONG: '**',
  I: '*',
  EM: '*',
  U: '__',
  S: '~~',
  STRIKE: '~~',
  DEL: '~~'
};

/**
 * Put a mark around text, keeping any spaces OUTSIDE it.
 *
 * `** bold **` is not bold in Markdown — the spaces break it — and a browser
 * will happily let a selection include the space after a word. An empty run
 * gets no marks at all, or a stray `****` would be left in the note.
 */
function wrap(mark: string, inner: string): string {
  const body = inner.trim();
  if (!body) return inner;
  const lead = inner.slice(0, inner.length - inner.trimStart().length);
  const tail = inner.slice(inner.trimEnd().length);
  return `${lead}${mark}${body}${mark}${tail}`;
}

/** One element's text, with the marks it carries. `<br>` becomes a newline. */
function inlineOf(node: Nodeish): string {
  if (node.nodeType === TEXT) return node.textContent ?? '';
  const tag = name(node);
  if (tag === 'BR') return '\n';
  const inner = kids(node).map(inlineOf).join('');
  const mark = MARK_FOR[tag];
  return mark ? wrap(mark, inner) : inner;
}

/** The lines of a block, dropping the trailing `<br>` a browser leaves behind
 *  to mark "this line ends here" — without that, every paragraph would gain a
 *  blank line each time it was opened. */
function linesOf(node: Nodeish): string[] {
  const text = inlineOf(node).replace(/\n$/, '');
  return text.split('\n');
}

function listLines(list: Nodeish, ordered: boolean, indent: string, out: string[]): void {
  let n = 1;
  for (const li of kids(list)) {
    if (name(li) !== 'LI') continue;
    // The item's own text, which is everything in it that is not a nested list.
    const own = kids(li)
      .filter((c) => name(c) !== 'UL' && name(c) !== 'OL')
      .map(inlineOf)
      .join('')
      .replace(/\n$/, '');
    // A box, if this item is one: `- [ ] milk`, which is how every notes app
    // and every Markdown reader writes a checklist.
    const check = li.getAttribute?.('data-check') ?? null;
    const box = check === null ? '' : check === '1' ? '[x] ' : '[ ] ';
    out.push(`${indent}${ordered ? `${n++}. ` : '- '}${box}${own}`);
    for (const nested of kids(li)) {
      const tag = name(nested);
      if (tag === 'UL' || tag === 'OL') listLines(nested, tag === 'OL', `${indent}  `, out);
    }
  }
}

/** Does this block hold other blocks? A browser nests them freely — pressing
 *  Enter after a list can put the new line INSIDE the div that holds it — and
 *  a nested list flattened into one line loses every bullet in it. */
const holdsBlocks = (node: Nodeish): boolean =>
  kids(node).some((c) => BLOCK.has(name(c)));

/** What the editor holds, as the Markdown that gets stored. */
export function toMarkdown(root: Nodeish): string {
  const out: string[] = [];
  let current = '';
  const flush = () => {
    out.push(current);
    current = '';
  };

  const walk = (node: Nodeish) => {
    for (const child of kids(node)) {
      const tag = name(child);
      if (tag === 'UL' || tag === 'OL') {
        if (current) flush();
        listLines(child, tag === 'OL', '', out);
      } else if (BLOCK.has(tag)) {
        if (current) flush();
        // A wrapper around other blocks is not a line of its own: go in.
        if (holdsBlocks(child)) walk(child);
        else for (const line of linesOf(child)) out.push(line);
      } else {
        // Loose text and marks before the first block: the browser leaves the
        // first line of a contenteditable like this until it is split.
        current += inlineOf(child);
      }
    }
  };

  walk(root);
  if (current) flush();

  return out.join('\n').replace(/[ \t]+$/gm, '');
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
/** `[ ]` or `[x]` at the head of a list item's content. */
const BOX = /^\[([ xX])\]\s+(.*)$/;

/**
 * The box itself: empty, drawn in CSS, and `contenteditable="false"` so the
 * caret cannot land inside it and the browser cannot carry it into the middle
 * of a word. The tick lives in `data-check` on the item rather than in here,
 * because that is what `toMarkdown` reads and what a click toggles.
 */
const boxHtml = '<span class="box" contenteditable="false"></span>';

/**
 * Markdown as the editor shows it: `<div>` per line, real lists, and the four
 * marks as tags. Deliberately NOT renderMarkdown — that one makes headings,
 * links and blockquotes, none of which this editor can turn back into
 * Markdown, so a note would lose them the moment it was touched.
 */
export function toEditorHtml(markdown: string): string {
  const out: string[] = [];
  let open: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (open) out.push(`</${open}>`);
    open = null;
  };

  for (const line of (markdown ?? '').split('\n')) {
    const item = LIST.exec(line);
    if (item) {
      const tag = /\d/.test(item[2]) ? 'ol' : 'ul';
      if (open !== tag) {
        closeList();
        out.push(`<${tag}>`);
        open = tag;
      }
      const checked = BOX.exec(item[3]);
      if (checked) {
        const done = checked[1].toLowerCase() === 'x' ? '1' : '0';
        out.push(`<li data-check="${done}">${boxHtml}${renderMarks(checked[2]) || '<br>'}</li>`);
      } else {
        out.push(`<li>${renderMarks(item[3]) || '<br>'}</li>`);
      }
      continue;
    }
    closeList();
    out.push(`<div>${renderMarks(line) || '<br>'}</div>`);
  }
  closeList();
  return out.join('');
}
