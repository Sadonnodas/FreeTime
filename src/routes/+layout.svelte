<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { seedIfEmpty } from '$lib/seed';
  import { base } from '$app/paths';
  import { onDestroy } from 'svelte';
  import { handleRedirect, renewIfSafe } from '$lib/google/auth';
  import { startSync } from '$lib/sync';

  let { children } = $props();

  let stopSync: (() => void) | undefined;
  onDestroy(() => stopSync?.());

  /**
   * Four tabs, nothing nested deeper than two levels (spec 4).
   *
   * Paths are stored without the base prefix and get it added at render time.
   * `base` is '/FreeTime' here because Pages serves this from a subpath — a
   * bare href="/projects" would leave the app entirely and land on GitHub's
   * 404. Storing the clean path keeps the active-tab comparison readable.
   */
  const tabs = [
    { path: '/', label: 'Today', icon: '◉' },
    { path: '/projects', label: 'Projects', icon: '▦' },
    { path: '/brain', label: 'Brain', icon: '✦' },
    { path: '/me', label: 'Me', icon: '○' }
  ];

  // base is '' at the domain root, so fall back to '/' rather than an empty href.
  const hrefFor = (path: string) => (path === '/' ? base || '/' : base + path);

  let ready = $state(false);

  onMount(async () => {
    // Order matters. The OAuth fragment has to be consumed before anything
    // else reads the URL, and the token has to be stored before sync starts.
    await handleRedirect();
    await seedIfEmpty();
    ready = true;

    // App start is one of the two safe moments to bounce through Google for a
    // fresh token — nothing is half-typed yet. If this redirects, everything
    // below simply runs again on the way back.
    await renewIfSafe();
    stopSync = startSync();

    // Registering the service worker is what makes the app boot with no
    // network. Imported dynamically because the virtual module only exists in
    // a real build, and because nothing about it needs to block first paint.
    // registerType 'autoUpdate' means a new build swaps in silently on the
    // next load — no "update available" prompt, per the no-nag rule.
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  });

  /**
   * page.url.pathname includes the base, so compare against the full href.
   * Today is an exact match; the others match their whole subtree so that a
   * project detail page still lights up the Projects tab.
   */
  function isActive(path: string): boolean {
    const here = page.url.pathname.replace(/\/$/, '');
    const root = base.replace(/\/$/, '');
    return path === '/' ? here === root : here.startsWith(root + path);
  }
</script>

<div class="flex h-dvh flex-col bg-ink-950">
  <main class="min-h-0 flex-1 overflow-y-auto">
    {#if ready}
      {@render children()}
    {/if}
  </main>

  <nav class="flex shrink-0 border-t border-ink-800 bg-ink-900 pb-safe">
    {#each tabs as tab (tab.path)}
      <a
        href={hrefFor(tab.path)}
        class="tap flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs
               {isActive(tab.path) ? 'text-accent' : 'text-ink-400'}"
        aria-current={isActive(tab.path) ? 'page' : undefined}
      >
        <span class="text-lg leading-none" aria-hidden="true">{tab.icon}</span>
        {tab.label}
      </a>
    {/each}
  </nav>
</div>
