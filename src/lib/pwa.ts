import { registerSW } from 'virtual:pwa-register';
import { base } from '$app/paths';

/**
 * Keeping an installed home-screen app up to date.
 *
 * THE PROBLEM. A PWA on an iPhone home screen is not a page you reload. iOS
 * suspends the web view rather than closing it, so tapping the icon often
 * resumes exactly where you were — days-old code included. The service worker
 * only looks for a new build when the page loads, and that load may never come.
 * The result is an app that silently runs a version from last month while the
 * deploy that fixed something sits on GitHub Pages, already live, unreachable.
 *
 * THE FIX, in three parts:
 *  1. Ask the service worker to check for a new build on a timer, and every
 *     time the app comes back to the foreground.
 *  2. Install what it finds at a moment that cannot cost anything — when the
 *     app is returning to the foreground, never while it is being used.
 *  3. Give the user a button, because "is this the new one?" deserves a real
 *     answer rather than faith.
 *
 * The reload is the part to be careful with. vite-plugin-pwa's 'autoUpdate'
 * mode reloads the moment a new worker takes control, which was harmless when
 * updates were only ever discovered during startup — and would not be once we
 * start checking every half hour. A reload landing mid-sentence would throw
 * away whatever was in the capture box. So this uses 'prompt' registration and
 * chooses the moment itself; nothing here ever prompts.
 */

/** Baked in at build time; see `define` in vite.config.ts. */
export const BUILD_TIME: string = __APP_VERSION__;

/** How often to ask, while the app is actually in front. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'ready'
  | 'updating'
  | 'failed';

let status: UpdateStatus = 'idle';
const listeners = new Set<(s: UpdateStatus) => void>();

export function onUpdateStatus(fn: (s: UpdateStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function setStatus(next: UpdateStatus) {
  status = next;
  for (const fn of listeners) fn(next);
}

let registration: ServiceWorkerRegistration | undefined;
let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined;
/** Set when the service worker itself reports a build waiting to take over. */
let workerWaiting = false;

/**
 * Re-read the registration instead of trusting the handle from startup.
 *
 * A registration can disappear underneath us — Safari evicts service workers
 * for sites left alone for about a week, and a browser can drop one for its own
 * reasons. The stale handle keeps answering `update()` without complaint, so
 * the app would go on reporting "this is the latest version" from a page that
 * has no way left to get a new one. Caught exactly that way in testing.
 */
async function liveRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  try {
    registration = (await navigator.serviceWorker.getRegistration()) ?? undefined;
  } catch {
    /* keep whatever we had; a throw here says nothing about the registration */
  }
  return registration;
}

/**
 * Ask the server directly whether it is serving a different build.
 *
 * This is the belt to the service worker's braces, and it exists because the
 * two can fail in the same breath: if the worker is gone, the only thing left
 * telling the app which build to run is the HTTP cache, and GitHub Pages serves
 * index.html with a TTL. A page can then sit on last week's bundle with nothing
 * in a position to notice.
 *
 * Comparing the entry chunk's hashed filename needs no version endpoint and
 * cannot be fooled by a cached response, because the fetch bypasses the cache.
 */
function loadedEntryScript(): string | null {
  const urls = [...document.querySelectorAll('script[src], link[rel="modulepreload"][href]')]
    .map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
    .filter((u) => u.includes('/immutable/entry/app.'));
  const first = urls[0];
  return first ? (first.split('/').pop() ?? null) : null;
}

async function servedEntryScript(): Promise<string | null> {
  const res = await fetch(`${base}/`, { cache: 'no-store' });
  const html = await res.text();
  const match = html.match(/immutable\/entry\/app\.[A-Za-z0-9_-]+\.js/);
  return match ? (match[0].split('/').pop() ?? null) : null;
}

/** Throws if the server cannot be reached, so the caller can say "don't know"
 *  rather than "up to date". */
async function servedBuildDiffers(): Promise<boolean> {
  const mine = loadedEntryScript();
  if (!mine) return false; // Cannot tell. Never guess in the direction of alarm.
  const theirs = await servedEntryScript();
  if (!theirs) return false;
  return mine !== theirs;
}

/**
 * When the app started. A build discovered in the first few seconds is a build
 * discovered at launch, and launch is a safe moment by definition — nothing has
 * been typed yet. This is what preserves the old behaviour of swapping in a new
 * version on open, now that the plugin no longer does it for us.
 */
