import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderMarks } from './markdown';

/**
 * This is the only place in the app that turns stored text into HTML, so the
 * escaping tests below are not box-ticking: a note syncs, so anything that got
 * through here would follow Toon to his other devices.
 */
describe('notes rendering', () => {
  it('links a URL that was simply pasted in', () => {
    // The actual reported case: a Claude share link pasted into a note, which
    // then had to be copied back out to be followed.
    const html = renderMarkdown('Trigger pad chat: https://claude.ai/share/abc-123');
    expect(html).toContain('href="https://claude.ai/share/abc-123"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('leaves trailing punctuation out of the link', () => {
    const html = renderMarkdown('see https://example.com/x.');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('</a>.');
  });

  it('links a bare domain as https, not as a path inside the app', () => {
    expect(renderMarkdown('www.bol.com/p/piezo')).toContain('href="https://www.bol.com/p/piezo"');
  });

  it('renders a markdown link with its own text', () => {
    const html = renderMarkdown('[the chat](https://claude.ai/share/abc)');
    expect(html).toContain('>the chat</a>');
    expect(html).toContain('href="https://claude.ai/share/abc"');
  });

  it('refuses a javascript: target and leaves it as inert text', () => {
    // The text is still shown — it is escaped, so it is words on a page — but
    // no anchor is made, which is the part that matters.
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
    expect(html).toBe('<p>[click](javascript:alert(1))</p>');
  });

  it('escapes HTML before it can become markup', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> & <b>hi</b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
  });

  it('handles headings, bold, italic and rules', () => {
    const html = renderMarkdown('## Plan\n\nsome **bold** and *slanted* words\n\n---');
    expect(html).toContain('<h3>Plan</h3>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>slanted</em>');
    expect(html).toContain('<hr>');
  });

  it('nests a list by its indentation', () => {
    const html = renderMarkdown('- top\n  - under it\n- back out');
    expect(html).toBe('<ul><li>top</li><ul><li>under it</li></ul><li>back out</li></ul>');
  });

  it('keeps numbered lists numbered', () => {
    expect(renderMarkdown('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('protects what is inside backticks', () => {
    // A note explaining the syntax must not be rendered by it.
    const html = renderMarkdown('use `**stars**` for bold');
    expect(html).toContain('<code>**stars**</code>');
    expect(html).not.toContain('<strong>');
  });

  it('does not mistake a bare number for a parked code span', () => {
    // The first version parked code spans as " 0 " and restored them by
    // matching a number between spaces, which ate ordinary numbers.
    expect(renderMarkdown('cut 3 pieces')).toBe('<p>cut 3 pieces</p>');
    expect(renderMarkdown('`x` and 0 and `y`')).toContain('and 0 and');
  });

  it('renders a blockquote, which escaping had turned into a paragraph', () => {
    // Escaping runs before the line parsing, so by the time a quote is looked
    // for the '>' is already '&gt;'. Matching the raw character quietly turned
    // every blockquote into a paragraph starting with the entity.
    expect(renderMarkdown('> Measure twice.')).toBe('<blockquote>Measure twice.</blockquote>');
  });

  it('is empty for empty input rather than throwing', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

describe('underline, which this app spells itself', () => {
  it('renders __text__ as an underline, not as bold', () => {
    // CommonMark says this is bold. It is underline here because underline
    // was asked for and markdown has no other way to write it; `**` still
    // means bold, so nothing written before this changed meaning.
    expect(renderMarkdown('__Lisa__ called')).toContain('<u>Lisa</u>');
    expect(renderMarkdown('__Lisa__ called')).not.toContain('<strong>');
    expect(renderMarkdown('**Lisa** called')).toContain('<strong>Lisa</strong>');
  });

  it('is escaped like everything else', () => {
    expect(renderMarkdown('__<b>x</b>__')).toBe('<p><u>&lt;b&gt;x&lt;/b&gt;</u></p>');
  });
});

describe('a one-line preview', () => {
  it('shows the marks and NEVER a link', () => {
    // The quick-notes rows are buttons; an <a> inside a <button> is invalid
    // HTML and the inner one stops working.
    expect(renderMarks('__Lisa__ at **9** on https://x.com')).toBe(
      '<u>Lisa</u> at <strong>9</strong> on https://x.com'
    );
  });

  it('escapes first', () => {
    expect(renderMarks('<script>')).toBe('&lt;script&gt;');
  });
});
