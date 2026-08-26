# FREETIME

A personal life-organizer PWA. Single user, local-first, no backend.

The full design rationale lives in [freetime-spec.md](freetime-spec.md) — that document is
the source of truth. This file covers how the code is put together and how to run it.

---

## What exists today

Phases 1 through 4 of the eight-phase plan in spec §10, plus the data foundations for
the rest.

| Working | Where |
| --- | --- |
| Capture box — one field, Enter, done | [CaptureBox.svelte](src/lib/components/CaptureBox.svelte) |
| Today screen with the three + the unlock rule | [routes/+page.svelte](src/routes/+page.svelte) |
| Projects grid with pulse (no progress bars) | [routes/projects/+page.svelte](src/routes/projects/+page.svelte) |
| Project detail — Notes / To-dos / Buy | [routes/projects/[id]/+page.svelte](src/routes/projects/%5Bid%5D/+page.svelte) |
| Brain — inbox, all to-dos, ideas, lists, buy | [routes/brain/+page.svelte](src/routes/brain/+page.svelte) |
| Me — habits, wins history | [routes/me/+page.svelte](src/routes/me/+page.svelte) |
| Free Time flow — questions, slot rules, reshuffle | [FreeTime.svelte](src/lib/components/FreeTime.svelte), [freetime.ts](src/lib/freetime.ts) |
| Day-close screen | [DayClose.svelte](src/lib/components/DayClose.svelte) |
| Full schema for every record type in spec §3 | [db.ts](src/lib/db.ts), [types.ts](src/lib/types.ts) |
| Installable, offline-capable PWA | [vite.config.ts](vite.config.ts) |
| Google Drive sync, per-record merge | [sync.ts](src/lib/sync.ts), [merge.ts](src/lib/merge.ts) |
| Google sign-in by redirect | [google/auth.ts](src/lib/google/auth.ts) |
| Voice capture — record, transcribe, review | [VoiceCapture.svelte](src/lib/components/VoiceCapture.svelte), [audio.ts](src/lib/audio.ts) |
| Assistant with confirm-before-write | [Assistant.svelte](src/lib/components/Assistant.svelte), [gemini/tools.ts](src/lib/gemini/tools.ts) |
| AI questions + slot ranking, with fallback | [gemini/plan.ts](src/lib/gemini/plan.ts) |

Not built yet, in the spec's order: habit cycle history and heatmap (5), monthly summary
(6), list detail screens (7), Calendar (8), and the Notion importer.

Sync is written but dormant until you add an OAuth client ID — see **Google setup**
below. Without one, sign-in is hidden and everything else works exactly as before.

The Free Time flow runs entirely on local rules. Phase 4 adds Gemini ranking *on top of*
it, never in place of it — the spec requires a working non-AI path for every AI feature,
so these rules stay the path most runs take.

---

## Running it

```bash
npm install
npm run dev      # http://localhost:5173/FreeTime
npm run build    # static site into build/
npm run preview  # serve build/ locally
npm run check    # svelte-check, TypeScript strict
npm test         # vitest, against a real Dexie store via fake-indexeddb
```

Everything runs with no network, no accounts, and no keys. That is the point — the AI
is an accelerant, never a dependency (spec §7.4).

---

## How it fits together

**SvelteKit with `adapter-static`.** The whole app compiles to plain HTML/JS/CSS. There
is no server at runtime; GitHub Pages just serves files. A `fallback` page makes it a
single-page app, so a hard refresh on `/brain` still boots — see the base-path notes
under Deployment for why that file is named `404.html`.

**IndexedDB via Dexie is the single source of truth.** Every read and write in the app
hits [`db`](src/lib/db.ts) and nothing else, so writes return instantly and there is
never a spinner. Drive sync (phase 3) will reconcile into it in the background — behind
it, never in front of it.

**Dexie's `liveQuery`** re-runs a query whenever a table it touched changes and returns
an Observable. Svelte's `$` prefix subscribes to anything with `.subscribe()`, so
`$todosQ` in a component stays current with zero manual refresh — including for writes
made in another tab.

**Writes are separated from reads.** [store.ts](src/lib/store.ts) is the only place that
mutates; [queries.ts](src/lib/queries.ts) only reads. When the Gemini assistant lands in
phase 4, its function calls go through `store.ts` too, so AI writes queue offline and
sync exactly like manual ones.

**Nothing is hard-deleted.** `deletedAt` is a tombstone. Without it, a delete on the
phone would be silently undone by the next sync from the laptop.

