/**
 * A project inside an era, keyed by its name in the URL.
 *
 * By name and not by an id because the name IS the key everywhere else: every
 * to-do, note, recording, block and buy item points at a project by its `tag`
 * string. Giving projects ids here would mean migrating five tables to solve a
 * problem that only exists in the address bar. The cost is that renaming a
 * project changes its URL, which matters for a bookmark and nothing else.
 */
export const prerender = false;
