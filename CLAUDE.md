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
- **Completed items are never deleted and never hidden** *by the app*. Deleting one
  row by hand is a different thing and is allowed: there is a per-row two-tap
  Delete on to-dos and buy items ([RemoveButton.svelte](src/lib/components/RemoveButton.svelte)),
  because a to-do typed while testing is not an achievement and living with it
  forever is its own kind of nag. What stays banned is the app doing it: no
  auto-archiving, no hiding closed work, and **no "clear completed"** — the wins
  feed is made of exactly that.
- **Capture takes one field and no required fields, ever.**
- **A new project / habit / list is one tap and one field.**
- **Every AI feature keeps a working non-AI path.** The app must be fully usable
  offline with no keys.
- **Nothing is ever more than two levels deep: era, then project.** This replaced
  the older "an era has exactly three tabs, and a project is a chip, never a page"
  rule, which was overruled after Toon used the app on a phone with several builds
  running at once and called it chaotic. **The rule was aimed at depth, and the
  depth did not change** — era → project → folded sections is exactly as deep as
  era → chip → tab was. What went was a whole concept: blocks lived above the tabs
  and to-dos lived inside them, two parallel systems for the same five kinds of
  thing, with nothing to tell you which one a photo belonged to. If a third level
  is ever proposed, THAT is the thing this rule still forbids.

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
- **Ideas are filed into projects, never into their own collections.** The Ideas tab
  once had free-form named groups (Books, Albums) with a "+" chip to invent more —
  a second hierarchy running alongside projects, which is exactly the depth that
  killed the previous system. Ideas now start unfiled and are filed by tapping the
  row and picking a project, so an idea with no home yet is a valid resting state
  rather than a prompt to invent a taxonomy. `Idea.group` still exists and still
  shows as a footnote so migrated list items are not invisible, but nothing writes
  one any more — the assistant's `create_idea` lost its `group` argument and the
  voice extraction lost its `list_item` kind for the same reason.

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

- **A liveQuery only re-runs for the tables it actually read.** Today's three slots were
  resolved in an `$effect` keyed on the day record, so completing a to-do — a write to
  `todos`, leaving `days` untouched — re-ran nothing: no tick, no count change, until the
  third completion happened to write `closedAt` and shake it loose. The app's central
  interaction did nothing visible and it went unnoticed for weeks. If a derived view
  spans two tables, read both inside one liveQuery.
- **A modal rendered inside a styled heading inherits that heading's typography.**
  `InfoDot` sits in an `<h2 class="section-label">`, so its sheet came out uppercase,
  letter-spaced and grey no matter what classes the text carried — reported as "the text
  is so aggressive". The fix is a reset on the overlay, not more classes on the content.
- **Anything rendered above the page content needs its own `pt-safe`.** Every page sets
  its own; a bar in the layout above `<main>` does not inherit one, so the update notice
  slid under the iPhone's clock and battery where it could be neither read nor tapped.

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
- **`location.reload()` does not escape the HTTP cache, and that broke updating.**
  Observed live: a page running an old build while the server had a newer one, because
  GitHub Pages serves index.html with `max-age=600` and a reload inside that window is
  answered from cache with the very document you are trying to replace. The update
  appears to do nothing and the next check tries again — a quiet loop that never
  converges. `apply()` now does `fetch(base + '/', { cache: 'reload' })` first, which
  forces the network and rewrites the cached entry, and `justTriedUpdating()` stops a
  second automatic attempt within a minute so a stubborn case shows the banner instead of
  reloading forever.
- **The app now says when it updated, reversing an earlier call.** Silent updating was
  chosen on no-nag grounds, and silence has its own failure: you cannot tell a working
  app from one quietly running last month's code, and worrying that you might be is worse
  than a line of text. [UpdateNotice.svelte](src/lib/components/UpdateNotice.svelte) shows
  two states, both statements rather than requests — *"Updated — built X"*, transient,
  after a build installed at launch; and *"A newer version is ready"* with an Update
  button when one is found MID-SESSION, where reloading unasked would throw away whatever
  is half-typed. The second stays until acted on: a staleness warning that dismisses
  itself is no use. `consumeJustUpdated()` carries the fact across the reload in
  localStorage and clears it, so the confirmation appears once, on the launch it belongs
  to.
