/// <reference types="vite-plugin-pwa/info" />
/// <reference types="vite-plugin-pwa/client" />

declare global {
  namespace App {}

  /** Build timestamp, injected by `define` in vite.config.ts. */
  const __APP_VERSION__: string;
}
export {};
