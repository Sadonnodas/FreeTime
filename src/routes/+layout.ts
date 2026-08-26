/**
 * ssr = false because everything the app knows lives in IndexedDB, which only
 * exists in the browser. Rendering on the server would produce an empty shell
 * and then flash. prerender = true bakes the shell to static HTML at build
 * time, which is what GitHub Pages serves.
 */
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'never';
