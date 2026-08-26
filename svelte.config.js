import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * adapter-static turns the whole app into plain HTML/JS/CSS files that any dumb
 * file server (GitHub Pages) can serve. There is no Node server at runtime.
 *
 * `fallback: '200.html'` makes it a single-page app: any URL that isn't a real
 * file gets served 200.html, and the client-side router takes over from there.
 * Without this, a hard refresh on /brain would 404 on GitHub Pages.
 *
 * No `paths.base` is set on purpose — the spec puts this on a *user* repo
 * (Sadonnodas.github.io), which serves from the domain root. A project repo
 * would serve from /freetime/ and require base-path juggling everywhere.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: '200.html',
      precompress: false,
      strict: true
    })
  }
};

export default config;
