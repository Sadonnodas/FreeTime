import { browser } from '$app/environment';

/**
 * Light and dark.
 *
 * The whole theme is eight ink values and five surface tokens, redefined in
 * app.css under `[data-theme='light']`. This file's only job is deciding which
 * of them applies and writing one attribute.
 *
 * ON SWITCHING BY TIME OF DAY. macOS and iOS already do this, properly: their
 * Automatic mode uses real sunrise and sunset for wherever you are, and it
 * changes on the day you travel. `system` inherits all of that for free. A
 * schedule built in here would be a worse copy of something the phone is
 * already doing — it would need the location it is not allowed to ask for, and
 * it would disagree with every other app on the device. So there are three
 * choices, not four, and "follows your Mac" is the one that gives you sunset.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Kept in localStorage, not the database: it is a per-device preference, and
 *  syncing it would make a laptop at midnight darken a phone at noon. */
const KEY = 'freetime.theme';

export const THEME_LABELS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

export function getTheme(): ThemeChoice {
  if (!browser) return 'system';
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    // Blocked site data. Not worth failing over — the app just follows the OS.
    return 'system';
  }
}

/** What is actually on screen right now, once `system` has been resolved. */
export function resolved(choice: ThemeChoice = getTheme()): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  if (!browser) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * `system` removes the attribute rather than writing the resolved value, so the
 * CSS media query stays in charge and the app follows the OS live — including
 * at sunset, without anything here waking up to notice.
 */
export function applyTheme(choice: ThemeChoice = getTheme()): void {
  if (!browser) return;
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  // The browser chrome around the page, so a light app does not sit under a
  // near-black address bar. Read back from the computed styles rather than
  // duplicated here, so it can never drift from the palette.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--color-ink-950').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}

export function setTheme(choice: ThemeChoice): void {
  if (browser) {
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* the choice still applies for this session */
    }
  }
  applyTheme(choice);
}

/**
 * Keeps `system` honest while the app is open — the OS can flip underneath us
 * at sunset, and without this the app would only notice on the next reload.
 */
export function startThemeWatch(): () => void {
  if (!browser) return () => {};
  applyTheme();

  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    if (getTheme() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
