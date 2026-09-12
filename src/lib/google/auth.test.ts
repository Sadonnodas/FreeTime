import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db';
import { startRenewalWatch, needsSilentRenewal } from './auth';

/**
 * A token lasts an hour and cannot be refreshed without a backend, so the app
 * lives or dies on renewing at the right moments. There were supposed to be
 * two — app start and coming back to the front — and only the first was ever
 * wired, which is why a phone left alone for a day came back signed out. The
 * second one fires no UI and leaves no trace when it works, so nothing but a
 * test can tell whether it is still connected.
 */

const listeners = new Map<string, () => void>();
let assigned: string[] = [];

function stubBrowser(opts: { visible?: boolean; typingIn?: string | null } = {}) {
  const active = opts.typingIn ? { tagName: opts.typingIn, isContentEditable: false } : null;
  vi.stubGlobal('document', {
    visibilityState: opts.visible === false ? 'hidden' : 'visible',
    activeElement: active,
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name)
  });
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k)
  });
  vi.stubGlobal('location', {
    origin: 'https://sadonnodas.github.io',
    pathname: '/FreeTime/',
    search: '',
    assign: (url: string) => assigned.push(url)
  });
}

/** Connected before, and holding a token that ran out an hour ago. */
async function expiredSession() {
  await db.settings.put({
    id: 'settings',
    googleConnected: true,
    googleAccessToken: 'old',
    googleTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString()
  });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  listeners.clear();
  assigned = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('renewing when the app comes back to the front', () => {
  it('goes to Google when a suspended app returns with a dead token', async () => {
    stubBrowser();
    await expiredSession();

    const stop = startRenewalWatch();
    listeners.get('visibilitychange')!();
    await vi.waitFor(() => expect(assigned).toHaveLength(1));

    // Silent: prompt=none never shows the user anything when it works.
    expect(assigned[0]).toContain('prompt=none');
    stop();
  });

  it('does not redirect out from under someone who is typing', async () => {
    stubBrowser({ typingIn: 'TEXTAREA' });
    await expiredSession();

    const stop = startRenewalWatch();
    listeners.get('visibilitychange')!();
    await new Promise((r) => setTimeout(r, 20));
    expect(assigned).toEqual([]);
    stop();
  });

  it('leaves a device that never signed in alone', async () => {
    stubBrowser();
    // No settings row at all: nothing has ever consented here, and a silent
    // renewal for a device Google has never seen can only fail.
    expect(await needsSilentRenewal()).toBe(false);

    const stop = startRenewalWatch();
    listeners.get('visibilitychange')!();
    await new Promise((r) => setTimeout(r, 20));
    expect(assigned).toEqual([]);
    stop();
  });

  it('stops listening when torn down', async () => {
    stubBrowser();
    await expiredSession();
    startRenewalWatch()();
    expect(listeners.has('visibilitychange')).toBe(false);
  });
});