**`updatedAt` is the sync tiebreaker** (spec §8.3, per-record last-write-wins). Every
write bumps it.

### Rules enforced in data, not just UI

Two of the spec's principles are load-bearing enough that a UI-only implementation would
be one refactor away from being lost, so they live in the model:

- **The unlock rule** ([day.ts](src/lib/day.ts)). A fourth item is not discouraged, it is
  impossible: `addToDay` throws once `slots.length` hits `unlockedCount`, and
  `unlockedCount` only grows *after* the day is already closed. Three planned with a
  fourth earned means finishing three is 100%; four planned means it is 75%. Same work,
  opposite feeling.
- **The assistant never writes silently** ([gemini/tools.ts](src/lib/gemini/tools.ts)).
  Reads run immediately; writes come back as proposals and land only when tapped. A test
  asserts every declared tool is deliberately classified, because a write misfiled as a
  read would execute unnoticed and nothing else would catch it.
- **Model output is validated, not trusted** ([gemini/plan.ts](src/lib/gemini/plan.ts)).
  An unknown id, a duplicate, or an "obligation" with no date throws the whole response
  away and the deterministic path runs instead.
- **Slot selection is a deterministic filter** ([freetime.ts](src/lib/freetime.ts)). The
  app narrows the candidate pool by energy and time in plain code; the model, when it
  arrives, only ranks what survives. It never reaches into the whole database.
- **Wins are derived, never logged** ([queries.ts](src/lib/queries.ts) `winsSince`). There
  is no wins table. The feed is computed from `completedAt` on to-dos and `state: 'done'`
  on list items — work the user did for other reasons. Asking them to log wins is exactly
  what left the old habit tracker with 216 rows and 4 check-ins.

### Things deliberately absent

No priority field. No streaks. No progress bars or completion percentages. No "overdue"
state, red badge, or notification. No weekly planning view. No analytics. Spec §11 lists
these as out of scope — they are not missing features.

---

## Deployment

Live at **https://sadonnodas.github.io/FreeTime/**

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which builds and publishes to GitHub Pages.

**One-time setup:** in *Settings > Pages > Build and deployment*, Source must be set to
**GitHub Actions**. The workflow cannot do this for you — creating a Pages site needs
admin rights the built-in `GITHUB_TOKEN` does not have. Left on the default "Deploy from
a branch", Pages ignores the workflow and runs Jekyll over the repo root instead, which
publishes this README as a web page rather than the app.

### The base path

This is a **project repo**, so Pages serves it from `/FreeTime/` rather than the domain
root. The spec (§1) originally called for a user repo (`Sadonnodas.github.io`) precisely
to avoid this; going the other way costs three pieces of config, all of which are in
place:

1. `kit.paths.base = '/FreeTime'` in [svelte.config.js](svelte.config.js). Every internal
   link imports `base` from `$app/paths` and prefixes with it — a bare `href="/projects"`
   would leave the app and hit GitHub's own 404.
2. The SPA fallback is named **`404.html`**, not `200.html`. GitHub Pages serves
   `404.html` for unknown paths and cannot be told to use anything else, so that is the
   only filename the trick works with. SvelteKit writes absolute asset URLs into it,
   which matters because Pages serves it at any depth.
3. The PWA `scope`, `start_url`, and icon paths in [vite.config.ts](vite.config.ts) all
   carry the prefix. Manifest paths resolve against the origin, not the manifest's own
   location, so they need it spelled out or the app installs pointing at nothing.

`npm run dev` applies the base too — it serves at `localhost:5173/FreeTime`. That is
deliberate: dev and prod resolving URLs differently is how a broken link ships unnoticed.

**To move to a user repo later**, set `BASE = ''` in both svelte.config.js and
vite.config.ts. Everything else follows automatically.

## The audio pipeline

Worth knowing, because the spec's version does not work as written.

Spec §7.2 says `MediaRecorder` → blob → Gemini inline audio. But Gemini accepts
**wav, mp3, aiff, aac, ogg and flac — not webm**, and webm/opus is exactly what Chrome's
`MediaRecorder` produces, while Safari produces mp4/aac. Sending the raw blob would work
on one device and fail on the other.

So [audio.ts](src/lib/audio.ts) decodes the recording with the browser's own decoder —
which by definition understands its own output — and re-encodes to **16 kHz mono WAV**.
That is explicitly supported, needs no library (a WAV is a 44-byte header followed by
samples), is what speech models want anyway, and is roughly 6× smaller than 48 kHz
stereo. Size matters because inline data is base64, which adds another third.

