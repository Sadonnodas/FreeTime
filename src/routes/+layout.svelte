<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { seedIfEmpty } from '$lib/seed';

  let { children } = $props();

  // Four tabs, nothing nested deeper than two levels (spec 4).
  const tabs = [
    { href: '/', label: 'Today', icon: '◉' },
    { href: '/projects', label: 'Projects', icon: '▦' },
    { href: '/brain', label: 'Brain', icon: '✦' },
    { href: '/me', label: 'Me', icon: '○' }
  ];

  let ready = $state(false);

  onMount(async () => {
    await seedIfEmpty();
    ready = true;

    // Registering the service worker is what makes the app boot with no
    // network. Imported dynamically because the virtual module only exists in
    // a real build, and because nothing about it needs to block first paint.
    // registerType 'autoUpdate' means a new build swaps in silently on the
    // next load — no "update available" prompt, per the no-nag rule.
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  });

  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<div class="flex h-dvh flex-col bg-ink-950">
  <main class="min-h-0 flex-1 overflow-y-auto">
    {#if ready}
      {@render children()}
    {/if}
  </main>

  <nav class="flex shrink-0 border-t border-ink-800 bg-ink-900 pb-safe">
    {#each tabs as tab (tab.href)}
      <a
        href={tab.href}
        class="tap flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs
               {isActive(tab.href) ? 'text-accent' : 'text-ink-400'}"
        aria-current={isActive(tab.href) ? 'page' : undefined}
      >
        <span class="text-lg leading-none" aria-hidden="true">{tab.icon}</span>
        {tab.label}
      </a>
    {/each}
  </nav>
</div>
