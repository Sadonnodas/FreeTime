# FREETIME — working notes for Claude Code

A personal life-organiser PWA for one person (Toon / `Sadonnodas`). Local-first,
static hosting, no backend.

**[freetime-spec.md](freetime-spec.md) is the source of truth. Read it before
changing behaviour.** [README.md](README.md) covers how the code fits together and
the setup walkthroughs. This file is the short version of everything that would
otherwise have to be re-explained.

---

## State: everything in the spec is built, plus a round of additions

All eight phases of spec §10, plus the §9 importer, plus a visual redesign.
Live at **https://sadonnodas.github.io/FreeTime/** — pushing to `main` deploys.

Since the spec was finished: project cover photos and a picture grid, per-project
section chips on to-dos, a quick-idea sheet, kept voice memos with date/time/place,
and three more assistant tools. See *Additions after the spec* below.

90 tests pass. `npm run check` is clean.

**Local dev runs on port 5199**, not Vite's default 5173 — another project of Toon's
lives there. `.claude/launch.json` pins it; the URL is
`http://localhost:5199/FreeTime`.

**Waiting on Toon, not on code:**

1. **Google OAuth client ID** → paste into `GOOGLE_CLIENT_ID` in
   [src/lib/config.ts](src/lib/config.ts). Until then sign-in is hidden, and Drive
   sync + the Today calendar strip do nothing. Walkthrough in README → *Google setup*.
2. **Gemini API key** → entered in-app at *Me → Settings*. Until then voice capture
   and the assistant are hidden. Nothing else is affected.
3. **Running the Notion import** → *Me → Import*.

## Setup on a new machine

```bash
git clone https://github.com/Sadonnodas/FreeTime.git
cd FreeTime && npm install
npm run dev      # http://localhost:5173/FreeTime  <- note the path
```

Node 22. `npm run build`, `npm run preview`, `npm run check`, `npm test`.

**The dev URL includes `/FreeTime`** because `kit.paths.base` is set. Bare
`localhost:5173` will not work.

**Your data does not travel with the repo.** Everything lives in IndexedDB, per
browser, per machine. A fresh clone opens an empty app with just the seed projects.
Drive sync (once the client ID is in) is the only thing that moves data between
devices.

## Privacy — read before running anything

`notion/` holds Toon's personal Notion export. It is **gitignored and must never be
committed, published, or pasted into any output.** It exists only on the Windows
machine; a fresh clone will not have it, and the importer works fine without it
(it takes any CSV via a file picker).

## Architecture in ten lines

- SvelteKit + `adapter-static`, Svelte 5 runes, TypeScript strict, Tailwind v4. Two
  runtime dependencies: Dexie, and Leaflet (lazy, map only).
- **IndexedDB via Dexie is the only runtime source of truth.** Every read and write
  hits it and nothing else, so writes return instantly.
- [store.ts](src/lib/store.ts) is the *only* place that mutates.
  [queries.ts](src/lib/queries.ts) only reads. The Gemini assistant writes through
  `store.ts` too, so AI writes queue offline and sync identically.
- `deletedAt` is a tombstone; nothing is ever hard-deleted. `updatedAt` is the sync
  tiebreaker — **every write must bump it**.
- Dexie `liveQuery` + Svelte's `$` prefix keeps UI current with no manual refresh.
- Sync is background reconciliation, never in the interaction path.

## Hard rules

From spec §11 and the post-mortem that produced it. These are not preferences.

- **No streaks. No completion percentages. No progress bars. No "overdue" state, red
  badge, or nag.** No weekly/monthly planning views. No priority field. No analytics.
- **Completed items are never deleted and never hidden.**
- **Capture takes one field and no required fields, ever.**
- **A new project / habit / list is one tap and one field.**
- **Every AI feature keeps a working non-AI path.** The app must be fully usable
  offline with no keys.
- **A project has exactly three tabs** (Notes / To-dos / Buy). Widgets sit *above*
  them rather than becoming a fourth. Depth is what killed the previous system.

If a change seems to need one of these, that is a signal to reread the spec's
opening section, not to make an exception.

## Decisions that look wrong but are deliberate

Do not "fix" these without talking to Toon first.

- **A tombstone beats a newer edit** ([merge.ts](src/lib/merge.ts)). Delete at 10:00,
  edit at 10:05, and the record stays deleted. Nothing ever clears a tombstone, so the
  alternative lets deleted records resurrect — the exact failure sync exists to prevent.
