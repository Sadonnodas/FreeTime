/**
 * Project ids are uuids created at runtime, so there is no fixed set of URLs to
 * bake at build time. This route is served by the SPA fallback (200.html) and
 * resolves its data from IndexedDB in the browser.
 */
export const prerender = false;
