import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

/** Keep in sync with `BASE` in svelte.config.js. */
const BASE = '/FreeTime';

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
        theme_color: '#0f0f11',
        background_color: '#0f0f11',
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
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The app shell is cached so a cold start with no network still boots.
        // Same file as the adapter's SPA fallback, for the same reason.
        navigateFallback: `${BASE}/404.html`,

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
