# FREETIME

A personal life-organizer PWA. Single user, local-first, no backend.

The full design rationale lives in [freetime-spec.md](freetime-spec.md) — that document is
the source of truth. This file covers how the code is put together and how to run it.

---

## What exists today

All eight phases of the plan in spec §10, plus the Notion importer (§9).

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
| Habit detail — heatmap + cycle history | [habits.ts](src/lib/habits.ts), [me/habits/[id]](src/routes/me/habits/%5Bid%5D/+page.svelte) |
| Monthly summary, once a month | [monthly.ts](src/lib/monthly.ts) |
| List detail — want / doing / done | [brain/lists/[id]](src/routes/brain/lists/%5Bid%5D/+page.svelte) |
| Calendar strip on Today, read-only | [google/calendar.ts](src/lib/google/calendar.ts) |
| Notion importer with triage | [import/](src/lib/import/), [me/import](src/routes/me/import/+page.svelte) |

Everything in the spec is built. Calendar and the importer both need setup to do
anything visible: Calendar needs Google sign-in, and the importer needs your export.

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

### Cycles, not streaks

[habits.ts](src/lib/habits.ts) contains no streak counting and must never contain any. A
streak can only ever tell you that you broke it. The detail screen shows a heatmap of
what actually happened and a cycle history —
`active Jan – Mar · dormant Mar – Aug · active Aug –` — which turns "I abandoned guitar
again" into "this is the fourth cycle, and they always come back". Same data, opposite
message.

That needed a schema addition. `Habit.stateChangedAt` records only when the *current*
cycle began, which is enough for "dormant since March" but not for counting returns, so
every explicit state change is now logged. Nothing is ever inferred from a gap in
logging — dormancy is always the user's own call (spec §3.6). Habits created before this
existed have their first cycle synthesised from `createdAt`, so nothing looks broken.

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

## The Notion importer

Built against the real export, which turned out to matter — two things in it would have
been imported wrongly by any reasonable-looking parser.

**Dates have no year.** Notion writes `Feb 3`, `Mar 22`, `Feb 3 → Feb 3`. But
`Date.parse('Mar 22')` happily succeeds, so a naive importer would file 43 stale rows as
*this* year — every one landing in the past. This app has no "overdue" state by design, so
a past date simply means "real obligation", and those rows would permanently occupy the
obligation slot in Free Time with months-old noise. **Year-less dates are refused**, and
the screen says how many and why. The to-do still imports; it just arrives undated, which
means it waits.

**Column names are useless.** A real export names unconfigured properties `Property` — and
in this export that one name is a Yes/No flag in the to-do table and the **URL** in the
shopping list. No header matching can tell those apart, so columns are also identified by
what they *contain*. Every guess is shown and can be overridden before anything is written.

**Workstreams are a decision, not an import.** The spec's diagnosis is that the old
workspace ran Projects *and* Workstreams and neither replaced the other. So each project
name found in the export gets an explicit choice — use an existing project, create one, or
leave items unassigned — and the default is **leave unassigned**. Auto-creating a project
per workstream is exactly how the old system grew nine projects of boilerplate.

Triage ("go through them") exists for the same reason: per §9, forced re-entry is a useful
filter, and much of that backlog is stale.

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
   Fill in the app name and your email. **Leave it in Testing** — do not publish.
   Testing mode is deliberate (spec §2.1): `calendar.readonly` is a sensitive scope, and
   staying in Testing skips Google's verification review entirely. The price is a one-time
   "Google hasn't verified this app" warning, which you click through via *Advanced*.
