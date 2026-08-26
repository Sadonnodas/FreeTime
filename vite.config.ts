import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

/** Keep in sync with `BASE` in svelte.config.js. */
const BASE = '/FreeTime';

export default defineConfig({
  plugins: [
    // Tailwind v4 is a Vite plugin now — no tailwind.config.js, no PostCSS step.
    // Configuration lives in CSS via @theme (see src/app.css).
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      // 'autoUpdate' = the service worker installs a new build in the background
      // and swaps to it on next load. No "update available" nag, which fits the
      // spec's no-nag rule.
      registerType: 'autoUpdate',
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
        navigateFallback: `${BASE}/404.html`
      }
    })
  ]
});