- **`registerType` is `'prompt'`, and that does NOT mean the user gets prompted.** It
  means the reload is ours to time ([pwa.ts](src/lib/pwa.ts)). Under `'autoUpdate'` the
  page reloads the instant a new worker takes control, which was fine when updates were
  only discovered at startup — and is not, now that the app checks every 30 minutes and
  on every foreground. That reload would eventually land mid-sentence and bin whatever
  was in the capture box. Waiting builds are installed only while the app is in the
  background, at launch, or on the way back to the foreground. Nothing is ever
  announced, so the no-nag rule still holds.

- **"Signed out of Google" was told to a laptop that had never signed in.** `syncNow`
  checked only for a token, so a device that had never been connected and one whose
  hour had run out produced the same paused state and the same message — *"will
  reconnect on next open"* — which is true only for the second. A laptop sat showing
  none of the projects made on the phone, told to wait for something that could not
  happen (silent renewal only runs for a device that has consented before). Three
  states now: `signed-out`, expired-but-renewable, and expired-and-Google-refused.
  Same rule as the update check: report what did not happen, never a recovery that
  cannot occur.
- **A silent renewal is stamped BEFORE the redirect, not when it returns failed.**
  The 30-minute backoff was armed in `handleRedirect`, which assumes Google always
  comes back with `#error=`. It does not — `redirect_uri_mismatch` renders Google's
  own error page and never redirects — so nothing was recorded, the backoff never
  engaged, and the app bounced to Google on every launch with no way back. Seen in
  dev, where port 5199 is not a registered redirect URI, but any error Google renders
  as a page wedges a real install identically.

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
- **iOS zooms in on any form control smaller than 16px, and never zooms back.**
  Reported as "the app zooms in a bit while typing and I have to pinch to get back".
  Ten fields sat at Tailwind's `text-sm` (14px), the notes textarea among them, so
  writing lyrics on a phone did it every time. The fix is a floor on the size in a
  `@media (pointer: coarse)` block in [app.css](src/app.css), placed OUTSIDE any
  `@layer` — unlayered rules beat layered ones regardless of specificity, which is
  what lets it override a Tailwind utility on the same element — and written against
  the elements rather than `.field`, so a field added later cannot forget to opt in.
  **Do not "fix" this with `maximum-scale=1` in the viewport tag**: it works by
  disabling pinch-zoom altogether, which trades a real accessibility loss for a
  layout annoyance.

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
- **The app icon is a sauropod with an idea** ([scripts/make-icons.py](scripts/make-icons.py),
  `python3 scripts/make-icons.py`). Composed, not drawn: the dinosaur is Twemoji's
  sauropod (CC-BY 4.0, credited in the README), and the smile, thought cloud, trail and
  layout are ours, placed against that file's own 36×36 grid. Rasterised with `qlmanage`
  because nothing else on this Mac can turn SVG into PNG — swap that one call for
  rsvg-convert to run it anywhere else.
  **Do not try to hand-draw a character in SVG.** Four attempts produced, in the owner's
  words, "random shapes put together vaguely like a dinosaur". Writing bezier curves
  blind makes decent geometry — the sun, mountains and arch all worked — and bad animals,
  because a creature lives on proportion and line quality that cannot be eyeballed from a
  screenshot. Compose existing artwork instead.
  `background_color` in the manifest paints the iOS launch screen, so it must equal
  ink-950 exactly or the app opens with a flash of the wrong black. **iOS bakes the icon
  in at install time** — changing it does nothing for an already-installed home-screen app
  until it is removed and re-added.
