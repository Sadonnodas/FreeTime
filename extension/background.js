/*
 * Add to FreeTime — the Chrome extension.
 *
 * It SAVES NOTHING. FreeTime keeps everything in its own storage on
 * sadonnodas.github.io, which no extension may write to, so this reads the
 * page you are on and opens FreeTime's "Add to FreeTime" screen with what it
 * found filled in. You pick the project and tap Add there; FreeTime does the
 * saving and syncing. (The app side is src/lib/clip.ts and src/routes/add.)
 *
 * Everything travels after the "#" of the address, which a browser never sends
 * to a server — the page you were on and its price are not in anyone's log.
 *
 * Why <all_urls>: to read the page you ask it to (only when you click), and to
 * fetch a product photo from whatever site serves it, so it can be shrunk to a
 * thumbnail here before it is handed over.
 */

const APP = 'https://sadonnodas.github.io/FreeTime/add';
const THUMB_EDGE = 480;

// ---------------------------------------------------------------- the menu

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'page', title: 'Add this page to FreeTime', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'selection', title: 'Add selected text to FreeTime', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'link', title: 'Add this link to FreeTime', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'image', title: 'Add this image to FreeTime as a to-buy', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'shot', title: 'Screenshot to a FreeTime to-do', contexts: ['page'] });
  });
});

// The toolbar button: the page as a to-buy if it looks like a product, as a
// note if text is selected, and as an idea otherwise. The Add screen lets
// you change which.
chrome.action.onClicked.addListener((tab) => clipPage(tab));

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === 'page') return clipPage(tab, { ignoreSelection: true });
  if (info.menuItemId === 'selection') {
    const page = await readTab(tab);
    return open({ kind: 'note', text: info.selectionText, title: page.title, url: page.url });
  }
  if (info.menuItemId === 'link') {
    return open({ kind: 'idea', url: info.linkUrl, title: info.linkUrl && prettyLink(info.linkUrl) });
  }
  if (info.menuItemId === 'image') {
    const page = await readTab(tab);
    return open({
      kind: 'buy',
      title: page.title,
      url: page.url,
      price: page.price,
      currency: page.currency,
      image: await smallImage(info.srcUrl)
    });
  }
  if (info.menuItemId === 'shot') {
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    return open({ kind: 'todo', title: tab.title, url: tab.url, image: await smallImage(shot) });
  }
});

// ---------------------------------------------------------------- clipping

async function clipPage(tab, { ignoreSelection = false } = {}) {
  const page = await readTab(tab);
  const text = ignoreSelection ? '' : page.selection;
  const kind = text ? 'note' : page.isProduct ? 'buy' : 'idea';
  return open({
    kind,
    title: page.title,
    url: page.url,
    text,
    price: kind === 'buy' ? page.price : undefined,
    currency: kind === 'buy' ? page.currency : undefined,
    image: kind === 'buy' && page.imageUrl ? await smallImage(page.imageUrl) : undefined
  });
}

/** What the page says about itself, or just its title and address when the
 *  page cannot be read (Chrome's own pages, the Web Store). */
async function readTab(tab) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    return res?.result ?? { title: tab.title, url: tab.url };
  } catch {
    return { title: tab.title, url: tab.url };
  }
}

function open(fields) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v) params.set(k, String(v));
  return chrome.tabs.create({ url: `${APP}#${params.toString()}` });
}

function prettyLink(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '');
  } catch {
    return url;
  }
}

/**
 * A photo, shrunk to a thumbnail here — FreeTime could not fetch it itself
 * (the shop's server would refuse another site), and a full-size product shot
 * is megabytes that would ride along with every sync. Undefined when the
 * picture cannot be had; the rest still goes.
 */
async function smallImage(src) {
  if (!src) return undefined;
  try {
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent product cut-outs, on white
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    const bytes = new Uint8Array(await out.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(bin)}`;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------- runs inside the web page

/**
 * Reads what a page says about itself. Shops describe their products in a
 * standard way (schema.org Product, in a JSON-LD script) for search engines,
 * and most social previews add og: tags — so name, price and photo usually
 * come from those rather than from guessing at the layout, which changes.
 * Self-contained: Chrome copies this function into the page to run it.
 */
function readPage() {
  const meta = (name) =>
    document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || undefined;
  const out = {
    title: meta('og:title') || document.title,
    url: location.href,
    selection: String(window.getSelection() || '').trim()
  };

  let product = null;
  const walk = (node) => {
    if (!node || product) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    const type = node['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
      product = node;
      return;
    }
    if (node['@graph']) walk(node['@graph']);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(script.textContent));
    } catch {
      // A broken block on someone's page is not our problem to report.
    }
  }

  if (product) {
    out.isProduct = true;
    if (product.name) out.title = product.name;
    const offers = [].concat(product.offers || []).flatMap((o) => (o && o.offers ? [].concat(o.offers) : [o]));
    const offer = offers.find((o) => o && (o.price != null || o.lowPrice != null));
    if (offer) {
      out.price = String(offer.price ?? offer.lowPrice);
      out.currency = offer.priceCurrency;
    }
    const img = [].concat(product.image || [])[0];
    out.imageUrl = typeof img === 'string' ? img : img?.url;
  }

  out.price ||=
    meta('product:price:amount') ||
    meta('og:price:amount') ||
    document.querySelector('[itemprop="price"]')?.getAttribute('content') ||
    undefined;
  out.currency ||=
    meta('product:price:currency') ||
    meta('og:price:currency') ||
    document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') ||
    undefined;
  out.imageUrl ||= meta('og:image') || meta('twitter:image');
  if (out.price) out.isProduct = true;
  if (out.imageUrl) {
    try {
      out.imageUrl = new URL(out.imageUrl, location.href).href;
    } catch {
      out.imageUrl = undefined;
    }
  }
  return out;
}
