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

/** Guards against a redirect loop if silent renewal keeps failing. */
const SILENT_BACKOFF_MS = 30 * 60 * 1000;
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
 */
export function beginSignIn(silent = false): void {
  if (!isGoogleConfigured()) return;

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
  if (silent) params.set('prompt', 'none');

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
    if (wasSilent) await patch({ lastSilentAuthAt: now() });
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
    lastAuthError: undefined
  });

  return { handled: true, ok: true };
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

/** True when we hold no valid token but the user has consented before — the
 *  only situation where a silent redirect is appropriate. */
export async function needsSilentRenewal(): Promise<boolean> {
  if (!isGoogleConfigured()) return false;
  const s = await settings();
  if (!s?.googleConnected) return false;
  if (await getAccessToken()) return false;

  const last = s.lastSilentAuthAt ? new Date(s.lastSilentAuthAt).getTime() : 0;
  return Date.now() - last > SILENT_BACKOFF_MS;
}

/**
 * Renews at a safe moment: app start, or returning to a backgrounded app.
 * Never mid-interaction — a redirect while someone is typing would throw away
 * what they were doing, and no sync is worth that.
 */
export async function renewIfSafe(): Promise<void> {
  if (await needsSilentRenewal()) beginSignIn(true);
}

/** Forgets the token locally. Does not revoke — the user can do that from
 *  their Google account page, and pretending otherwise would be a lie. */
export async function signOut(): Promise<void> {
  await patch({
    googleAccessToken: undefined,
    googleTokenExpiresAt: undefined,
    googleGrantedScopes: undefined,
    googleConnected: false
  });
}