- **One deliberate exception to "no analytics"**
  ([ProjectShare.svelte](src/lib/components/ProjectShare.svelte), `activityByProject`).
  Me shows where the recorded work went, by project, over 30 days / 6 months / a year.
  Asked for and argued through: Toon wants to *see* that Family has been quiet, and says
  that motivates him. It stays the right side of the rule by describing rather than
  measuring — it counts events that happened (closed, bought, recorded, finished) against
  no target, so there is nothing to be behind on. No goal percentages, no red, no "you
  should". **Projects at zero are shown, not filtered out**: the empty row is the entire
  reason for looking.
  **State the caveat wherever this is shown.** It can only see what got written down, so
  the projects that look thinnest are the ones whose value never took the shape of a
  to-do — Family most of all. Left unsaid, the chart reads as a fact about the year when
  it is a fact about the recording.
  The donut is what was asked for; the ranked bars under it are what make it readable,
  since ten projects in a pie is a row of unlabelled slivers and the quiet one you came
  to look at is the least legible of them.
- **`setMonth` overflows and will silently shorten a window.** Six months back from 30
  August is "30 February", which rolls forward into March — a chart quietly missing the
  end of February. `monthsAgoIso` clamps the day to the target month's length. Caught by
  a test, not by anyone noticing the numbers were wrong.
- **Brain is four kinds, not six** ([brain/+page.svelte](src/routes/brain/+page.svelte),
  [migrate.ts](src/lib/migrate.ts)). Inbox and Lists both folded into Ideas, because all
  three were the same shape — a thought with no action attached. An unfiled capture is
  one you have not decided about; "read Sapiens" is one you never will. `capture()` now
  writes an unfiled Idea, so triage is one button ("Make a to-do") instead of two, and
  `Idea.group` carries the old list name as a chip row. `Idea.doneAt` replaces the list
  item's 'done' state and keeps feeding the wins feed. Groups are DERIVED from the ideas,
  so a collection nobody fills stops existing — the old Lists tab accumulated empty lists
  that had to be tidied by hand.
  **The migration reuses each source row's id**, which is the whole trick: it runs
  independently on every device, and minting fresh uuids is exactly what duplicated the
  seeded projects. Same id on both devices means sync merges rather than stacks, and
  running it twice is a no-op. Asserted in [migrate.test.ts](src/lib/migrate.test.ts).
  `?section=inbox` and `?section=lists` still resolve, to Ideas.
- **The buy list groups by shop or by project** ([BuyList.svelte](src/lib/components/BuyList.svelte)).
  Grouping by shop is the one that earns its keep: five things across three projects that
  all come from the same place are one order and one delivery charge, which a list sorted
  by when you wrote them down hides completely. Each group carries the subtotal still to
  buy, which is what answers "have I cleared free delivery". Groups sort fullest-basket
  first, because that is where a combined order actually saves something; unbucketed
  items go last, being a pile to sort rather than a destination.
- **Buy items have a "needed" star, not a priority.** Toon asked for priority; the spec
  bans it. A scale is a second axis to maintain and feel bad about and it always rots,
  so this is binary: on or off, floats to the top, and never setting it costs nothing.
  If a priority scale is ever asked for again, this is the argument to make first.
- **Notes render, and a pasted link is clickable** ([markdown.ts](src/lib/markdown.ts),
  [NoteEditor.svelte](src/lib/components/NoteEditor.svelte)). Reading is the
  default and Edit is a toggle; the toolbar inserts the syntax so nobody has to
  know it is Markdown. **Stored text stays plain Markdown** — it syncs as JSON, the
  importer and the assistant both write it, and it has to survive a merge, so a
  contenteditable rich editor was the wrong shape however much easier it looks.
  **No markdown library**: tens of kilobytes on every page load for headings,
  bullets, bold and a link. The renderer is ~120 lines and tested.
  **It escapes BEFORE parsing, which bites twice.** Once for safety — a note syncs,
  so `[click](javascript:…)` would follow you between devices, hence the scheme
  allowlist. And once as a bug: the blockquote rule matched `>` when by that point
  the line already said `&gt;`, so every quote silently rendered as a paragraph.
  Line-level syntax involving an escaped character must match the ENTITY.
  Bare URLs are linkified because that is how links actually arrive — nobody types
  the brackets — with trailing punctuation left outside the href.

