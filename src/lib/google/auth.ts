import { db } from '../db';
import type { Settings } from '../types';
import { now } from '../store';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, redirectUri, isGoogleConfigured } from '../config';

/**
 * Google sign-in, by full-page redirect.
 *
 * WHY THIS SHAPE. The spec (2.1) called for PKCE with a public client and a
 * stored refresh token. Google does not support that combination for a static
 * site: the implicit flow issues no refresh token at all, and the authorization
 * code flow requires a client_secret at the token endpoint for "Web
 * application" clients — which a page served from GitHub Pages cannot hold
 * without publishing it. Adding a tiny backend just to hold that secret was the
 * alternative, and was rejected to keep "no backend" true.
 *
 * So: response_type=token, one hour, no refresh token. Renewal is another
 * full-page redirect with prompt=none, which returns immediately and with no UI
 * while the user's Google session is alive.
 *
 * Redirect and not a popup, per the spec — popups break out of iOS standalone
 * PWA mode and lose the session. The cost of a redirect is that the page
 * reloads, which is survivable precisely because the app is local-first: every
 * byte of state is already in IndexedDB before we leave.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Says which account a token belongs to, without asking for a single extra
 *  scope — see `rememberAccount`. */
const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * Guards against a redirect loop if silent renewal keeps failing. Five
 * minutes, not thirty: a prompt=none round trip is invisible and costs one
 * page load, and half an hour of not trying is how a morning's first open
 * ends in a manual sign-in that a retry might have avoided.
 */
const SILENT_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Renew BEFORE the hour is up, not after it has run out.
 *
 * Renewal only works while Google still considers this browser signed in, and
 * the app used to wait until the token was already dead — which on a phone is
 * the next morning, the worst possible moment to ask. Trying while the app is
 * open and the token has ten minutes left costs nothing when it works, and
 * when it fails there is still a working token in hand.
 */
const RENEW_AHEAD_MS = 10 * 60 * 1000;
const STATE_KEY = 'freetime.oauth.state';
const SILENT_KEY = 'freetime.oauth.silent';
/** Where to send the user back after the round trip. */
const RETURN_KEY = 'freetime.oauth.return';

/** Tokens are treated as expired a minute early, so a sync can't start with
 *  90 seconds left and die halfway through. */
const EXPIRY_MARGIN_MS = 60 * 1000;

async function settings(): Promise<Settings | undefined> {
  return db.settings.get('settings');
}

async function patch(fields: Partial<Settings>): Promise<void> {
  const existing = await settings();
  const t = now();
  if (existing) {
    await db.settings.update('settings', { ...fields, updatedAt: t });
  } else {
    await db.settings.add({ id: 'settings', ...fields, updatedAt: t });
  }
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sends the browser to Google.
 *
 * `silent` uses prompt=none: Google either returns a token straight away or
 * fails with an error, and never shows the user anything. Non-silent shows the
 * consent screen, and is only ever triggered by an explicit tap.
 *
 * A SILENT ATTEMPT IS STAMPED BEFORE WE LEAVE, not when it comes back failed.
 * The backoff used to be armed in handleRedirect, which assumes Google always
 * returns here with an error in the fragment. It does not: redirect_uri_mismatch
 * renders Google's own error PAGE and never redirects at all, so nothing was
 * ever recorded, the backoff never engaged, and the app bounced to Google on
 * every single launch with no way back. Observed in dev, where the port is not
 * a registered redirect URI — but any error Google chooses to render as a page
 * would wedge a real install exactly the same way. Recording the attempt costs
 * one write and cannot miss; handleRedirect clears it on success.
 */
export async function beginSignIn(silent = false): Promise<void> {
  if (!isGoogleConfigured()) return;

  if (silent) await patch({ lastSilentAuthAt: now() });

  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(SILENT_KEY, silent ? '1' : '');
  sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: GOOGLE_SCOPES,
    state,
    // Keeps any scope the user granted previously, so adding Calendar later
    // does not silently drop Drive access.
    include_granted_scopes: 'true'
  });
  if (silent) {
    params.set('prompt', 'none');
    /*
     * WHICH ACCOUNT, and this is the whole reason a laptop could not renew.
     *
     * prompt=none means "do it without showing me anything". A browser signed
     * in to more than one Google account cannot answer that question on its
     * own — it would have to show the account chooser, which is interaction,
     * so Google refuses with `interaction_required`. Reported from a laptop
     * that was demonstrably signed in to Google at the time, which is what
     * ruled out every session-related cause.
     *
     * Naming the account removes the question. Only on a SILENT attempt: a
     * sign-in the user actually tapped should still offer the chooser, since
     * that is the only moment they can pick a different account.
     */
    const hint = (await settings())?.googleAccountId;
    if (hint) params.set('login_hint', hint);
  }

  location.assign(`${AUTH_ENDPOINT}?${params}`);
}

