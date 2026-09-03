/**
 * A small Markdown renderer for notes.
 *
 * WHY NOT A LIBRARY. The app has two runtime dependencies and both earn their
 * place — Dexie is the database, and Leaflet only loads if a map is opened. A
 * markdown library is tens of kilobytes on every page load to render text that
 * is, in practice, headings, bullets, bold and the occasional pasted link. This
 * is that subset and nothing else.
 *
 * SAFETY. Everything is HTML-escaped BEFORE any markup is added, so no note can
 * introduce a tag of its own, and only the tags produced below ever reach the
 * page. Link targets are checked against a scheme allowlist, because
 * `[click](javascript:...)` is otherwise a working script injection into your
 * own notes — which sync, so it would follow you to your other devices.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * A private-use character, as the marker for a parked code span.
 *
 * It has to be something a note cannot contain by accident: an earlier version
 * parked them as " 0 " and then put them back by matching a number between
 * spaces, which happily ate any bare number someone had typed.
 */
const MARK = '\uE000';

/** http, https and mailto only. Anything else renders as plain text. */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  // A bare domain pasted without a scheme. Treated as https rather than as a
  // relative path, which would point back at the app itself.
  if (/^www\.[^\s]+$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

const link = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/**
 * Inline formatting, applied to already-escaped text.
 *
 * Code spans are parked first and restored last, so backticks protect what is
 * inside them — otherwise a note explaining `**not bold**` would render bold
 * and lose the point it was making.
 */
function inline(escaped: string): string {
  const codes: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code);
    return `${MARK}${codes.length - 1}${MARK}`;
  });

  // [text](url) before bare URLs, or the url inside the parens gets linkified
  // first and the surrounding syntax is left behind as visible punctuation.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, url: string) => {
    const href = safeHref(url);
    return href ? link(href, text) : whole;
  });

  // A pasted link, which is how they actually arrive — nobody types the
  // brackets. Trailing punctuation stays outside the href, so "see
  // https://x.com/y." does not put the full stop in the link.
  out = out.replace(
    /(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+)/g,
    (whole, before: string, url: string) => {
      const trailing = url.match(/[.,;:!?)]+$/)?.[0] ?? '';
      const bare = url.slice(0, url.length - trailing.length);
      const href = safeHref(bare);
      return href ? `${before}${link(href, bare)}${trailing}` : whole;
    }
  );

  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return out.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_, i: string) => `<code>${codes[Number(i)]}</code>`
  );
}

interface ListLevel {
  tag: 'ul' | 'ol';
  indent: number;
}

/** Markdown to HTML, for the subset described above. */
export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source ?? '').split('\n');
  const out: string[] = [];
  const stack: ListLevel[] = [];
  let paragraph: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join('<br>'))}</p>`);
      paragraph = [];
    }
  };
  const closeLists = (toIndent = -1) => {
    while (stack.length && stack[stack.length - 1].indent > toIndent) {
      out.push(`</${stack.pop()!.tag}>`);
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (!line.trim()) {
      closeParagraph();
      closeLists();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeLists();
      // h1 is the page's own title, so a note's biggest heading is an h2.
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      closeParagraph();
      closeLists();
      out.push('<hr>');
      continue;
    }

    // &gt; and not >, because escaping happens before this loop runs. Matching
    // the raw character silently rendered every blockquote as a paragraph
    // beginning "&gt;", which looked like the syntax simply was not supported.
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      closeParagraph();
      closeLists();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    // Indentation is what makes a sub-point a sub-point. A tab counts as two
    // spaces, so a note typed on a laptop nests the same way on the phone.
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      closeParagraph();
      const indent = item[1].replace(/\t/g, '  ').length;
      const tag: 'ul' | 'ol' = /\d/.test(item[2]) ? 'ol' : 'ul';

      closeLists(indent);
      const top = stack[stack.length - 1];
      if (!top || top.indent < indent) {
        stack.push({ tag, indent });
        out.push(`<${tag}>`);
      } else if (top.tag !== tag) {
        out.push(`</${top.tag}>`);
        stack[stack.length - 1] = { tag, indent };
        out.push(`<${tag}>`);
      }
      out.push(`<li>${inline(item[3])}</li>`);
      continue;
    }

    closeLists();
    paragraph.push(line);
  }

  closeParagraph();
  closeLists();
  return out.join('');
}