4. **Add yourself as a test user — this is its own step, and skipping it looks like
   something else entirely.** Go to
   [console.cloud.google.com/auth/audience](https://console.cloud.google.com/auth/audience)
   (the setting moved here from *OAuth consent screen*), check the **project selector is
   `FreeTime`**, then *Test users* → **+ Add users** → your Google account → **Save**.
   Confirm it appears in the list afterwards.

   Miss this and sign-in dies with **`Error 403: access_denied`** and the text *"has not
   completed the Google verification process"* — which sounds like a verification problem
   and is not, and which offers **no Advanced link** because it is a refusal rather than a
   warning. Adding the tester to the wrong project fails the same way, silently.
5. **Create the client.** *Credentials → Create credentials → OAuth client ID →*
   **Web application**.
   - *Authorised JavaScript origins*: `https://sadonnodas.github.io` and
     `http://localhost:5173`
   - *Authorised redirect URIs*: `https://sadonnodas.github.io/FreeTime/` and
     `http://localhost:5173/FreeTime/`
   The trailing slash matters. Google matches redirect URIs character for character.
6. **Paste the client ID** into `GOOGLE_CLIENT_ID` in
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

- A `notion/` folder is **gitignored**. It holds a personal export and must never be
  committed or published.

- The **Gemini API key** is pasted into Settings by the user and stored in IndexedDB. It
  is visible in their own browser's network tab, which is acceptable for a single-user
  app on their own device. It is never in the repo, the built bundle, or Drive — the
  `settings` table is deliberately not synced, so the key must be entered once per device.

  **An HTTP referrer restriction is not available**, though earlier notes here said to
  add one. Google now requires Gemini keys to be bound to a service account, and website
  restrictions cannot be applied to bound keys. Restrict it by **API** instead: Cloud
  Console → the key → *API restrictions* → *Generative Language API* only. That caps what
  a leaked key could reach, which is the part that matters.

- A **downloaded `client_secret_*.json`** is gitignored and unused. Google offers it when
  you create the OAuth client; nothing here can use it, because a secretless static site
  has no token endpoint to present it to. Safe to delete.
- **Google OAuth** uses no secret at all — see *Google setup* above. The access token it
  does hold is short-lived and lives only in IndexedDB.
- The **OAuth client ID** in `config.ts` is public by design and is not a secret.

Nothing is read from `.env` at build time.

## The dinosaur stickers

`static/dino/` holds 55 stickers, cut from Toon's sticker sheets in `art/sheets/`
by `scripts/slice-stickers.py` and indexed in `src/lib/stickers.ts`.

To redo them from new sheets:

```bash
python3 scripts/slice-stickers.py art/sheets/*
```

`art/stickers.json` holds the finished names per sheet (a `null` entry is a
sticker deliberately dropped) and the list of background holes to make
transparent, so the command above reproduces `static/dino/` exactly rather than
producing something to rename and retouch afterwards.
`src/lib/stickers.test.ts` fails if the names and the files ever disagree.

The holes are curated by hand and have to be: a gap of paper enclosed by the
artwork is the same white as a drawn one — the chef's jacket, the canvas on the
easel — and colour, connectivity and distance-to-the-outside were all measured
and all overlap. Each entry is a normalised point inside a region judged by eye.

After re-slicing, re-run the upscale (below) before the stickers go in the app.

The sheets are phone screenshots, so a sticker arrives about 200px tall while a
cover on a 3x phone wants roughly 450. They were sharpened with **Real-ESRGAN's
illustration model** (`RealESRGAN_x4plus_anime_6B`), run through `spandrel` on
Apple Silicon's MPS backend, 4x and then resampled down to 448px — the downsample
is what actually cleans the lines. Alpha goes through the network separately;
LANCZOS on a hard cutout leaves a soft grey rim that reads as a glow against a
coloured card.

Vectorising was tried first and rejected on size: `vtracer` handles flat cartoon
art well, but a traced sticker is 450KB-1MB of SVG because it chases every
gradient in the shading. Worth revisiting if the stickers are ever wanted for
print, where the size does not matter and the resolution is unbounded.

## Icons

A sauropod with an idea, on the app's near-black with a warm glow behind it.

    python3 scripts/make-icons.py

Regenerates every size — 192, 512, the Android maskable variant, the iOS
apple-touch-icon — plus `static/favicon.svg`. macOS only: it rasterises SVG with
`qlmanage`, since nothing else on this machine can. To run it elsewhere, swap that one
call for `rsvg-convert` or `cairosvg`; the rest is portable.

To change the animal, replace [scripts/sauropod.svg](scripts/sauropod.svg) and re-run.
The smile, thought cloud and layout are placed against that file's own 36×36 grid, so a
different drawing will need those coordinates adjusted — they are at the top of the
script with the reasoning next to them.

**iOS bakes the icon in when the app is added to the home screen.** Changing it does
nothing for an already-installed app until it is removed and re-added.

### Attribution

The dinosaur is [Twemoji](https://github.com/twitter/twemoji)'s sauropod, © Twitter, Inc
and other contributors, licensed **CC-BY 4.0**. The smile, the thought cloud, the
composition and everything else are this project's.
