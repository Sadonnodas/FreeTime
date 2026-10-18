import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * adapter-static turns the whole app into plain HTML/JS/CSS files that any dumb
 * file server (GitHub Pages) can serve. There is no Node server at runtime.
 *
 * BASE PATH: this lives in a *project* repo, so Pages serves it from
 * https://sadonnodas.github.io/FreeTime/ rather than the domain root. Every
 * absolute link and asset URL has to carry that prefix, which is what
 * `paths.base` does. The spec (section 1) originally called for a user repo
 * precisely to avoid this, so if you ever move to Sadonnodas.github.io, set
 * BASE to '' and the whole app follows.
 *
 * Note it applies in dev too — `npm run dev` serves at localhost:5173/FreeTime.
 * That is deliberate: dev and prod resolving URLs differently is exactly how a
 * broken link ships unnoticed.
 */
const BASE = '/FreeTime';

/**
 * `fallback` is the SPA shell: any URL with no matching file gets served this
 * instead, and the client-side router takes over. On GitHub Pages it MUST be
 * named 404.html — Pages serves 404.html for unknown paths and has no way to
 * be told otherwise. (200.html is the equivalent trick on Netlify and friends,
 * and would silently do nothing here.) Without it, a hard refresh on a project
 * detail URL would hit GitHub's own 404 page.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: '404.html',
      precompress: false,
      strict: true
    }),
    paths: {
      base: BASE,
      /*
       * ABSOLUTE ASSET URLS, AND THE SERVICE WORKER IS WHY.
       *
       * SvelteKit 2 defaults this to true, which writes `./_app/…` into every
       * prerendered page — correct for a page served from the one path it was
       * prerendered at, and wrong for the app SHELL, which by definition gets
       * served for URLs at any depth. Offline, a refresh on
       * /FreeTime/projects/<id>/Mixing is answered from cache with the shell,
       * the browser resolves `./_app/…` against THAT url, and asks for
       * /FreeTime/projects/<id>/_app/… — which is in no cache and on no server.
       * The page comes up blank with "Failed to fetch dynamically imported
       * module" and nothing else.
       *
       * `build/404.html` was already absolute, because the adapter cannot know
       * what depth a fallback will be served at. This makes the rest agree, so
       * any cached page can answer for any url.
       *
       * The cost is that the app can only be served from BASE, which is the
       * only place it is ever served from; set BASE to '' and absolute urls
       * follow it to a domain root exactly as relative ones would.
       */
      relative: false
    }
  }
};

export default config;
