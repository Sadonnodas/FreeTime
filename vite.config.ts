import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

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
      manifest: {
        name: 'FREETIME',
        short_name: 'FREETIME',
        description: 'A personal life organizer.',
        theme_color: '#0f0f11',
        background_color: '#0f0f11',
        // 'standalone' hides the browser chrome once installed to the home screen.
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The app shell is cached so a cold start with no network still boots.
        navigateFallback: '/200.html'
      }
    })
  ]
});
