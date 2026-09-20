import { base } from '$app/paths';

/**
 * Public configuration. Nothing here is a secret.
 *
 * The Google OAuth client ID is public by design — it travels in the URL on
 * every sign-in, and the security of the flow rests on the registered redirect
 * URI, not on hiding this string. So it lives in the repo rather than in
 * Settings: putting it in Settings would mean re-entering it on every device,
 * which is worse for the same amount of safety.
 *
 * The Gemini API key is NOT here. That one is genuinely sensitive-ish, is
 * entered in Settings, and lives only in IndexedDB (spec 2.2).
 */

/**
 * Fill this in after creating an OAuth client (see README, "Google setup").
 * Empty means Google sign-in is simply hidden — the app is fully usable
 * without it.
 */
export const GOOGLE_CLIENT_ID = '496272789427-0lq9nkvi967inpgrff51a7pa2o79gls1.apps.googleusercontent.com';

/**
 * drive.file grants access only to files this app itself created, which keeps
 * the rest of the user's Drive entirely out of scope and avoids Google's
 * verification review. calendar.readonly IS a sensitive scope, so the app
 * stays UNVERIFIED and shows a one-time "unverified app" warning rather than
 * going through review.
 *
 * It is PUBLISHED (external, production) as of September 2026, and was in
 * Testing mode before that. The difference is not cosmetic: Google expires a
 * testing app's grant after seven days whatever the flow, which is what kept
 * demanding a fresh sign-in roughly weekly — see google/auth.ts. Publishing
 * needs a home page and a privacy policy URL, which is why /privacy exists.
 * **If this is ever moved back to Testing, the weekly sign-in comes back with
 * it.**
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

/**
 * Where Google sends the browser back to. Must match a registered redirect URI
 * in the Cloud Console *character for character*, which is why it is derived
 * from the running location rather than hardcoded — otherwise dev and prod
 * would silently disagree.
 */
export function redirectUri(): string {
  return `${location.origin}${base}/`;
}

export const isGoogleConfigured = (): boolean => GOOGLE_CLIENT_ID.length > 0;

/** The folder the app owns in the user's Drive. Visible on purpose. */
export const DRIVE_FOLDER = 'FreeTime';
export const DRIVE_NOTES_FOLDER = 'notes';
/** Voice memos, as real audio files. Playable straight from Drive, and
 *  shareable with someone who has never heard of this app. */
export const DRIVE_MEMOS_FOLDER = 'memos';
