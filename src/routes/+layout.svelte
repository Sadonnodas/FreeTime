<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { openStore as openLocalStore } from '$lib/boot';
  import { migrateToFourKinds, needsMigration } from '$lib/migrate';
  import { base } from '$app/paths';
  import { onDestroy } from 'svelte';
  import { handleRedirect, renewIfSafe } from '$lib/google/auth';
  import { startSync } from '$lib/sync';
  import { processQueue } from '$lib/gemini/commit';
  import { startThemeWatch } from '$lib/theme';

  let { children } = $props();

  let stopSync: (() => void) | undefined;
  let stopUpdates: (() => void) | undefined;
  // Started outside onMount so the theme is settled before the first render,
  // rather than a frame after it. The pre-paint script in app.html has already
  // set the attribute; this keeps `system` following the OS live afterwards.
  const stopTheme = startThemeWatch();
  const drainQueue = () => void processQueue();

  onDestroy(() => {
    stopSync?.();
    stopUpdates?.();
    stopTheme();
    window.removeEventListener('online', drainQueue);
  });

  /**
   * Five tabs, nothing nested deeper than two levels.
   *
   * The spec said four and put settings inside Me. That conflated two
   * unrelated things — habits and wins are about you, while sync, keys and
   * appearance are about the app — and it made configuration something you had
   * to remember was hiding behind a personal tab. Settings is its own
   * destination now, which is the fifth and last: six would start to crowd the
   * bar on a phone.
   *
   * Paths are stored without the base prefix and get it added at render time.
   * `base` is '/FreeTime' here because Pages serves this from a subpath — a
   * bare href="/projects" would leave the app entirely and land on GitHub's
   * 404. Storing the clean path keeps the active-tab comparison readable.
   */
  const tabs = [
    { path: '/', label: 'Today' },
    { path: '/projects', label: 'Projects' },
    { path: '/brain', label: 'Brain' },
    { path: '/me', label: 'Me' },
    { path: '/settings', label: 'Settings' }
  ];

  /**
   * Inline SVG rather than a font or emoji. Emoji render differently on every
   * platform and can't take the active colour, which is exactly the kind of
   * detail that makes an app feel generic.
   */
  const ICONS: Record<string, string> = {
    '/': 'M12 3.6 3.9 10v10.4h5.6v-6h5v6h5.6V10z',
    '/projects': 'M4 5.5h6.4v6.4H4zm9.6 0H20v6.4h-6.4zM4 15.1h6.4v6.4H4zm9.6 0H20v6.4h-6.4z',
    '/brain': 'M12 2.6 14.3 9l6.5.3-5.1 4 1.8 6.3L12 16l-5.5 3.6L8.3 13l-5.1-4L9.7 9z',
    '/me': 'M12 12.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4M4.4 20.6a7.6 7.6 0 0 1 15.2 0z',
    '/settings':
      'M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2m9 3.6c0 .62-.05 1.2-.14 1.78l2.03 1.5-1.9 3.3-2.38-.9a8.9 8.9 0 0 1-3.06 1.78L15.2 22h-3.8l-.35-2.54a8.9 8.9 0 0 1-3.06-1.78l-2.38.9-1.9-3.3 2.03-1.5A9.6 9.6 0 0 1 5.6 12c0-.62.05-1.2.14-1.78L3.71 8.72l1.9-3.3 2.38.9A8.9 8.9 0 0 1 11.05 4.5L11.4 2h3.8l.35 2.5a8.9 8.9 0 0 1 3.06 1.78l2.38-.9 1.9 3.3-2.03 1.5c.09.58.14 1.16.14 1.82'
  };

  // base is '' at the domain root, so fall back to '/' rather than an empty href.
  const hrefFor = (path: string) => (path === '/' ? base || '/' : base + path);

  let ready = $state(false);
  let storageError = $state<string | null>(null);

  /**
   * IndexedDB can be unavailable — blocked site data, some private-browsing
   * modes, a corrupt database — and when it is, `open` can reject OR hang
   * forever without firing anything. Racing it means the app says what is wrong
   * instead of showing a blank screen, which is the worst possible failure for
   * a store whose entire value is being trustworthy.
   */
  async function openStore(): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Storage did not respond.')), 8000);
    });
    try {
      await Promise.race([openLocalStore(), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  onMount(async () => {
    // Order matters. The OAuth fragment has to be consumed before anything
    // else reads the URL, and the token has to be stored before sync starts.
    // Sign-in is optional, so a failure here must not stop the app booting.
    try {
      await handleRedirect();
    } catch {
      /* ignored — the app works fully signed out */
    }

    try {
      await openStore();
    } catch (err) {
      storageError = (err as Error).message;
      ready = true;
      return;
    }
    ready = true;

    // Folds any leftover inbox captures and list items into Ideas. Runs on
    // every boot rather than once, because a device that has been away will
    // pull down un-migrated rows from another one; it reuses the source ids, so
    // running it everywhere converges instead of duplicating. See migrate.ts.
    try {
      if (await needsMigration()) await migrateToFourKinds();
    } catch {
      /* nothing here is worth failing a boot over */
    }

    // App start is one of the two safe moments to bounce through Google for a
    // fresh token — nothing is half-typed yet. If this redirects, everything
    // below simply runs again on the way back.
    await renewIfSafe();
    stopSync = startSync();

    // Recordings made with no signal are turned into items as soon as there is
    // one. Fire-and-forget: nothing on screen waits for this.
    void processQueue();
    window.addEventListener('online', drainQueue);

    // Registering the service worker is what makes the app boot with no
    // network. Imported dynamically because the virtual module only exists in
    // a real build, and because nothing about it needs to block first paint.
    //
    // It also starts the update watch. An installed home-screen app on iOS is
    // suspended rather than closed, so without this it can go on running a
    // build from weeks ago; see lib/pwa.ts. Still silent — a new build is
    // installed when the app is in the background or coming back to the front,
    // and is never announced.
    const { startUpdateWatch } = await import('$lib/pwa');
    stopUpdates = startUpdateWatch();
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

<div class="shell flex h-dvh bg-ink-950">
  <!--
    The desktop rail. Same four destinations as the phone's tab bar, laid out
    the way a pointer expects them: down the left, labelled, with hover. Hidden
    below 1024px, where the bottom bar takes over.
  -->
  <nav class="hairline-r hidden shrink-0 flex-col px-3 py-4 lg:flex lg:w-[216px]">
    <a href={hrefFor('/')} class="press mb-5 flex items-center gap-2.5 px-2">
      <img src="{base}/favicon.svg" alt="" class="h-8 w-8 rounded-[9px]" />
      <span class="text-[15px] font-semibold tracking-[-0.014em]">FREETIME</span>
    </a>
    {#each tabs as tab (tab.path)}
      {@const on = isActive(tab.path)}
      <a
        href={hrefFor(tab.path)}
        class="press rail-item {on ? 'rail-on' : ''}"
        aria-current={on ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" class="h-[20px] w-[20px] shrink-0" aria-hidden="true">
          <path d={ICONS[tab.path]} fill="currentColor" />
        </svg>
        {tab.label}
      </a>
    {/each}
  </nav>

  <div class="flex min-w-0 flex-1 flex-col">
  <main class="min-h-0 flex-1 overflow-y-auto">
    <div class="page h-full">
    {#if storageError}
      <!-- Explaining beats a blank screen. The app cannot run without local
           storage, so it says so plainly rather than looking broken. -->
      <div class="flex h-full flex-col items-center justify-center px-8 text-center">
        <p class="title-2">This browser won't let the app store anything.</p>
        <p class="footnote mt-3 max-w-sm">
          FREETIME keeps everything on your device, so it needs local storage to work.
          Private browsing or blocked site data will do this. Try a normal window, or
          allow site data for this page.
        </p>
        <p class="footnote mt-4 opacity-60">{storageError}</p>
      </div>
    {:else if ready}
      {@render children()}
    {/if}
    </div>
  </main>

  <!-- The phone's tab bar. Replaced by the rail from 1024px up. -->
  <nav class="glass hairline-t flex shrink-0 pb-safe lg:hidden">
    {#each tabs as tab (tab.path)}
      {@const on = isActive(tab.path)}
      <a
        href={hrefFor(tab.path)}
        class="press tap flex flex-1 flex-col items-center justify-center gap-1 pt-2
               {on ? 'text-accent' : 'text-ink-400'}"
        aria-current={on ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" class="h-[22px] w-[22px]" aria-hidden="true">
          <path d={ICONS[tab.path]} fill="currentColor" />
        </svg>
        <span class="text-[10px] font-medium tracking-[0.01em] whitespace-nowrap">{tab.label}</span>
      </a>
    {/each}
  </nav>
  </div>
</div>
