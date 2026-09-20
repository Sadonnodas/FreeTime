import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db';
import {
  startRenewalWatch, needsSilentRenewal, beginSignIn, rememberAccount, renewIfSafe
} from './auth';

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

/**
 * Renewing only AFTER the token died meant the attempt landed the next
 * morning, when Google is least likely to say yes quietly — and if it said no,
 * the app then sat for half an hour before trying again. Both were reported as
 * one thing: *"it's kind of annoying I have to log in every day almost."*
 */
describe('renewing before the hour is up', () => {
  const session = (minutesLeft: number, extra: Record<string, unknown> = {}) =>
    db.settings.put({
      id: 'settings',
      googleConnected: true,
      googleAccessToken: 'live',
      googleTokenExpiresAt: new Date(Date.now() + minutesLeft * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      ...extra
    });

  it('leaves a token with most of its hour left alone', async () => {
    stubBrowser();
    await session(40);
    expect(await needsSilentRenewal()).toBe(false);
  });

  it('renews while the token is still alive but nearly out', async () => {
    stubBrowser();
    await session(5);
    expect(await needsSilentRenewal()).toBe(true);
  });

  it('waits a few minutes after a refusal, not half an hour', async () => {
    stubBrowser();
    await session(5, { lastSilentAuthAt: new Date(Date.now() - 60 * 1000).toISOString() });
    expect(await needsSilentRenewal()).toBe(false);

    await session(5, { lastSilentAuthAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
    expect(await needsSilentRenewal()).toBe(true);
  });
});

/**
 * *"Google wants a fresh sign-in — it would not renew quietly
 * (interaction_required)"*, from a laptop that was signed in to Google at that
 * very moment in the same browser. That combination rules out the session: what
 * is left is that prompt=none means "without showing me anything", and a
 * browser holding two Google accounts cannot pick one without the chooser.
 */
describe('naming the account on a silent renewal', () => {
  const connected = (extra: Record<string, unknown> = {}) =>
    db.settings.put({
      id: 'settings',
      googleConnected: true,
      googleTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      ...extra
    });

  const lastUrl = () => new URL(assigned.at(-1)!);

  it('sends login_hint so Google never needs the account chooser', async () => {
    stubBrowser();
    await connected({ googleAccountId: '11822838' });
    await beginSignIn(true);

    expect(lastUrl().searchParams.get('prompt')).toBe('none');
    expect(lastUrl().searchParams.get('login_hint')).toBe('11822838');
  });

  it('still offers the chooser on a sign-in the user tapped', async () => {
    // The only moment a different account can be picked. Pinning the hint to
    // every trip would quietly make this a one-account app.
    stubBrowser();
    await connected({ googleAccountId: '11822838' });
    await beginSignIn(false);

    expect(lastUrl().searchParams.get('login_hint')).toBeNull();
    expect(lastUrl().searchParams.get('prompt')).toBeNull();
  });

  it('renews exactly as before when no account is known', async () => {
    // Every install that predates this has no id stored, and a failed lookup
    // leaves none. Neither may break renewal — the hint is an optimisation.
    stubBrowser();
    await connected();
    await beginSignIn(true);

    expect(lastUrl().searchParams.has('login_hint')).toBe(false);
    expect(lastUrl().searchParams.get('prompt')).toBe('none');
  });

  it('learns the account on a device that has never stored one', async () => {
    // Every install that predates this. Waiting for the next manual sign-in to
    // learn the id would mean waiting for the exact failure it prevents, so it
    // is picked up at app start while a working token is still in hand.
    stubBrowser();
    await db.settings.put({
      id: 'settings',
      googleConnected: true,
      googleAccessToken: 'live',
      googleTokenExpiresAt: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString()
    });
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ sub: '11822838' }) }));

    await renewIfSafe();

    expect((await db.settings.get('settings'))?.googleAccountId).toBe('11822838');
    // And a token with most of its hour left is still left alone.
    expect(assigned).toHaveLength(0);
  });

  it('remembers the account from a token, and swallows a lookup that fails', async () => {
    stubBrowser();
    await connected();

    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ sub: '11822838' }) }));
    await rememberAccount('live-token');
    expect((await db.settings.get('settings'))?.googleAccountId).toBe('11822838');

    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    await rememberAccount('live-token');
    // Unchanged rather than cleared: a lookup that could not run says nothing
    // about which account this is.
    expect((await db.settings.get('settings'))?.googleAccountId).toBe('11822838');
  });
});