Recording stops hard at ten minutes, before the payload outgrows what can be sent inline.

**Nothing is lost offline.** The WAV is written to IndexedDB before any network call, and
a failure *after* recording re-queues rather than discarding. The queue drains on the
next `online` event.

## Google setup

Sync stays off until `GOOGLE_CLIENT_ID` in [src/lib/config.ts](src/lib/config.ts) is
filled in. One-time, about ten minutes:

1. **Create a project.** [console.cloud.google.com](https://console.cloud.google.com) →
   project dropdown → *New Project* → name it `FreeTime`.
2. **Enable two APIs.** *APIs & Services → Library*, then enable **Google Drive API** and
   **Google Calendar API**.
3. **Configure the consent screen.** *APIs & Services → OAuth consent screen* → **External**.
   Fill in the app name and your email. **Leave it in Testing** — do not publish. Under
   *Test users*, add your own Google account.
   Testing mode is deliberate (spec §2.1): `calendar.readonly` is a sensitive scope, and
   staying in Testing skips Google's verification review entirely. The price is a one-time
   "Google hasn't verified this app" warning, which you click through via *Advanced*.
4. **Create the client.** *Credentials → Create credentials → OAuth client ID →*
   **Web application**.
   - *Authorised JavaScript origins*: `https://sadonnodas.github.io` and
     `http://localhost:5173`
   - *Authorised redirect URIs*: `https://sadonnodas.github.io/FreeTime/` and
     `http://localhost:5173/FreeTime/`
   The trailing slash matters. Google matches redirect URIs character for character.
5. **Paste the client ID** into `GOOGLE_CLIENT_ID` in
   [src/lib/config.ts](src/lib/config.ts), commit, push. It is public by design — it
   travels in the URL on every sign-in, and the flow's safety rests on the registered
   redirect URI, not on hiding this string. Ignore the client *secret*; nothing here uses it.

Then open the app → *Me → Settings → Connect Google*.

### How sign-in actually works, and why

The spec (§2.1) asked for PKCE with a public client and a stored refresh token. **Google
does not support that for a static site**, which its own discovery document confirms:
`token_endpoint_auth_methods_supported` lists only `client_secret_post` and
`client_secret_basic` — there is no `none`, so a client with no secret cannot use the
token endpoint at all. No token endpoint means no refresh token.

So sign-in uses `response_type=token` (still advertised in
`response_types_supported`) via a **full-page redirect**, never a popup — popups break out
of iOS standalone PWA mode and lose the session.

The consequence: **the token lasts one hour and there is no refresh token.** Renewal is
another redirect with `prompt=none`, which returns instantly and shows nothing while your
Google session is alive. That happens at app start only — never mid-interaction, because a
redirect while you are typing would throw away what you were doing. If the hour runs out
while the app is open, sync simply pauses; every write keeps working locally and catches
up on the next open.

If you ever want genuinely uninterrupted sync, the only way is a ~30-line backend
(Cloudflare Worker) holding the client secret to do the token exchange and refresh. That
would break "No backend" from §1, so it was not built. Your data would still never pass
through it — only tokens.

### If sign-in is refused

Settings shows Google's error verbatim. The two worth knowing:

- `redirect_uri_mismatch` — the registered URI does not match exactly. Settings prints the
  one it is actually sending.
- `unsupported_response_type` / `invalid_request` — the client will not permit the implicit
  flow. Google deprecated it for new integrations, and the authorization server still
  advertises it, but per-client policy could differ. If this happens, the token-backend
  route above is the fallback.

## Secrets

There are none in this repo, and there must never be any.

- The **Gemini API key** is pasted into Settings by the user and stored in IndexedDB. It
  is visible in their own browser's network tab, which is acceptable for a single-user
  app on their own device. Restrict it by HTTP referrer to the Pages origin in Google
  Cloud Console.
- **Google OAuth** uses no secret at all — see *Google setup* above. The access token it
  does hold is short-lived and lives only in IndexedDB.
- The **OAuth client ID** in `config.ts` is public by design and is not a secret.

Nothing is read from `.env` at build time.

## Icons

`static/icons/*.png` are generated placeholders — a dark tile with an accent ring — made
by [scripts/make-icons.mjs](scripts/make-icons.mjs) (a dependency-free PNG writer). Drop
real artwork in with the same filenames to replace them, or edit the script and re-run
`node scripts/make-icons.mjs`.
