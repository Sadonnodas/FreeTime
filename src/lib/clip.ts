/**
 * Something handed to FreeTime from outside — the Chrome extension, an iOS
 * Shortcut, a bookmark — to be filed on the /add screen.
 *
 * WHY A HAND-OVER AND NOT A WRITE. Everything lives in this app's own storage
 * (IndexedDB, on this origin), and nothing else — an extension included — is
 * allowed to write there. So a clipper never saves anything: it opens
 * `/FreeTime/add#…` with what it found, and this app does the saving, after
 * you have looked at it and picked where it goes. That is the assistant's
 * rule too (spec 7.1): outside things PROPOSE; only a tap writes.
 *
 * IN THE HASH, NOT THE QUERY. A URL's `#…` part never leaves the browser —
 * GitHub Pages does not receive it, so the page you were reading and the
 * price you were looking at are not in anyone's server log. It also has no
 * practical length limit in Chrome, which matters for a photo.
 *
 * Validated, not trusted: a link can be typed by anyone. Unknown kinds fall
 * back, a photo must be a data: image (never a remote URL the app would then
 * fetch), and a price that does not parse is simply left out — a wrong price
 * is worse than none, the rule the buy list already holds.
 */

export type ClipKind = 'buy' | 'idea' | 'todo' | 'note';
const KINDS: ClipKind[] = ['buy', 'idea', 'todo', 'note'];

export interface Clip {
  kind: ClipKind;
  /** The thing's name: a product, a page title, a to-do. */
  title: string;
  /** Where it came from, if it came from a page. */
  url?: string;
  /** Price of ONE, in cents — BuyItem's own unit. */
  priceCents?: number;
  currency?: string;
  /** A photo, already small — a data:image URL only. */
  image?: string;
  /** Selected text, for a note. */
  text?: string;
}

const MAX_TEXT = 20000;
const clean = (v: string | null, max = 500) => (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * "12.99", "12,99", "€ 1.299,00", "1,299.00", "$5" → cents. The LAST
 * separator followed by one or two digits is the decimal point; any other
 * separator is thousands. Null when it is not a price.
 */
export function parsePrice(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return undefined;
  const m = /^(.*?)[.,](\d{1,2})$/.exec(s);
  const whole = (m ? m[1] : s).replace(/[.,]/g, '');
  const frac = m ? m[2].padEnd(2, '0') : '00';
  if (!whole && !m) return undefined;
  const cents = Number(whole || '0') * 100 + Number(frac);
  return Number.isFinite(cents) && cents > 0 && cents < 1e11 ? cents : undefined;
}

/** Only http(s) links are kept; anything else (javascript:, data:) is dropped. */
function safeUrl(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseClip(hash: string): Clip | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const url = safeUrl(p.get('url'));
  const text = (p.get('text') ?? '').trim().slice(0, MAX_TEXT) || undefined;
  const title = clean(p.get('title')) || (url ? new URL(url).hostname.replace(/^www\./, '') : '');
  if (!title && !text) return null;

  const asked = p.get('kind') as ClipKind | null;
  const kind: ClipKind = asked && KINDS.includes(asked) ? asked : text ? 'note' : 'idea';
  const image = p.get('image') ?? '';
  const currency = clean(p.get('currency'), 3).toUpperCase();

  return {
    kind,
    title,
    url,
    priceCents: parsePrice(p.get('price')),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    image: /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image) ? image : undefined,
    text
  };
}

/** A note's text: the selection, then where it came from. */
export function noteText(c: Clip): string {
  const source = c.url ? `[${c.title}](${c.url})` : c.title;
  return c.text ? `${c.text}\n\n— ${source}` : source;
}