- **Untagged to-dos always pass the energy filter** ([freetime.ts](src/lib/freetime.ts)).
  Capture sets no energy by design, so most to-dos have none. Excluding unknowns would
  empty the pool and the Free Time flow would return nothing.
- **Free Time slots fill most-constrained-first** (obligation → pull → neglected) but
  **display in spec order**. Filling in display order let the pull swallow the only
  dated item, leaving the obligation slot empty.
- **Import refuses year-less dates** ([import/notion.ts](src/lib/import/notion.ts)).
  Notion writes `Feb 3`, and `Date.parse('Mar 22')` succeeds anyway — importing them
  would file 43 stale rows as this year, all in the past, permanently occupying the
  obligation slot. Undated is correct; undated things wait.
- **Import defaults every project name to "leave unassigned"**. Auto-creating a project
  per workstream is how the old system grew nine projects of boilerplate.
- **The monthly summary is keyed on being *shown*, not acknowledged**
  ([monthly.ts](src/lib/monthly.ts)). One that waits to be properly received comes back,
  and anything returning uninvited is a nag.
- **The assistant never writes directly** ([gemini/tools.ts](src/lib/gemini/tools.ts)).
  Reads run immediately; writes are proposals until tapped. A test asserts every tool is
  deliberately classified — a write misfiled as a read would execute unnoticed.
- **Model output is validated, not trusted** ([gemini/plan.ts](src/lib/gemini/plan.ts)).
  Unknown id, duplicate, or an "obligation" with no date throws the whole response away
  and the deterministic path runs.

## Traps, found the hard way

- **Anything seeded on an empty database duplicates itself across devices.** Seeding
  runs whenever the store is empty, which is true of every NEW DEVICE, and it runs
  BEFORE the first sync because sync cannot start until the store is open. So the second
  device minted its own copies with fresh uuids, pulled down the first device's, and
  merge — matching on id, correctly — kept both sets. Ten projects became twenty. The
  second symptom was worse than the first: a cover photo set on the laptop looked like
  it had failed to sync, when really it was on the *other* copy of the same name, and
  the phone was showing its own. Seeding is gone ([boot.ts](src/lib/boot.ts)) and a new
  install starts empty. **If anything is ever seeded again, give it ids derived
  deterministically from its content** so two devices generate the same ones and merge
  instead of collide.

- **getUserMedia's defaults destroy music.** `{audio: true}` turns on echo
  cancellation, noise suppression and auto gain, because the browser assumes a voice
  call. On a sung melody or an acoustic guitar this is audible immediately: noise
  suppression treats a sustained note as background hum and gates it, and auto gain
  pumps the level between phrases. Voice memos pass `startRecording({ music: true })`
  ([audio.ts](src/lib/audio.ts)) to turn all three off and raise the bitrate. The
  brain-dump path deliberately keeps them ON — for speech in a car they help.
- **A MediaRecorder webm carries no duration.** Chrome writes no duration into the
  container, so `audio.duration` comes back `Infinity` and the scrubber is dead until
  the stream has been walked to the end. [MemoList.svelte](src/lib/components/MemoList.svelte)
  forces the walk by seeking to `1e101` and then resetting, and falls back to the
  elapsed time recorded at capture. Safari's mp4 reports correctly, so this looks fine
  on a phone and broken on a laptop.
- **Dexie's `update()` with `undefined` DELETES the property.** Load-bearing in three
  places: removing a project cover, unfiling a memo, and dropping a deleted memo's
  audio. If it silently ignored undefined instead, deleted recordings would keep tens
  of megabytes on the device forever and nothing on screen would show it. Pinned by
  [memos.test.ts](src/lib/memos.test.ts) — do not remove those assertions.
- **The built-in `<audio controls>` is a white pill on every platform.** It reads as a
  form element dropped into the page and undoes the whole dark treatment in one
  element. MemoList drives a hidden `<audio>` by hand instead; it is about forty lines.
- **The in-app preview browser cripples the microphone and service workers, and it
  does it differently per origin.** The mic throws `NotAllowedError` everywhere. On
  **localhost**, SW registration fails outright with *"An unknown error occurred when
  fetching the script"* even though the script returns 200 with the right MIME type — a
  three-line no-op worker fails identically, so it is the browser, not a scope or
  base-path bug. On the **live HTTPS origin** `register()` resolves and the registration
  appears, but the worker never activates: `navigator.serviceWorker.ready` never
  settles, and the registration has vanished by the next evaluation. So an update check
  there can look like it succeeded when nothing happened. Recording, offline boot and
  the update cycle all have to be tested on a real device.
