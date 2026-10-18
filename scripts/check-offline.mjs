/**
 * Does the built service worker actually install?
 *
 * Run after `npm run build`. It exists because the answer was NO for months
 * while every line of PWA config said otherwise, and nothing in the repo could
 * notice: the failure is not in any source file, it is in the generated
 * worker, and it is fatal at script-evaluation time.
 *
 * WHAT WENT WRONG. `workbox.navigateFallback` compiles to
 * `createHandlerBoundToURL(url)`, which throws synchronously when `url` was not
 * precached. It pointed at the SPA shell, which the plugin never precached
 * (adapter-static writes it outside the directory the plugin globs). A worker
 * whose script throws never reaches `install`, so there was no worker at all —
 * no offline boot, no cached assets, nothing. The app looked offline-capable
 * and was entirely dependent on the network.
 *
 * Separately, a precache entry that answers 4xx throws `bad-precaching-response`
 * during install, which fails it just as completely. That is why every entry is
 * resolved to a real file here rather than only counted.
 *
 * So there are four checks, and all four are about the BUILD, not the source:
 *   1. the worker script evaluates and registers an `install` listener;
 *   2. every precache URL points inside the app and at a file that exists;
 *   3. the navigation fallback is one of those precached URLs;
 *   4. the fallback's own asset urls are absolute, so it can answer for a url
 *      at any depth. A relative `./_app/…` in the shell works at the one path
 *      it was prerendered at and gives a blank page everywhere else — see
 *      `paths.relative` in svelte.config.js.
 *
 * It runs the real worker in a stub ServiceWorkerGlobalScope. That is cruder
 * than a browser and it is the only thing available: the in-app preview browser
 * refuses to activate workers at all, and a real device cannot gate a deploy.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import config from '../svelte.config.js';

const BUILD = resolve(import.meta.dirname, '../build');
const BASE = config.kit.paths.base; // '/FreeTime' — the one source of truth
const ORIGIN = `https://example.invalid${BASE}/`;

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

if (!existsSync(`${BUILD}/sw.js`)) {
  fail('build/sw.js is missing. Run `npm run build` first.');
  process.exit(1);
}
const source = readFileSync(`${BUILD}/sw.js`, 'utf8');

// ---------------------------------------------------------------- 1. it runs

const listeners = [];
const scope = {
  console: { ...console, warn: () => {}, log: () => {} },
  URL,
  Request,
  Response,
  Headers,
  fetch,
  location: new URL(`${ORIGIN}sw.js`),
  registration: { scope: ORIGIN },
  clients: { claim: () => {} },
  caches: {
    open: async () => ({ match: async () => undefined, keys: async () => [] }),
    keys: async () => []
  },
  skipWaiting: () => {},
  addEventListener: (type) => listeners.push(type),
  // The worker loads its workbox bundle from beside itself.
  importScripts: (...files) => {
    for (const file of files) {
      const path = `${BUILD}/${file.split('/').pop()}`;
      vm.runInContext(readFileSync(path, 'utf8'), context, { filename: file });
    }
  }
};
scope.self = scope;
scope.globalThis = scope;
const context = vm.createContext(scope);

/*
 * The failure arrives as an unhandled REJECTION, not as a throw, and that is
 * worth knowing: this bundle's AMD shim runs the module factory inside a
 * `Promise.all().then()`, so a `throw` in there escapes any try/catch around
 * `runInContext`. Left to Node it also prints the entire minified workbox
 * bundle as the offending source line, which buries the one sentence that
 * matters. Caught here so the message is the message.
 */
let thrown;
process.on('unhandledRejection', (err) => {
  thrown ??= err;
});

try {
  vm.runInContext(source, context, { filename: 'sw.js' });
  await new Promise((r) => setTimeout(r, 200));
} catch (err) {
  thrown ??= err;
}

if (thrown) {
  fail(
    'the service worker threw while being evaluated, so it can never install:' +
      `\n    ${thrown.name}: ${thrown.message}`
  );
  process.exit(1);
}

if (!listeners.includes('install')) {
  fail('the service worker registered no `install` listener, so nothing is precached.');
  process.exit(1);
}

// --------------------------------------------- 2. every entry really is there

const urls = [...source.matchAll(/\{url:"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
if (urls.length < 10) {
  fail(`only ${urls.length} precache entries found — the manifest did not parse, or the build is wrong.`);
  process.exit(1);
}

/** Where GitHub Pages would find this URL in `build/`, or null if nowhere. */
function fileFor(url) {
  const { pathname } = new URL(url, `${ORIGIN}sw.js`);
  if (pathname === BASE) return existsSync(`${BUILD}/index.html`) ? 'index.html' : null;
  if (!pathname.startsWith(`${BASE}/`)) return null; // outside the app entirely
  const rel = decodeURIComponent(pathname.slice(BASE.length + 1)) || 'index.html';
  // Pages serves /foo for foo.html and /foo/ for foo/index.html.
  for (const candidate of [rel, `${rel}.html`, `${rel}/index.html`]) {
    if (existsSync(`${BUILD}/${candidate}`)) return candidate;
  }
  return null;
}

let missing = 0;
for (const url of urls) {
  if (fileFor(url)) continue;
  missing++;
  const { href } = new URL(url, `${ORIGIN}sw.js`);
  if (missing <= 8) {
    fail(`precached "${url}" resolves to ${href}, which is not a file in build/.` +
      ' An entry that answers 4xx fails the whole install.');
  }
}
if (missing > 8) fail(`…and ${missing - 8} more unresolvable precache entries.`);

// ------------------------------------------------ 3. the fallback is precached

const fallback = source.match(/createHandlerBoundToURL\("((?:[^"\\]|\\.)*)"\)/)?.[1];
if (!fallback) {
  fail('no navigation fallback is registered, so a deep link will not open offline.');
} else {
  const want = new URL(fallback, `${ORIGIN}sw.js`).href;
  const precached = urls.map((u) => new URL(u, `${ORIGIN}sw.js`).href);
  if (!precached.includes(want)) {
    fail(`the navigation fallback ${want} is not precached. createHandlerBoundToURL` +
      ' throws on that, and a worker that throws never installs.');
  }
}

// ------------------------------------- 4. the fallback works at any depth

/*
 * The shell is served for urls it was not prerendered at, so every asset it
 * names has to be absolute. One relative `./_app/…` and a refresh on a project
 * page offline asks for `/FreeTime/projects/<id>/_app/…`, which is in no cache
 * and on no server: a blank screen and one console error. Found exactly that
 * way, with the preview server stopped.
 */
if (fallback) {
  const file = fileFor(fallback);
  if (file) {
    const html = readFileSync(`${BUILD}/${file}`, 'utf8');
    const relative = [...html.matchAll(/(?:href|src)="(\.\.?\/[^"]*)"/g)].map((m) => m[1]);
    if (relative.length) {
      fail(
        `the shell ${file} names ${relative.length} asset(s) by a RELATIVE url,` +
          ` starting with "${relative[0]}". Served for a deeper url it will ask` +
          ' for them in the wrong place and render nothing. Set `paths.relative:' +
          ' false` in svelte.config.js.'
      );
    }
  }
}

if (!process.exitCode) {
  console.log(
    `✓ service worker installs; ${urls.length} precached files all present;` +
      ` navigation falls back to ${fallback} with absolute asset urls`
  );
}
