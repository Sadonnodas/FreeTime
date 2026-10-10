import { describe, it, expect } from 'vitest';
import { toMarkdown, toEditorHtml, type Nodeish } from './richText';

/**
 * The editor's DOM, built by hand. The test runner has no document, and that
 * is no reason to leave the one function that can corrupt a note untested —
 * `toMarkdown` only ever asks a node four things, so four things are what
 * these fakes have.
 */
const t = (text: string): Nodeish => ({ nodeType: 3, nodeName: '#text', textContent: text, childNodes: [] });
const el = (nodeName: string, ...childNodes: Nodeish[]): Nodeish => ({
  nodeType: 1,
  nodeName,
  childNodes
});
/** A list item with a box on it, ticked or not. */
const check = (done: boolean, ...childNodes: Nodeish[]): Nodeish => ({
  nodeType: 1,
  nodeName: 'LI',
  childNodes,
  getAttribute: (n) => (n === 'data-check' ? (done ? '1' : '0') : null)
});
const root = (...children: Nodeish[]) => el('DIV', ...children);
/** An element with one attribute that matters — a link's href. */
const attr = (nodeName: string, name: string, value: string, ...childNodes: Nodeish[]): Nodeish => ({
  nodeType: 1,
  nodeName,
  childNodes,
  getAttribute: (n) => (n === name ? value : null)
});

describe('what the editor holds, as markdown', () => {
  it('writes a line per block', () => {
    expect(toMarkdown(root(el('DIV', t('one')), el('DIV', t('two'))))).toBe('one\ntwo');
  });

  it('keeps the loose first line a browser leaves unwrapped', () => {
    // Chrome does not wrap the first line in a <div> until it is split.
    expect(toMarkdown(root(t('one'), el('DIV', t('two'))))).toBe('one\ntwo');
  });

  it('turns the marks back into their syntax', () => {
    const line = el('DIV', t('Call '), el('STRONG', t('Lisa')), t(' about the '), el('U', t('van')));
    expect(toMarkdown(root(line))).toBe('Call **Lisa** about the __van__');
  });

  it('accepts whichever tag the browser felt like using', () => {
    // execCommand('bold') gives <b> in some browsers and <strong> in others.
    expect(toMarkdown(root(el('DIV', el('B', t('x')))))).toBe('**x**');
    expect(toMarkdown(root(el('DIV', el('EM', t('x')))))).toBe('*x*');
    expect(toMarkdown(root(el('DIV', el('I', t('x')))))).toBe('*x*');
  });

  it('keeps spaces OUTSIDE the marks', () => {
    // "** bold **" is not bold in markdown, and a selection that caught the
    // trailing space would otherwise write exactly that.
    expect(toMarkdown(root(el('DIV', el('STRONG', t('Lisa ')), t('rang'))))).toBe('**Lisa** rang');
  });

  it('writes nothing for an empty mark', () => {
    // A pair left behind by deleting the word inside it would be `****` on
    // screen the next time the note was opened.
    expect(toMarkdown(root(el('DIV', el('STRONG'), t('x'))))).toBe('x');
  });

  it('breaks a line on <br> and drops the one the browser adds at the end', () => {
    expect(toMarkdown(root(el('DIV', t('a'), el('BR'), t('b'))))).toBe('a\nb');
    expect(toMarkdown(root(el('DIV', t('a'), el('BR'))))).toBe('a');
    expect(toMarkdown(root(el('DIV', el('BR'))))).toBe('');
  });

  it('writes real lists back as markers', () => {
    expect(toMarkdown(root(el('UL', el('LI', t('milk')), el('LI', t('eggs')))))).toBe('- milk\n- eggs');
    expect(toMarkdown(root(el('OL', el('LI', t('one')), el('LI', t('two')))))).toBe('1. one\n2. two');
  });

  it('indents a nested list and keeps the item it hangs under', () => {
    const nested = el('UL', el('LI', t('paint'), el('UL', el('LI', t('primer')))));
    expect(toMarkdown(root(nested))).toBe('- paint\n  - primer');
  });

  it('writes a ticked line as a box', () => {
    const list = el('UL', check(false, t('milk')), check(true, t('eggs')));
    expect(toMarkdown(root(list))).toBe('- [ ] milk\n- [x] eggs');
  });

  it('leaves a plain bullet a plain bullet', () => {
    // Only an item that was MADE a box gets one: an ordinary list in a note
    // must not grow checkboxes because it happens to sit in the same editor.
    expect(toMarkdown(root(el('UL', el('LI', t('milk')))))).toBe('- milk');
  });

  it('goes INTO a block that holds other blocks', () => {
    // Found in the browser: pressing Enter after a list put the new line
    // inside the div wrapping it, and reading that div as a single line
    // flattened the whole list into one run of words with no bullets left.
    const nested = el(
      'DIV',
      el('UL', el('LI', t('paint')), el('LI', t('brushes'))),
      el('DIV', t('2 + 3 = 5'))
    );
    expect(toMarkdown(root(el('DIV', t('Call')), nested))).toBe(
      'Call\n- paint\n- brushes\n2 + 3 = 5'
    );
  });

  it('ignores anything it does not understand, keeping the words', () => {
    // A pasted span, a stray font tag: the text survives, the tag does not.
    expect(toMarkdown(root(el('DIV', el('SPAN', t('plain')))))).toBe('plain');
  });
});