- **`registerType` is `'prompt'`, and that does NOT mean the user gets prompted.** It
  means the reload is ours to time ([pwa.ts](src/lib/pwa.ts)). Under `'autoUpdate'` the
  page reloads the instant a new worker takes control, which was fine when updates were
  only discovered at startup — and is not, now that the app checks every 30 minutes and
  on every foreground. That reload would eventually land mid-sentence and bin whatever
  was in the capture box. Waiting builds are installed only while the app is in the
  background, at launch, or on the way back to the foreground. Nothing is ever
  announced, so the no-nag rule still holds.

- **The model name is a single point of failure.** One constant,
  [client.ts](src/lib/gemini/client.ts) `MODEL`. Google retires models for *new* keys
  without warning: `gemini-2.5-flash` started returning `404 NOT_FOUND` — "no longer
  available to new users" — and every AI feature died at once while the rest of the app
  looked perfectly healthy. Now on `gemini-3.6-flash`. If all AI stops working on a fresh
  key, check this first, and read the 404 body — it names the replacement.
- **`Error 403: access_denied` at sign-in is a missing test user, not verification.**
  The screen says the app "has not completed the Google verification process", which sends
  you to the wrong place, and it has **no Advanced link** — it is a refusal, not the
  click-through warning. Fix: *Google Auth Platform → Audience → Test users → Add* (the
  setting moved out of *OAuth consent screen*), and check the project selector, because
  adding the tester to the wrong project fails silently. The "unverified app" warning with
  **Advanced → Go to FreeTime (unsafe)** only appears *after* this check passes.
- **A Gemini API key cannot take an HTTP referrer restriction.** Google now requires
  Gemini keys to be bound to a service account, and website restrictions are unavailable
  on bound keys — the Console says so outright. This makes the mitigation named in
  [client.ts](src/lib/gemini/client.ts)'s header comment and in the README impossible.
  What is achievable is an **API restriction** to *Generative Language API* alone. The
  residual exposure is small: the key is typed into Settings, lives only in IndexedDB, and
  is never in the repo, the bundle, or Drive. Do not spend another afternoon on this.
- **AI Studio keys live in their own Cloud project** and cannot be moved or linked into
  another. Enabling *Generative Language API* in the `FreeTime` project does not make an
  AI Studio key appear there — enabling an API grants permission, it does not create or
  import keys. To restrict a key you must be in the project it was born in.
- **Google gives a static site no refresh token.** Its discovery document lists no
  `none` token-endpoint auth method, so a secretless client cannot use the token
  endpoint at all. Spec §2.1's PKCE-plus-refresh-token plan is not buildable. Sign-in
  uses `response_type=token` by full-page redirect (never a popup — popups break iOS
  standalone PWA mode); the token lasts an hour and renews via `prompt=none` at app
  start only, never mid-interaction.
- **Gemini does not accept webm**, which is what Chrome's MediaRecorder produces
  (Safari gives mp4/aac). [audio.ts](src/lib/audio.ts) decodes and re-encodes to 16 kHz
  mono WAV. Do not "simplify" this by sending the raw blob.
- **GitHub Pages' SPA fallback must be named `404.html`** — `200.html` is the Netlify
  equivalent and would silently do nothing. Deep links return HTTP 404 with the app
  shell; that status is unavoidable and harmless.
- **`kit.paths.base` is `/FreeTime`** (project repo, not the user repo the spec
  assumed). Every internal link uses `base` from `$app/paths`. `BASE` is one constant in
  each of `svelte.config.js` and `vite.config.ts`; setting both to `''` moves the app to
  a domain root.
- **Pages source must be "GitHub Actions"** in repo settings. `configure-pages` cannot
  set it — `GITHUB_TOKEN` lacks the rights, and the default branch source runs Jekyll
  over the README instead of deploying the app.
- **Headless Chrome hangs IndexedDB**, so the app cannot be screenshotted that way. It
  also clamps windows to ~500px minimum, which looks like a horizontal-overflow bug and
  is not. Verify layout at 500px or wider.
- **Careful with `\b` in Python-driven edits.** A `\b` in a non-raw Python string
  becomes a literal backspace byte and silently corrupts a regex. Caught once by a test;
  scan with a control-character check if edits go through Python.