- **A buy item stores the price of ONE, never the line total** (`BuyItem.qty`,
  `priceCents`, [buy.test.ts](src/lib/buy.test.ts)). Storing the total was the
  alternative and it is a quiet trap: changing the quantity afterwards would leave
  the total saying whatever it said before, and nothing on screen would look wrong.
  A row shows the line total with the unit price under it only when there is more
  than one, and the list foots a "Still to buy" sum of everything unbought —
  a plain sum, never a budget, for the same reason there are no progress bars.
  `BuyItem.image` is a thumbnail capped at THUMB_EDGE, because "the bracket" and
  "the other bracket" are the same six words and not the same part.

- **Buy items carry a price, a shop and a project** ([BuyList.svelte](src/lib/components/BuyList.svelte)).
  All three fields existed in `BuyItem` from the start and nothing could enter them. One
  component now serves both Brain and a project's Buy tab so they cannot drift.
  **Add with one field, enrich behind a tap** — the same shape as a voice memo, because
  three fields in the add form would make writing down "gaffer tape" a chore, and a list
  that is a chore to add to stops being added to. A project's Buy tab sums what is left
  to buy: a plain total, never a budget, for the same reason there are no progress bars.
- **Five tabs, and Settings is one of them.** The spec said four and put settings inside
  Me, which conflated two unrelated things: habits and wins are about Toon, while sync,
  keys, appearance and the build are about the app. Reported as confusing, and it was
  also why the appearance control went unfound — it was three levels down behind a
  personal tab. `/settings` and `/settings/import` are top-level routes now; Me is
  habits and wins only. Five is the ceiling: six starts to crowd the bar on a phone,
  where each tab gets 75px.
- **One record button in the capture row, not two.** The waveform keeps your audio; the
  brain-dump — which feeds the recording to Gemini and then discards it — now lives
  inside the assistant. It was always a Gemini interaction wearing a capture button's
  clothes, and side by side the two were indistinguishable until you had used both.
  It shows on the assistant's empty screen only: once a conversation is going, a big red
  button in the middle of it is a different app. Distinct from the assistant's microphone,
  which transcribes into the input for you to read before anything is sent.
- **One capture surface, not two.** The capture field and a separate "New idea" button
  both just made an Idea; the only difference was that the button opened a sheet with a
  project picker. The picker moved into the field: chips appear once there is something to
  file, tapping one files it, ignoring them leaves it unfiled — which is still a valid
  resting state. The fast path (type, Enter, done, no sheet) is untouched, which is the
  whole point of spec principle 1. QuickIdea.svelte is gone.
- **The dinosaur gets a line under the button**, rotating independently of the scene so
  the pairing is fresh each open (`QUIPS` in freeTimeScenes.ts). **The house rule is that
  the jokes are about the dinosaur, never about you** — "you should get on with it" is a
  nag with a joke stapled to it, and this is specifically the app that does not do that.
  Several of them give explicit permission to do nothing, because that is a real answer
  to "free time?".
- **The Free Time button rotates through scenes** ([freeTimeScenes.ts](src/lib/freeTimeScenes.ts)).
  A different gradient and a different little scene each open — the dinosaur with a ball,
  in a river, under stars, with a guitar. **The division of labour is the lesson from the
  icon**: the dinosaur is real artwork because hand-written beziers make terrible animals,
  and everything around it is geometry, which hand-written beziers do fine. Nothing here
  tries to draw a creature.
  The caption is the layout constraint — the first pass ran the river through the words
  and put a ball on top of them. Ground-level props go below y 70 in the 100x100 space,
  anything beside the dinosaur beyond x 76. The previous scene id is remembered so the
  next open is never the same one, since a repeat reads as "nothing happened".