export interface RedirectOutcome {
  handled: boolean;
  ok: boolean;
  /** Google's error code, e.g. login_required / interaction_required. */
  error?: string;
}

/**
 * Call once on app load. Reads the token out of the URL fragment, checks the
 * state parameter, stores the token and scrubs the URL so the access token is
 * not left sitting in the address bar or in history.
 */
export async function handleRedirect(): Promise<RedirectOutcome> {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const wasSilent = sessionStorage.getItem(SILENT_KEY) === '1';

  if (!raw) {
    // A silent attempt that comes back with no fragment at all still counts as
    // finished, or the next load would try again immediately.
    if (wasSilent) sessionStorage.removeItem(SILENT_KEY);
    return { handled: false, ok: false };
  }

  const params = new URLSearchParams(raw);
  const hasAuthFields = params.has('access_token') || params.has('error');
  if (!hasAuthFields) return { handled: false, ok: false };

  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(SILENT_KEY);

  const cleanUrl = sessionStorage.getItem(RETURN_KEY) ?? location.pathname;
  sessionStorage.removeItem(RETURN_KEY);
  history.replaceState(null, '', cleanUrl);

  const error = params.get('error');
  if (error) {
    // prompt=none failing is entirely normal — it just means Google wants the
    // user to look at something, so it is not worth reporting. An error from a
    // sign-in the user actually tapped is worth showing verbatim.
    if (wasSilent) await patch({ lastSilentAuthAt: now(), lastSilentError: error });
    else await patch({ lastAuthError: error });
    return { handled: true, ok: false, error };
  }

  // A mismatched state means this fragment did not come from a flow we started.
  if (!expectedState || params.get('state') !== expectedState) {
    return { handled: true, ok: false, error: 'state_mismatch' };
  }

  const token = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') ?? '3600');
  if (!token) return { handled: true, ok: false, error: 'no_token' };

  await patch({
    googleAccessToken: token,
    googleTokenExpiresAt: new Date(Date.now() + expiresIn * 1000 - EXPIRY_MARGIN_MS).toISOString(),
    googleGrantedScopes: params.get('scope') ?? undefined,
    googleConnected: true,
    lastSilentAuthAt: undefined,
    lastSilentError: undefined,
    lastAuthError: undefined
  });

  // Not awaited: the app is already usable and this only matters an hour from
  // now. Re-read on every success, so switching account corrects it.
  void rememberAccount(token);

  return { handled: true, ok: true };
}

/**
 * Asks Google which account a token belongs to, and keeps the answer for the
 * next silent renewal's `login_hint`.
 *
 * `tokeninfo` needs no scope of its own and returns `sub`, the stable id for
 * the signed-in user — which is what `login_hint` takes, an email address or a
 * sub. Asking for the `email` scope instead would mean a fresh consent screen
 * for every existing install, to learn something we do not otherwise want.
 *
 * FAILING HERE COSTS NOTHING: with no hint stored, a renewal is exactly what
 * it was before. So it is one fetch, swallowed whole, and never in the way of
 * a sign-in completing.
 */