## Additions after the spec

These are not in [freetime-spec.md](freetime-spec.md). They follow its rules; where
one came close to a hard rule, the reasoning is recorded here.

- **Project covers.** `Project.image` is a data URL capped at 640px
  ([images.ts](src/lib/images.ts)); the Projects grid is photo tiles, and a project
  with no cover gets a gradient keyed to a hash of its own name so it still looks
  deliberate. The grid's order control offers *Quiet first* — deliberately a sort you
  ask for and never a badge the app assigns, which is what keeps it the right side of
  the no-nag rule.
- **Sections** (`Project.tags`, `Todo.tag`). Named groups within a project — Creating /
  Mixing / Mastering, or one per song. Rendered as a chip row over ONE flat list, not
  as pages: the project still has exactly three tabs and nothing is deeper than two
  taps. Adding a to-do while a chip is lit files it there, so it stays one field.
  One tag per to-do on purpose — multi-select turns a glance into a query builder.
- **Voice memos** (`Memo`, [memos.ts](src/lib/memos.ts)). Kept recordings, structurally
  separate from `QueuedAudio` because that one is consumed and thrown away while a memo
  IS the artifact. **Stopping saves** — there is no confirm step and no required field;
  the panel afterwards is optional. Date, time and location are captured without being
  asked for, and location is never awaited, because a recorder that waits on a
  permission sheet misses the idea. They live in Brain → Memos and, per project, in a
  `memos` widget above the three tabs.
- **Update checking does not trust the service worker alone** ([pwa.ts](src/lib/pwa.ts)).
  A registration can vanish underneath the app — Safari evicts workers for sites left
  alone about a week — and the stale handle goes on answering `update()` without
  complaint, so the app reports "this is the latest version" from a page with no way
  left to get a new one. Observed exactly that way. So the primary check fetches
  `index.html` with `cache: 'no-store'` and compares the hashed entry-chunk filename
  against the one the page actually loaded; it needs no version endpoint, cannot be
  fooled by a cached response, and works with no worker at all. The worker is then the
  fast path (swap an already-downloaded build) rather than the only path. A check that
  could not reach the server reports *failed*, never *current*.
- **Update checking** ([pwa.ts](src/lib/pwa.ts)). An installed PWA on iOS is suspended,
  not closed, so without this it can run a build from weeks ago while the fix sits live
  on Pages. Checks every 30 minutes and on every foreground; installs silently at a safe
  moment; *Me → Settings → Version* shows the build timestamp (`__APP_VERSION__`, stamped
  by `define` in vite.config.ts) and offers a manual check.
- **No starter projects, and archiving instead of deleting.** A new install used to
  arrive with ten of Toon's projects. Reversed on his request — an app that opens with
  ten projects you did not create is strange for anyone but the person the list was
  written for — and it turned out to be a sync bug as well (see traps). Spec §3.1 and
  seed.ts's own comment argued for seeding, including Disc Golf as a symptom of the old
  system; that reasoning was about *his* first run and did not survive contact with a
  second device.
  `Project.archived` existed from the start and nothing could set it, so a project once
  made was permanent. There is now an archive action at the foot of the project page
  (two taps, no dialog) and a *Show archived* list on the Projects screen to restore
  from. Archive rather than delete, because a project is a container: deleting one would
  strand its to-dos, notes and recordings with no way back.
- **The app icon is generated, not drawn** ([tools/make-icons.py](tools/make-icons.py),
  `python3 tools/make-icons.py`). It is the Free Time button — an amber-to-pink orb
  glowing on `--color-ink-950` — because that is the one image the app has, it reads as a
  low sun, and a warm circle is unmistakable at 60px among a home screen of blue squares.
  No lettering: type at icon size turns to mush. Regenerate rather than hand-editing the
  PNGs if the palette moves. `background_color` in the manifest paints the iOS launch
  screen, so it must equal ink-950 exactly or the app opens with a flash of the wrong
  black. **iOS bakes the icon in at install time** — changing it does nothing for an
  already-installed home-screen app until it is removed and re-added.