- **The dinosaur is a character, not just an icon** ([Dino.svelte](src/lib/components/Dino.svelte)).
  Same Twemoji artwork as the icon, so the animal on the home screen is the animal inside
  the app rather than two drawings that merely resemble each other. `tone="mono"` is a
  currentColor silhouette, for surfaces where three greens would fight. It stands in the
  Free Time circle asking "Free time?" — a question is a friendlier prompt than a label
  when the answer is genuinely yours — and it walks between the sun and the moon in
  Settings. More places to use it: the empty states.
- **The sun is always gold and the moon always silver.** They were coloured by which
  was selected — accent for on, grey for off — so in dark mode the moon glowed gold and
  the sun sat there silver. These two things have colours of their own; borrowing them to
  mean "selected" fights what they are. Selection shows as brightness and as where the
  dinosaur is standing. The whole road is one drag surface: press anywhere, walk the
  dinosaur, let go and it settles at the nearer end, so tapping the sun and dragging to it
  are the same gesture at different speeds.
- **Appearance is a sun/moon toggle plus an Automatic checkbox**
  ([ThemePicker.svelte](src/lib/components/ThemePicker.svelte)), not three radio buttons.
  The thing being chosen is day or night; "who decides" is a separate question, which is
  why it is a checkbox beside the toggle rather than a third position in it. With
  Automatic on the dino still stands under whichever the phone chose, so the control
  never goes blank, and tapping a side turns Automatic off — reaching for the sun means
  you want the sun.
- **Settings explanations live behind an ⓘ** ([InfoDot.svelte](src/lib/components/InfoDot.svelte)).
  All of it was worth saying once and none of it worth reading again, so the screen is a
  list of controls with the prose one tap away.
- **Light and dark** ([theme.ts](src/lib/theme.ts), the token blocks at the top of
  [app.css](src/app.css)). The whole theme is eight ink values plus five surface tokens,
  redefined under `[data-theme='light']` and a `prefers-color-scheme` query. **The ink
  ramp is a role, not a brightness**: ink-950 is always the page and ink-50 always the
  text on it, so the app inverts by redefining those values and no component needs to
  know. Surfaces were `bg-white/8` — a *lift* off the page, which is invisible on white —
  so they became `bg-surface-N` tokens that darken instead of lighten in light mode.
  `--color-brand-1/2` never flip: the Free Time button and the icon glow are the same
  orange in both themes because that is what the icon promises. `--color-accent` DOES
  flip, because amber that sings on black is unreadable as text on paper.
  Three choices, not four. **macOS and iOS already switch at real sunrise and sunset for
  wherever you are**, so `system` inherits that for free; an in-app schedule would need
  a location it cannot ask for and would disagree with every other app on the device.
  A blocking script in [app.html](src/app.html) sets the attribute before first paint —
  without it a light theme shows a full frame of near-black first, worst on the phone
  where it is the whole screen.
- **`:global()` is Svelte syntax and is INVALID in app.css.** Moving the map's styles
  out of the component and into the global sheet took the `:global()` wrappers along,
  and the browser silently discarded every rule containing one — the map pins vanished
  and the dark-mode tile inversion stopped, with no error anywhere. Plain descendant
  selectors in a plain stylesheet.
- **The desktop layout is a rail, not a wider phone** ([+layout.svelte](src/routes/+layout.svelte),
  `.shell` / `.page` / `.rail-item` in [app.css](src/app.css)). From 1024px the shell
  widens to 1040, the bottom tab bar is replaced by a labelled rail down the left, and
  the reading column inside caps at 720 — text stops getting more readable past about 70
  characters, so the extra width goes to the rail and the margins rather than to longer
  lines. Grids opt into more columns themselves (`lg:grid-cols-3` on Projects). It stops
  at 1040 on purpose: filling a 27-inch display would undo the reason the constraint
  exists, which is that the app should read as one designed object rather than a page
  that gave up. Below 1024 nothing changes at all — the phone layout is untouched.
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