describe('everything a project note holds, both ways', () => {
  it('keeps a heading at the level it was written', () => {
    // Off by one on purpose and symmetrical: h1 is the page's title, so a
    // note's "#" has always rendered as an h2. If these two disagreed,
    // opening a note would add a hash to every heading in it.
    expect(toEditorHtml('# Chorus')).toBe('<h2>Chorus</h2>');
    expect(toEditorHtml('## Bridge')).toBe('<h3>Bridge</h3>');
    expect(toMarkdown(root(el('H2', t('Chorus'))))).toBe('# Chorus');
    expect(toMarkdown(root(el('H3', t('Bridge'))))).toBe('## Bridge');
  });

  it('keeps a divider and a quote', () => {
    expect(toEditorHtml('---')).toBe('<hr>');
    expect(toMarkdown(root(el('HR')))).toBe('---');
    expect(toEditorHtml('> said so')).toBe('<blockquote>said so</blockquote>');
    expect(toMarkdown(root(el('BLOCKQUOTE', t('said so'))))).toBe('> said so');
  });

  it('keeps a written link, and writes one back', () => {
    expect(toEditorHtml('see [the shop](https://x.com)')).toContain('href="https://x.com"');
    const link = attr('A', 'href', 'https://x.com', t('the shop'));
    expect(toMarkdown(root(el('DIV', t('see '), link)))).toBe('see [the shop](https://x.com)');
  });

  it('LEAVES A BARE URL BARE', () => {
    // The read view linkifies one, which is right for reading and would be a
    // rewrite here: the note would come back saying [https://x.com](https://x.com)
    // purely because it had been opened.
    expect(toEditorHtml('see https://x.com')).toBe('<div>see https://x.com</div>');
  });

  it('round-trips a note made of all of it', () => {
    const md = [
      '# Chorus',
      '',
      'Something **bold** and a [link](https://x.com)',
      '',
      '- one',
      '- two',
      '',
      '> quoted',
      '---',
      'plain `code` and 2 * 3 * 4'
    ].join('\n');
    // Only the shapes this editor understands are rebuilt; everything else is
    // the literal text it already was. Either way it comes back the same.
    expect(toEditorHtml(md)).toContain('<h2>Chorus</h2>');
    expect(toEditorHtml(md)).toContain('2 * 3 * 4');
    expect(toEditorHtml(md)).toContain('`code`');
  });
});