export async function rememberAccount(token: string): Promise<void> {
  try {
    if (typeof fetch !== 'function') return;
    const res = await fetch(`${TOKENINFO_ENDPOINT}?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return;
    const info = (await res.json()) as { sub?: string; email?: string };
    // The email reads better in a log and works identically as a hint, but it
    // is only present when the email scope was granted; sub always is.
    const id = info.sub || info.email;
    if (id) await patch({ googleAccountId: id });
  } catch {
    // Offline, blocked, or a shape we did not expect. The hint is an
    // optimisation and the flow has to work without it.
  }
}

/** A usable token, or null. Never triggers a redirect on its own — navigating
 *  away has to be a decision the caller makes at a safe moment. */
export async function getAccessToken(): Promise<string | null> {
  const s = await settings();
  if (!s?.googleAccessToken || !s.googleTokenExpiresAt) return null;
  if (new Date(s.googleTokenExpiresAt).getTime() <= Date.now()) return null;
  return s.googleAccessToken;
}

export async function isConnected(): Promise<boolean> {
  const s = await settings();
  return !!s?.googleConnected;
}

/**
 * True when the token is gone or nearly gone and the user has consented
 * before — the only situation where a silent redirect is appropriate.
 */
export async function needsSilentRenewal(): Promise<boolean> {
  if (!isGoogleConfigured()) return false;
  const s = await settings();
  if (!s?.googleConnected) return false;
  const expires = s.googleTokenExpiresAt ? new Date(s.googleTokenExpiresAt).getTime() : 0;
  if (s.googleAccessToken && expires - Date.now() > RENEW_AHEAD_MS) return false;

  const last = s.lastSilentAuthAt ? new Date(s.lastSilentAuthAt).getTime() : 0;
  return Date.now() - last > SILENT_BACKOFF_MS;
}

/**
 * Renews at a safe moment: app start, or returning to a backgrounded app.
 * Never mid-interaction — a redirect while someone is typing would throw away
 * what they were doing, and no sync is worth that.
 */
export async function renewIfSafe(): Promise<void> {
  // Learn the account while there is still a live token to ask with. Every
  // install that predates login_hint has none stored, and waiting for the next
  // manual sign-in to learn it would mean waiting for exactly the failure the
  // hint exists to prevent. Costs one request, once per device.
  const s = await settings();
  if (s?.googleConnected && !s.googleAccountId) {
    const token = await getAccessToken();
    if (token) await rememberAccount(token);
  }
  if (await needsSilentRenewal()) await beginSignIn(true);
}

/**
 * The SECOND safe moment, which this file described for months and nobody
 * wired up.
 *
 * `renewIfSafe` was called once, from the layout's onMount — a COLD LAUNCH. An
 * installed app on iOS is suspended rather than closed, so a phone picked up
 * the next morning never runs onMount again: it comes back holding an hour-old
 * token, sync pauses on `no-token`, and nothing ever tries to renew. Reported
 * exactly that way — *"if I don't interact for a day it logs out"*. The
 * calendar cache and the theme both learned this same lesson; a device that
 * has been asleep has to be told to look again.
 *
 * A renewal is a full-page redirect, so it is refused while a field has focus.
 * prompt=none comes straight back, but "straight back" is still a page load,
 * and losing a half-written capture to a token refresh would be a far worse
 * bug than the one this fixes. When it is refused, nothing is lost: the app
 * keeps working offline and the reconnect notice offers the trip explicitly.
 */
export function startRenewalWatch(): () => void {
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (isTyping()) return;
    void renewIfSafe();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Forgets the token locally. Does not revoke — the user can do that from
 *  their Google account page, and pretending otherwise would be a lie. */
export async function signOut(): Promise<void> {
  await patch({
    googleAccessToken: undefined,
    googleTokenExpiresAt: undefined,
    googleGrantedScopes: undefined,
    googleConnected: false,
    // Forgotten too, or signing back in as somebody else would be silently
    // renewed against the account that was left.
    googleAccountId: undefined
  });
}