- **A retired sticker must not render as a broken image.** Three were taken out
  after the fact — a soft JPEG duplicate of the rainbow arc, and two that simply did
  not read as dinosaurs (`through-the-fire-hoop`, `ninja-on-a-bridge`, which looks
  like a ninja with a dinosaur standing behind him). A project on another device can
  still be pointing at one. `ProjectCover` used to test `{#if sticker}{:else if
  image}`, so an unresolvable `dino:` reference fell through to the "it must be a
  photo" branch and rendered `<img src="dino:through-the-fire-hoop">` — a broken
  image where the project's own colour should be. `isStickerRef` separates the two
  cases; pinned by a test, because retiring another one is likely.

- **The white die-cut border is stripped, and the feather is the point**
  ([slice-stickers.py](scripts/slice-stickers.py) `strip_keyline`). Unlike the
  enclosed gaps, this one IS decidable: the border is the white that touches the
  outside, so a flood inward from the transparent edge finds it and never reaches a
  drawn white sitting behind its own dark outline. But cutting on a threshold alone
  just swaps a white rim for a pale grey one — the pixels where the outline meets the
  border are a blend of the two and sit under any threshold you pick — going lower
  only moves the line, because there is always a blend pixel on the far side.
  **The blend is solved, not thresholded.** The colour behind it is known to have
  been white, so `observed = white*(1-t) + colour*t` gives coverage `t` from the
  lightness, and dividing it back out recovers the outline's own colour. The result
  is a half-covered DARK pixel — which is what the edge always was — instead of an
  opaque light one, and it composites correctly over any card colour. Measured: the
  outermost pixel went from lightness ~150 to ~55.
  **The upscaler was making its own rim, separately.** It filled transparent pixels
  with the sticker's mean colour before running the network, so every dark outline
  was blended toward one flat light grey. It extends the nearest opaque colour
  outwards instead, so sharpening an edge produces more outline rather than a halo.

- **Which leftover white is background CANNOT be decided automatically, and the list
  is curated by hand** (`art/stickers.json` → `holes`,
  [slice-stickers.py](scripts/slice-stickers.py) `punch_holes`). A gap of paper
  enclosed by the artwork — inside the loop of the soldering iron's cable, between a
  dinosaur and its loom — is *the same white* as a drawn one: the chef's jacket, the
  astronaut's suit, the canvas on the easel. Every separating rule was measured and
  all of them failed. Colour: both are (244,245,239) on the sheet and (251,251,247)
  after upscaling. Distance to the outside: 13–41 dilations for background against
  7–41 for drawn, fully overlapping. Connectivity: these gaps are sealed by the
  sticker's own white keyline, so they are as enclosed as any painted shape. **Do not
  spend another afternoon looking for the rule.** Each hole is a normalised point
  somebody looked at and judged; the flood still computes the region, so the points
  survive a change of resolution, and a point that no longer lands on white prints a
  warning rather than silently doing nothing.

- **The two levels are Eras and Projects, in the UI only.** Toon's own words: Music,
  Crafting and Family are categories, and the actual projects (Mixing, building an
  SPD pad, Gardening) live inside them. The app already had that shape — it just
  called the levels *project* and *section*. So this is a vocabulary change and
  nothing else: **`Project` and `Project.tags` are unchanged in the code, the
  database and the route `/projects`**, because renaming those buys nothing and a
  URL change would break every link already saved. "Era" beat "Category" and
  "Area" because it fits both ends of the list — Family is an era, and so is
  Campervan, in a way neither is a category — and *"my campervan era"* is already
  how people talk. It is also the only dinosaur joke available that is a real
  taxonomy rather than a pun: geology nests Eras above Periods.
  **The assistant's prose was updated too** ([gemini/tools.ts](src/lib/gemini/tools.ts),
  [extract.ts](src/lib/gemini/extract.ts)) — if the UI says era and the model says
  project, a dictated "add this to Crafting" files against the wrong level. Tool
  NAMES and argument keys deliberately still say project: they are schema, not copy.

