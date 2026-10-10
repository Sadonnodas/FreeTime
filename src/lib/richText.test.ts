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
const root = (...children: Nodeish[]) => el('DIV', ...children);

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

  it('styles the four marks and nothing else', () => {
    expect(toEditorHtml('**b** *i* __u__')).toBe(
      '<div><strong>b</strong> <em>i</em> <u>u</u></div>'
    );
  });

  it('LEAVES ALONE WHAT IT CANNOT WRITE BACK', () => {
    // The rule that makes this safe: opening a note must never change it, so
    // a heading, a link or a quote travels through as the text it already is
    // rather than becoming HTML this editor could not turn back into markdown.
    expect(toEditorHtml('# Heading')).toBe('<div># Heading</div>');
    expect(toEditorHtml('> quoted')).toBe('<div>&gt; quoted</div>');
    expect(toEditorHtml('see https://x.com')).toBe('<div>see https://x.com</div>');
  });

  it('escapes, like everything else that makes HTML here', () => {
    expect(toEditorHtml('<script>')).toBe('<div>&lt;script&gt;</div>');
  });

  it('does not read a multiplication as italics', () => {
    // Quick notes are where sums get written: "2 * 3 * 4" must stay itself.
    expect(toEditorHtml('2 * 3 * 4 = 24')).toBe('<div>2 * 3 * 4 = 24</div>');
  });
});
