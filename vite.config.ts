import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

/** Keep in sync with `BASE` in svelte.config.js. */
const BASE = '/FreeTime';

/**
 * The document the service worker hands back for any URL it has no file for —
 * the app shell, offline and on a deep link.
 *
 * Named once because the worker needs it TWICE and the two uses must agree: the
 * file has to be in the precache, and the navigation route has to point at it.
 * They disagreed for months, and the cost was the whole of offline — see the
 * workbox block below.
 *
 * IT IS index.html AND NOT 404.html, which is the adapter's SPA fallback and
 * the obvious choice. Both are the same 4KB of empty shell (this app renders
 * from IndexedDB in JavaScript, so neither carries any content), and the
 * difference is what a host answers when asked for it BY NAME: Pages serves
 * /FreeTime/404.html as 200, and SvelteKit's own preview server serves it as
 * 404 — correctly, since serving that file is how it says "no such page".
 * A precache entry that answers 4xx throws `bad-precaching-response` and fails
 * the whole install, so 404.html makes offline work on the live site and
 * impossible to test anywhere else. index.html is 200 on both.
 */
const SHELL = 'index.html';

export default defineConfig({
  define: {
    // Stamped at build time so Settings can say which build is running. An
    // installed home-screen app gives no other way to tell.
    __APP_VERSION__: JSON.stringify(new Date().toISOString())
  },
  plugins: [
    // Tailwind v4 is a Vite plugin now — no tailwind.config.js, no PostCSS step.
    // Configuration lives in CSS via @theme (see src/app.css).
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      /*
       * 'prompt' does NOT mean the user is prompted — nothing in this app ever
       * asks "update available?". It means the reload is ours to time rather
       * than the plugin's, and that matters now that the app checks for new
       * builds every half hour instead of only at startup.
       *
       * Under 'autoUpdate' the page reloads the instant a new worker takes
       * control. That was harmless when updates could only be discovered during
       * a page load; with periodic checks it would eventually land mid-sentence
       * and throw away whatever was in the capture box. See lib/pwa.ts, which
       * installs waiting builds only while the app is in the background or
       * being brought back to the foreground.
       */
      registerType: 'prompt',
      // Must match kit.paths.base in svelte.config.js. Everything a manifest
      // points at is resolved against the origin, not the manifest's own
      // location, so these paths need the /FreeTime/ prefix spelled out.
      base: `${BASE}/`,
      manifest: {
        name: 'FREETIME',
        short_name: 'FREETIME',
        description: 'A personal life organizer.',
        // Both match --color-ink-950 exactly. background_color paints the iOS
        // launch screen, so anything else here shows as a flash of the wrong
        // black every time the app opens.
        theme_color: '#08080a',
        background_color: '#08080a',
        // 'standalone' hides the browser chrome once installed to the home screen.
        display: 'standalone',
        orientation: 'portrait',
        // `scope` is what keeps the installed app installed: navigations inside
        // it stay in the standalone window, anything outside bounces to the
        // browser. Scoping to /FreeTime/ also means a future app at the domain
        // root would not collide with this one.
        start_url: `${BASE}/`,
        scope: `${BASE}/`,
        icons: [
          { src: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${BASE}/icons/icon-512-maskable.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      /*
       * THE SPA SHELL HAS TO BE PUT IN THE PRECACHE BY HAND, and without this
       * the app had no service worker at all.
       *
       * `navigateFallback` below compiles to
       * `createHandlerBoundToURL('/FreeTime/404.html')`, and that function
       * THROWS — while the worker script is still being evaluated — if the URL
       * it is handed was not precached. A worker whose script throws never
       * installs, so this was not "deep links fall back to the network": it was
       * no offline support anywhere, for anything, while every line of config
       * around it claimed otherwise.
       *
       * And the file genuinely was not in there. The plugin builds its manifest
       * by globbing `.svelte-kit/output`, where adapter-static does NOT put the
       * fallback — `generateFallback` writes it straight to `build/404.html` —
       * so no glob could ever have found it. `spa` + `adapterFallback` is the
       * plugin's own answer: it appends the entry itself, with a revision taken
       * from the build's version.json, so a new deploy re-fetches the shell
       * (which it must, since the shell names hashed chunks).
       *
       * Checked by scripts/check-offline.mjs, which runs the built worker and
       * fails the deploy if it cannot install. Prose did not stop this one.
       */
      kit: {
        // Tells the plugin the adapter writes a fallback, which is what opens
        // the `spa` branch below. The name is the adapter's, not the shell's.
        adapterFallback: '404.html',
        // And this is the branch: it appends the entry itself, under the name
        // given here, with a revision hashed from the build's version.json — so
        // every deploy re-fetches the shell, which it must, since the shell
        // names hashed chunks.
        spa: { fallbackMapping: SHELL }
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],

        /*
         * DROP THE GLOB'S OWN index.html ENTRY — it points outside the app, and
         * that was the SECOND reason there was no service worker.
         *
         * The plugin maps `index.html` to Vite's `base`, which SvelteKit leaves
         * at '/' because it does its own base handling. So the entry came out as
         * `/`, which resolves against the worker's own URL to
         * `https://sadonnodas.github.io/` rather than `…/FreeTime/` — the GitHub
         * user page, which 404s (verified), and a precache entry that answers
         * 4xx throws `bad-precaching-response` and fails the install. Even with
         * the fallback above fixed, the worker would still never have installed.
         *
         * Nothing is lost: the SHELL entry above precaches the same file at the
         * right URL, and workbox resolves a request for `…/FreeTime/` to
         * `…/FreeTime/index.html` by itself, so the home page is served from the
         * cache and doubles as the shell. One file, one entry, both jobs.
         *
         * Setting Vite's `base` would have corrected the mapping at source and
         * was the alternative; it lost because SvelteKit owns base-path
         * resolution and overriding it risks every asset URL in the app.
         */
        globIgnores: ['prerendered/pages/index.html'],

        // The app shell is cached so a cold start with no network still boots,
        // and the same cached file answers every deep link the worker has no
        // page for. Must be an entry the manifest above actually contains.
        navigateFallback: `${BASE}/${SHELL}`,

        /*
         * A new worker takes over the moment it installs, rather than queueing
         * behind the old one.
         *
         * WHY, having deliberately avoided this once already. Without it a new
         * worker sits in "waiting" until every client it would control has gone
         * away — and on an iOS home-screen app that moment may never arrive.
         * Swiping the app out of the App Switcher does not reliably produce it:
         * the launch after it is served by the OLD worker, which controls the
         * new page before the waiting one is ever consulted. Observed on a real
         * iPhone, where an installed app stayed weeks behind through repeated
         * force-quits. An update mechanism that can wedge permanently on the
         * one platform this app is mainly used on is not an update mechanism.
         *
         * skipWaiting alone would leave a running page on old JavaScript while
         * the worker serves new assets, and the old code-split chunks are gone
         * from Pages after a deploy — so a navigation could 404. pwa.ts closes
         * that window by reloading on controllerchange, at a safe moment.
         */
        skipWaiting: true,
        clientsClaim: true
      }
    })
  ]
});