- **The dinosaur stickers** ([stickers.ts](src/lib/stickers.ts),
  [scripts/slice-stickers.py](scripts/slice-stickers.py)). Fifty-five characters cut
  out of four sticker sheets, in `static/dino/`. A project cover can be one, chosen
  from a searchable sheet; empty states pick one from their own text so a given empty
  state always shows the same animal. **They always sit on a tinted ground** — the art
  has near-black outlines and on this app's near-black page it loses its edges and
  becomes a smudge; the tint is the same hue-from-the-name already used for a project
  with no cover. This is the OPPOSITE division of labour from the Free Time scenes,
  where the dinosaur is artwork and the surroundings are hand-written geometry — here
  the whole scene is artwork. They are precached (740KB): the app is offline by
  default and a cover that renders blank on a train reads as data that has gone
  missing. **Percentage padding in CSS resolves against WIDTH on all four sides** —
  `p-[12%]` on the wide, short project banner left the dinosaur a centimetre tall.

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

- **An era never requires a project first, and everything can be filed afterwards.**
  Asked directly: should writing anything into an empty era prompt you to make a
  project? No — that is a required field, and spec principle 1 has none, ever. An
  era-level to-do is a valid resting state exactly like an unfiled idea. **But that
  only holds if it can be moved later**, and a to-do was the one thing that could
  not: its project could only be set at the moment it was typed, so everything
  written before the first project existed was stuck on the era for good. Tapping a
  to-do now opens the same "Belongs to" row the ideas list and the buy list use.
- **A control has to name what it acts on.** Removing a block meant finding "Edit" —
  small grey text beside a big dashed button, below the blocks, saying nothing about
  what it edits — and then a bare ✕ at the end of a row of three other unlabelled
  glyphs. Asked outright how a photo was supposed to be removed at all, twice. It is
  "Edit blocks" now, with the same weight as the button beside it, and "Remove
  block" on its own line, armed two-tap like the buy list because a block can hold
  the only copy of a photograph. Nothing about the capability changed; it was only
  ever findable if you already knew.

- **An uploaded photo had no height cap and swallowed the page.** A portrait shot
  off a phone rendered around 1300px tall, which pushed the block's own Edit and
  Remove controls, the three tabs and every to-do far below the fold — reported as
  "it sits there, I can't remove it or do anything with it". The photo was not
  stuck; it had eaten the screen. Capped at 240px with the full picture one tap
  away, which is what the full-screen viewer is for.

- **A project is a screen: one add button, everything folded**
  ([[id]/[tag]/+page.svelte](src/routes/projects/[id]/[tag]/+page.svelte),
  [Collapsible.svelte](src/lib/components/Collapsible.svelte)). One `+ Add` offers
  every kind — to-do, buy, note, photo/block, recording — and picking one unfolds
  that section and puts the cursor in its field rather than opening a form, so the
  fast path is still type-and-Enter. **To-dos open, everything else folded to a
  header with a count**, because fifteen to-dos used to bury the photograph under
  them. The fold state is per section per project in localStorage, deliberately NOT
  synced: which sections you left folded is a fact about this phone, and syncing it
  would let a laptop refold things on the device you were reading them on.
  **Opening a section from outside is a prop, not a localStorage write** — the
  first attempt reached in and set the key directly and did nothing at all, since
  the component only re-reads storage when the section changes.