let startedAt = 0;
const LAUNCH_GRACE_MS = 6000;

/**
 * True while the app is hidden. Used to tell "coming back to the app" apart
 * from "still using the app", which is the whole basis for deciding when a
 * reload is safe.
 */
let wasHidden = false;

/** Installs the waiting build and reloads. Only called when nothing is at stake. */
async function apply(): Promise<void> {
  if (status !== 'ready') return;
  setStatus('updating');

  if (workerWaiting && applyUpdate) {
    // The good path: the new build is already downloaded and sitting in the
    // worker, so this is a swap rather than a fetch.
    await applyUpdate(true);
    return;
  }

  // No worker to hand over from — the server simply has something newer. A
  // reload revalidates and picks it up.
  location.reload();
}

/**
 * Wait for a worker that is mid-install to finish.
 *
 * `registration.update()` resolves as soon as the new script has been fetched,
 * NOT once it has installed — so without this, a check would report "this is
 * the latest version" a second before the update it just found announced
 * itself. The button would be lying, briefly but visibly.
 */
function settle(r: ServiceWorkerRegistration): Promise<void> {
  if (r.waiting) return Promise.resolve();
  const installing = r.installing;
  if (!installing) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const done = () => resolve();
    installing.addEventListener('statechange', () => {
      if (installing.state !== 'installing') done();
    });
    // A worker that never settles must not leave the button spinning forever.
    setTimeout(done, 10_000);
  });
}

export async function checkForUpdates(): Promise<void> {
  // An update already found and waiting must not be reported as "up to date".
  if (status === 'ready') return;

  setStatus('checking');

  // Asking the server is the check that always works, worker or no worker.
  try {
    if (await servedBuildDiffers()) {
      setStatus('ready');
      return;
    }
  } catch {
    setStatus('failed');
    return;
  }

  const r = await liveRegistration();
  if (!r) {
    // No worker, but the build comparison above did run and found nothing, so
    // this is genuinely current — just without offline support.
    setStatus('current');
    return;
  }

  try {
    await r.update();
    await settle(r);
  } catch {
    /*
     * A check that could not run is NOT a check that found nothing.
     *
     * Swallowing this and saying "this is the latest version" would be a
     * confident lie in the case most likely to happen: tapping the button on a
     * train with no signal. The whole reason this button exists is that an
     * installed app gives you no other way to tell, so it has to be honest
     * about not knowing.
     */
    if (status === 'checking') setStatus('failed');
    return;
  }
  // onNeedRefresh flips this to 'ready' if there was something. Nothing
  // arriving means this really is the current build.
  if (status === 'checking') setStatus('current');
}

/** The button in Settings: check, and install straight away if there is one. */
export async function checkAndApply(): Promise<void> {
  await checkForUpdates();
  // A deliberate tap on "check for updates" IS the safe moment — they are
  // looking at a settings screen, not part-way through capturing a thought.
  if (status === 'ready') await apply();
}

export function startUpdateWatch(): () => void {
  startedAt = Date.now();
  applyUpdate = registerSW({
    immediate: true,
    onRegisteredSW(_url, r) {
      registration = r;
      // Fires on load too, which is what catches the ordinary case of the app
      // having been closed properly.
      void checkForUpdates();
    },
    onNeedRefresh() {
      workerWaiting = true;
      setStatus('ready');
      // Two safe moments to take it right now: the app is in the background,
      // where nothing can be lost, or it has only just launched, where nothing
      // has been typed yet.
      const atLaunch = Date.now() - startedAt < LAUNCH_GRACE_MS;
      if (document.visibilityState === 'hidden' || atLaunch) void apply();
    },
    onRegisterError() {
      // Deliberately nothing. A worker that will not register costs offline
      // support, not update checking — checkForUpdates asks the server itself.
    }
  });

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      wasHidden = true;
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;

    // Returning to the app. If a build is already waiting, this is the cheapest
    // possible moment to swap to it — the screen is about to be redrawn anyway.
    if (status === 'ready') {
      void apply();
      return;
    }
    void checkForUpdates();
  };

  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void checkForUpdates();
  }, CHECK_EVERY_MS);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
  };
}

/** "30 Aug 2026, 14:52" — what the Settings screen shows. */
export function buildLabel(iso: string = BUILD_TIME): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
