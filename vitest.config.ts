import { defineConfig } from 'vitest/config';

/**
 * Tests run in Node, but the app's whole storage layer is IndexedDB — a browser
 * API. `fake-indexeddb/auto` installs a working in-memory implementation onto
 * globalThis, so Dexie runs unmodified and the tests exercise the real store
 * rather than a mock of it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['src/**/*.test.ts']
  }
});
