import { defineConfig } from 'vitest/config';

/**
 * Tests run in Node, but the app's whole storage layer is IndexedDB — a browser
 * API. `fake-indexeddb/auto` installs a working in-memory implementation onto
 * globalThis, so Dexie runs unmodified and the tests exercise the real store
 * rather than a mock of it.
 */
export default defineConfig({
  resolve: {
    alias: {
      // SvelteKit generates $app/* at build time, so a plain `vitest` run
      // cannot resolve it and any module importing one is untestable. Only
      // `base` is needed out here, and under test the app is at the root.
      '$app/paths': new URL('./src/lib/test/app-paths.ts', import.meta.url).pathname
    }
  },
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['src/**/*.test.ts']
  }
});