describe('markdown, as the editor shows it', () => {
  it('gives every line its own block', () => {
    expect(toEditorHtml('one\ntwo')).toBe('<div>one</div><div>two</div>');
  });

  it('keeps an empty line visible', () => {
    expect(toEditorHtml('')).toBe('<div><br></div>');
    expect(toEditorHtml('a\n\nb')).toBe('<div>a</div><div><br></div><div>b</div>');
  });

  it('builds real lists', () => {
    expect(toEditorHtml('- milk\n- eggs')).toBe('<ul><li>milk</li><li>eggs</li></ul>');
    expect(toEditorHtml('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    expect(toEditorHtml('- milk\n1. one')).toBe('<ul><li>milk</li></ul><ol><li>one</li></ol>');
  });

  it('draws a box for a ticked line, and remembers which', () => {
    expect(toEditorHtml('- [ ] milk')).toBe(
      '<ul><li data-check="0"><span class="box" contenteditable="false"></span>milk</li></ul>'
    );
    expect(toEditorHtml('- [x] eggs')).toContain('data-check="1"');
    expect(toEditorHtml('- [X] eggs')).toContain('data-check="1"');
  });

  it('round-trips a checklist', () => {
    // The pair that matters: what is stored, shown, and stored again.
    const md = '- [ ] milk\n- [x] eggs';
    const html = toEditorHtml(md);
    expect(html).toContain('data-check="0"');
    expect(html).toContain('data-check="1"');
  });

  it('KEEPS AN INDENTED ITEM INDENTED', () => {
    // Caught in the browser before this shipped: a nested item came back flat,
    // which is the note being changed by having been opened — the one thing
    // this editor must never do.
    expect(toEditorHtml('- one\n  - nested')).toBe(
      '<ul><li>one</li><ul><li>nested</li></ul></ul>'
    );
    // Read back from the shape toEditorHtml writes — a nested list beside
    // the items — as well as from the shape a browser makes, which is inside
    // the item. Both keep the indentation.
    const beside = el('UL', el('LI', t('one')), el('UL', el('LI', t('nested'))));
    expect(toMarkdown(root(beside))).toBe('- one\n  - nested');
    const inside = el('UL', el('LI', t('one'), el('UL', el('LI', t('nested')))));
    expect(toMarkdown(root(inside))).toBe('- one\n  - nested');
  });

  it('styles the four marks and nothing else', () => {
    expect(toEditorHtml('**b** *i* __u__')).toBe(
      '<div><strong>b</strong> <em>i</em> <u>u</u></div>'
    );
  });

  it('LEAVES ALONE WHAT IT CANNOT WRITE BACK', () => {
    // The rule that makes this safe: opening a note must never change it, so
    // anything this editor could not turn back into the same Markdown stays
    // the literal text it already was. Headings, quotes, rules and written
    // links left this list when they learned to round-trip; a code span and a
    // bare URL are still here, and a stray asterisk always will be.
    expect(toEditorHtml('`code`')).toBe('<div>`code`</div>');
    expect(toEditorHtml('see https://x.com')).toBe('<div>see https://x.com</div>');
    expect(toEditorHtml('2 * 3')).toBe('<div>2 * 3</div>');
  });

  it('escapes, like everything else that makes HTML here', () => {
    expect(toEditorHtml('<script>')).toBe('<div>&lt;script&gt;</div>');
  });

  it('does not read a multiplication as italics', () => {
    // Quick notes are where sums get written: "2 * 3 * 4" must stay itself.
    expect(toEditorHtml('2 * 3 * 4 = 24')).toBe('<div>2 * 3 * 4 = 24</div>');
  });
});

/**
 * Both boxes that write a note offer the marks, read from the source the way
 * textLists.test.ts and screens.test.ts do — nothing rendered can notice a
 * handler that was never wired, and this app's recurring bug is a capability
 * landing on one screen and missing from the other.
 *
 * The note WIDGET is deliberately not here: it has no toolbar and nothing
 * renders it, so a mark written there would be asterisks for ever.
 */
const SOURCES = import.meta.glob('./components/*.svelte', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

const read = (file: string) =>
  Object.entries(SOURCES).find(([key]) => key.endsWith(file))?.[1] ?? '';

describe('bold, italic and underline are offered where notes are written', () => {
  for (const [file, what] of [
    ['QuickNotes.svelte', 'a quick note'],
    ['NoteEditor.svelte', 'a project or era note']
  ] as const) {
    it(`${what} takes the shortcut from the browser`, () => {
      // A contenteditable applies Cmd+B itself and reports it as an ordinary
      // input, so there is no key handler left to assert — what has to be
      // true is that the editor is the one in there.
      expect(read(file), `no such component: ${file}`).toContain('RichNote');
    });

    it(`${what} has an underline button`, () => {
      // Bold and italic predate this; underline is the one that had nowhere to
      // be written, so it is the one worth pinning.
      expect(read(file)).toContain('nderline');
    });
  }

});