- **A map of recordings** ([geo.ts](src/lib/geo.ts),
  [MemoMap.svelte](src/lib/components/MemoMap.svelte)). Brain → Memos toggles List/Map.
  Leaflet is the app's second runtime dependency and is **lazily imported** — opening
  the app must not pay for a map that may never be opened. The real problem a map has
  to solve here is not drawing pins but that most recordings happen in the same few
  places: two hundred made at home would bury the three made on a trip, which are the
  only ones anyone wants to find. So nearby memos collapse into one counted marker on a
  grid whose cell size follows the zoom. Filters by project and by calendar period —
  *this month* means August, not the last 30 days, because the question being asked is
  "where was I in August?".
  **Privacy:** map tiles come from OpenStreetMap, so drawing a map tells their tile
  server roughly which area is being viewed. That is unavoidable for real cartography
  and is the only thing in the app that leaves the device without Google involved. The
  coordinates themselves are never sent anywhere — there is no reverse geocoding, which
  is also why `Memo.place` is still never filled in.
  OSM serves only light tiles; a white map in this app looks like a browser window left
  open on top of it, so the tile pane is inverted and hue-rotated in CSS. Markers sit
  outside that layer and keep their real colour.
- **Assistant tools** added: `create_habit`, `append_note` (appends — never replaces,
  because a misheard sentence overwriting a page of notes is unrecoverable), and
  `navigate`. Navigation is a third category (`SAFE_TOOLS`): it writes nothing, but it
  is still offered as a link rather than followed, because a model that can move the
  screen mid-sentence takes the conversation away from under you. The assistant's mic
  transcribes into the input box and does NOT send — you read the words first.

**Sync between devices already works** and always did — Drive sync is spec §8 and the
client ID is in [config.ts](src/lib/config.ts). It needs signing in to Google on each
device; there is nothing to build. Memos are the exception, below.

- **Memo sync** ([sync.ts](src/lib/sync.ts) `syncMemos`). Metadata rides in
  `memos/memos.json`; the audio goes up as real audio files in the same folder, so a
  recording can be played and shared straight from Drive by someone who has never heard
  of this app. **Never run memos through the generic table loop** — `JSON.stringify` on
  a Blob yields `{}`, and the loop's `bulkPut` would write that back over the local row
  and destroy the only copy of a recording while leaving it looking healthy. The blob is
  stripped before merging and reattached from the local row afterwards, never taken from
  the remote side. Downloads are on demand, the first time you press play on a device,
  so a laptop does not silently pull down every recording ever made; `driveFileId`
  without a `blob` means "not here yet", which the UI must not show as "gone". Asserted
  in [memos.test.ts](src/lib/memos.test.ts).

**Still not built:** `Memo.place` is never filled in, deliberately — see the privacy
note above; and lyrics-per-song would need `notes` to stop being one-per-project, since
it has a `&projectId` unique index today.

**A waiting service worker can wedge forever on an installed iOS app.** Cost a round
trip to learn, so: a worker that does not `skipWaiting` stays in *waiting* until every
client it would control has gone away, and on an iOS home-screen app that moment may
never arrive. Force-quitting from the App Switcher does NOT reliably produce it — the
launch afterwards is served by the old worker, which controls the new page before the
waiting one is ever consulted. Confirmed on a real iPhone: an installed app stayed on an
old build through repeated force-quits. Advice to "just force-quit it" is wrong; do not
give it.

The fix is `workbox: { skipWaiting: true, clientsClaim: true }` — the new worker
activates the instant it installs, with no queue to get stuck in. The cost is that a
running page can find itself on old JavaScript while the worker serves a newer build,
and the old code-split chunks are gone from Pages after a deploy, so a navigation could
404. [pwa.ts](src/lib/pwa.ts) closes that window by reloading on `controllerchange` at a
safe moment, and SvelteKit turns a failed chunk import into a full page load anyway.
Guard `controllerchange` against the first-ever control of a page, which is not an
update and must not trigger a reload.

**If an installed app is ever wedged anyway**, deleting and re-adding the home-screen
icon always works — but on iOS a home-screen web app has its OWN storage, so it wipes
IndexedDB. Connect Drive sync first, or the data is gone.

## Working style Toon has asked for

- **For anything outside the code — GitHub settings, Google Cloud Console, deploys —
  give numbered steps with the exact link and the exact value to type.** Not a
  description of the goal. Console UIs are unfamiliar territory; the code is not.
- **When something fails, say plainly whose fault it was before explaining the fix.**
  After a broken deploy the first question was "so what did I do wrong?" when the cause
  was a bad assumption in the workflow. Lead with that, then the steps.
- Explain trade-offs as you go, and say what the alternative was and why it lost.
  Toon is building this to understand and maintain it, not to receive a black box.