- **A project inside an era has a name, a description and a colour**
  (`Project.tagColors` and `Project.tagDescriptions`, both keyed by name
  because that is what every `tag` field already points at — ids here would mean
  migrating five tables to fix the address bar). Assigned automatically on creation
  from a fixed palette so making one is still one tap and one field, changeable
  after; the description is optional and shows under the name on the era list and
  under the title on the project screen. `projectTagColor()` falls back to the
  project's POSITION in the era, so every project that predates colours already has
  one and no migration ran over anyone's data. **`renameProjectTag` carries both,
  and must do so BEFORE the tags change**: `setProjectTags` drops entries for names
  that are gone, so doing it after recolours the project at random on rename.
  Pinned by [notes.test.ts](src/lib/notes.test.ts).
  **The "+ New project" button was dead for two days** and nobody could have known
  why: the redesign that turned the era page into an index deleted the panel the
  button opened, while leaving the button and its `editingTags` flag behind, so it
  set a variable that rendered nothing. If a control does nothing, check that what
  it opens still exists before looking anywhere else.
- **There are exactly two places a to-do can be written, and the era page is not
  one of them.** Inside a project, where the era and project are already known;
  or Brain → To-dos, where the size, the era, the project and the date are all on
  the form. A to-do written at era level had no project and in practice no energy,
  so it reached Free Time as an unknown size belonging nowhere — which is how
  "I have twenty minutes" hands back half a day of work. **The era page is an
  overview**: every to-do in the era, grouped under the project it belongs to with
  that project's colour, showing its energy and date. Tapping one still sets those;
  only creating moved.
- **Energy is offered where to-dos are WRITTEN, not only where they are edited.**
  It could not be set anywhere at all before — not at creation, not after — only via
  a filter trick in Brain, voice capture, the importer or the assistant. The filter
  is only as good as how many to-dos carry a size, and nobody goes back through a
  list to add them. **Still optional**: an unset energy always PASSES the Free Time
  filter ([freetime.ts](src/lib/freetime.ts)), so nothing was ever hidden for
  lacking one — it just could not be ruled OUT of a short window, which is the
  actual complaint.
- **`type="button"` on every chip that lives inside a `<form>`, and it is
  load-bearing** ([EnergyPicker.svelte](src/lib/components/EnergyPicker.svelte)). A
  `<button>` in a form is `type="submit"` by default, so choosing a size in Brain's
  add form SUBMITTED it: the to-do was written the instant you said how big it was,
  before you could pick its era, project or date. Two ghost to-dos in testing before
  it was spotted.

- **A project inside an era owns EVERYTHING, not just to-dos.** `Widget.tag` and
  `BuyItem.tag` were the two that were missing, and the gap showed the moment the app
  was used for real: a schematic photographed for one build sat on the era itself,
  among every other build's blocks, with no way to move it or open it. Blocks and
  shopping now follow the chip exactly as to-dos, notes and recordings do — same
  rule, a chip shows only that project and no chip shows the whole era, and adding
  while a chip is lit files it there. **Renaming a project must carry all five**
  (to-dos, memos, note, blocks, shopping); miss one and it is not deleted, it is
  invisible, which is worse. Pinned by [notes.test.ts](src/lib/notes.test.ts).
  On All the era's to-dos are grouped under a heading per project, with untagged
  ones last — a flat list across an era with three builds in it reads as one pile,
  which is what it looked like when the grouping was missing.
  A photo block opens full-screen on tap (`object-contain`, never cover: it is
  usually a schematic and cropping it removes the part being looked at).

- **A section is a view of the whole project, not a filter on its to-dos.** The chips
  sit ABOVE the three tabs, so picking a song gives you that song's to-dos, that song's
  lyrics and that song's recordings — which is what the original voice-memo brief asked
  for. `Note.tag` makes lyrics-per-song work; renaming a section carries its to-dos, its
  note AND its memos, since missing any one silently detaches the lyrics from the song.
  Removing one leaves the note attached to the old name rather than merging it into the
  project note, which would overwrite it — recreate the section and the lyrics return.
  **The db v6 note is worth reading before touching that index**: a `&[projectId+tag]`
  compound looks right and is a trap, because IndexedDB skips a record when any part of a
  compound key is undefined, so every pre-sections note would drop out of the index meant
  to keep it unique. Matched in code instead.

**Still not built:** `Memo.place` is never filled in, deliberately — see the privacy
note above.

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
