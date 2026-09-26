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
  A MILESTONE IS NOT A STREAK and is allowed — see *What you have done* below for
  the line between them, which is that nothing a milestone produces can go down.
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
- **Untagged to-dos always pass BOTH Free Time filters** ([freetime.ts](src/lib/freetime.ts)).
  Capture sets neither field by design, so most to-dos have neither. Excluding unknowns
  would empty the pool and the Free Time flow would return nothing.
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

- **An idea is not a to-do, and it can live inside a PROJECT, not just an era**
  (`Idea.tag`, `Idea.becameProjectAt`, `ideaToProject` in store.ts,
  [IdeaList.svelte](src/lib/components/IdeaList.svelte),
  [ideas.test.ts](src/lib/ideas.test.ts)). Toon's words: *"I can have an idea
  for a new ear-training game but that doesn't mean it needs to be built right
  away. It might need more thought work or perhaps it's not a good idea after
  all. An idea can become a to do or even a project."* Ideas only ever filed to
  an era, so a thought about ONE project sat in a pile with every other project's
  — or got written as a to-do, which makes it something you are behind on from
  the moment it exists. Every project screen now has an Ideas section straight
  after its to-dos (the comparison being drawn), "Idea" is in its + Add sheet,
  and the era overview lists them all, because it promises to span everything.
  **Four ways forward, none required**: make a to-do (lands in the same
  project), make it a project, delete it (ideas had no delete at all — "not a
  good idea after all" had nowhere to go), or leave it be, which is the best
  of the four more often than not.
  **Becoming a project makes a SIBLING, never a child.** An idea filed inside
  "FreeTime" that becomes "Interval game" is created next to FreeTime in the
  same era. A project inside a project is the third level the depth rule
  forbids, and an idea growing into one is exactly how that level would sneak
  in — the form says so in a line of its own. The idea is not consumed: it is
  filed INTO the project it started and marked "started this project", and
  when the name is shorter than the idea (it usually is — a sentence is not a
  header) the full sentence becomes the project's description. Refuses a name
  the era already has, rather than merging, for `moveProjectTag`'s reason.
  **One component in three places**, like BuyList. Rows are tinted only where
  a list mixes projects; inside one project every row would wear the same
  colour, which says nothing and made the ideas look like a different kind of
  thing from the plain to-dos above them.
  The assistant can do all of it too — see the next entry.

- **The assistant files into projects, makes them, and writes their notes**
  ([gemini/tools.ts](src/lib/gemini/tools.ts), `add_project_to_era`,
  `idea_to_todo`, `idea_to_project`, `projectInEra` on every create and on
  `append_note`; [tools.test.ts](src/lib/gemini/tools.test.ts)). Asked for as a
  sentence to be able to say: *"inside coding era add a project named MTG
  simulator and in the notes write: app to create decks and simulate magic
  games."* It could not do any part of that: every write stopped at the era,
  and `create_project` makes an ERA and is told to refuse anything else.
  **`projectInEra` is a NAME, `projectId` is still the era.** Argument keys are
  schema and stayed; the new half says what it is. `projectId` also accepts an
  era's NAME, which is what lets one reply create an era and file into it
  before its id exists.
  **Names are resolved when the user taps Add, not when the model proposes.**
  That sentence is two proposals and the second is filed under something the
  first creates; resolving at proposal time would find no "MTG simulator" and
  put the note on the era. And `orderForApply` applies places before the
  things that go into them — create an era, add a project, grow an idea into
  one, then everything else — because "write this in the MTG notes, oh and
  make that project" is a natural thing to say and applied as spoken it files
  the note first. Stable, so the model's own order is kept within a rank.
  **A project name the era does not have is DROPPED, never stored**: a to-do
  filed under a misheard project lands on the era where it can be seen, instead
  of on a tag no screen shows. Matched case-insensitively and stored in the
  era's own spelling, because both speech-to-text and models lowercase.
  `add_project_to_era` will not make a second project of the same name, and has
  no way to put one inside another — a test asserts it has no such argument.
  The digest now lists each era's id and the projects inside it, which saves a
  query_state round trip before every write and is the only way the model can
  know a project's name at all. "In the notes write…" is `append_note`; a
  project's description is its one-line tagline — the prompt spells out the
  difference, since the example sentence says "notes" and a model left to
  itself reaches for the field called description.
  **Not verifiable from here:** the key lives only on Toon's devices, so the
  machinery is tested end to end against a stubbed Gemini (the example
  sentence's two calls come back as two proposals and write nothing), but
  whether the live model picks these tools reliably is only knowable by
  asking it.

- **Import defaults every project name to "leave unassigned"**. Auto-creating a project
  per workstream is how the old system grew nine projects of boilerplate.
- **There is a WEEKLY look-back, and it is the monthly summary's sibling, not
  a weekly view** ([weekly.ts](src/lib/weekly.ts),
  [WeeklySummary.svelte](src/lib/components/WeeklySummary.svelte),
  [weekly.test.ts](src/lib/weekly.test.ts)). Asked for as *"a week overview
  that shows your achievements when you open the app"*. The spec bans "weekly
  planning" by name, so this was checked against the rule rather than around
  it: planning looks FORWARD and sets something to fall short of; this looks
  BACK at what happened, which nothing can fall short of. The spec itself
  already does exactly that twice — the monthly arrival, and day-close showing
  "everything closed this week". The rules that keep it there are all pinned:
  **once a week**, on the first open on or after Monday, keyed on SHOWN like
  the monthly one ("when you open the app" taken literally is a greeting on
  every open, which is a nag); **silent when the week was empty**, marked shown
  so it is not re-checked; **no comparison, trend or target**; and **habits as
  days, never "out of 7"**, which would be a completion percentage wearing a
  disguise. What counts is the definition already argued for "where the work
  went" — closed, finished, bought, RECORDED — because for someone writing
  songs a hummed idea is the work of that day.
  **Never both summaries on one open.** When a month and a week turn over
  together the monthly goes first, and the weekly is not even asked for — so
  it is not marked shown either, and arrives on the next open that week.
  Grouped by era and project in the same two colours as Brain and Today, so a
  good week for the campervan is a patch of one colour before a word is read.
- **The monthly summary is keyed on being *shown*, not acknowledged**
  ([monthly.ts](src/lib/monthly.ts)). One that waits to be properly received comes back,
  and anything returning uninvited is a nag.
  **And both look-backs are asked for again when the app COMES BACK, not only
  at a cold launch** (`checkSummaries` in [+page.svelte](src/routes/+page.svelte)).
  Reported as the weekly review arriving on the laptop and never on the phone
  — and the giveaway was WHEN it arrived on the laptop: *"after signing into my
  Google account"*, which is a full-page redirect, which reloads the page,
  which is the only thing that runs `onMount`. An installed app on a phone is
  SUSPENDED rather than closed, so Monday morning it resumes with the same
  JavaScript in memory and nobody ever asks again.
  **Fourth time this shape**, after the calendar cache, the theme, the update
  check and the Google token: a device that has been asleep has to be told to
  look again. **Anything keyed on "a new day, week or month has begun" must be
  re-checked on the way back to the foreground.** Guarded so it cannot land on
  top of anything — not while another full-screen thing is open, not while a
  field has focus (this page carries the quick-notes box) — and it cannot nag,
  because both are keyed on having been shown.
- **The assistant never writes directly** ([gemini/tools.ts](src/lib/gemini/tools.ts)).
  Reads run immediately; writes are proposals until tapped. A test asserts every tool is
  deliberately classified — a write misfiled as a read would execute unnoticed.
- **Model output is validated, not trusted** ([gemini/plan.ts](src/lib/gemini/plan.ts)).
  Unknown id, duplicate, or an "obligation" with no date throws the whole response away
  and the deterministic path runs.

## Traps, found the hard way

- **Putting a route parameter INSIDE a liveQuery throws the subscription away
  when it changes.** The project screen's four queries all read by era; three
  then filtered by `tag` in plain code and one — the buy list — filtered inside
  the query callback. That made the whole liveQuery depend on `tag`, so a change
  rebuilt it. Invisible for months, because the only way to change the tag was
  to navigate to another project, and a route change remounts the component and
  rebuilds everything anyway. It surfaced the instant a project could be RENAMED
  from inside itself, which changes this page's tag WITHOUT remounting it: the
  To buy section went empty and stayed empty until a reload, while the data was
  perfectly correct the whole time — the worst kind, because the obvious
  suspicion is that the rename lost the items. **Query by the thing that does
  not change, filter by the thing that does.**

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

- **The recording screen shows a live level meter, because a clock only proves
  the timer is running** ([audio.ts](src/lib/audio.ts) `Recorder.level`,
  [MemoRecorder.svelte](src/lib/components/MemoRecorder.svelte)). Asked for
  straight after the microphone bug, and that is the right instinct: what you
  want to know is whether anything is going IN, which a silent recording
  answers far too late.
  **`level` is `null`, never a constant zero, when the browser will not give us
  an analyser.** A meter pinned at zero and a meter that does not exist look
  identical and mean opposite things, and "it is recording silence" is the exact
  fear this is here to settle — so no analyser means no meter on screen.
  **Peak, not average**: an average over a thousand samples barely twitches at
  speaking volume and would draw a flat line while the microphone works
  perfectly. **A strip of recent history, not one dancing bar**: a single bar
  has already fallen back to nothing by the time you look up, where two seconds
  of history shows that it heard the thing you just sang.
  The analyser's AudioContext is closed inside `releaseMic`, next to the tracks
  — a second thing capable of holding the iOS audio session open is precisely
  what the bug above was, so it exits by the same door.
  **rAF fires ZERO times in the hidden preview pane**, so the strip cannot be
  seen scrolling there; the analyser reading real signal WAS verified, by
  handing getUserMedia a real MediaStream from an oscillator and watching the
  bars land where the tone was loud. If this ever needs checking again, that is
  the trick — the preview browser refuses the microphone but not a synthetic
  stream.
  Not added to the brain-dump recorder in VoiceCapture, which still shows only
  a clock; `level` is available there for the asking.

- **A project can be MOVED to another era, and put to SLEEP inside one**
  (`moveProjectTag`, `setProjectTagSleeping`, `Project.sleepingTags`). Both came
  out of one question: an era holding a mixing course, a wedding covers set and
  twelve songs is four eras wearing one name, and twenty songs meant for one day
  drown the three being worked on.
  **Moving carries all six kinds** — to-dos, ideas, recordings, blocks, shopping
  and the note — exactly as renaming does, with the same warning: miss one and it is
  not deleted, it is invisible. Colour, description and sleep carry too, and
  they are written to the destination BEFORE the tags change, because
  `setProjectTags` prunes all three for names it cannot see — the same trap
  `renameProjectTag` documents.
  **It refuses when the destination already has that name rather than merging.**
  Two projects called "Mixing" silently becoming one cannot be undone without
  knowing which of the two each to-do came from.
  **Sleeping is the user's word about their own attention, never the app's
  guess.** Nothing infers it from a gap in activity — that would be the app
  deciding you had abandoned something, which is the line habits already hold
  with their three states. The era lists sleeping projects behind a plain
  "Show sleeping (2)", with no badge and no colour: you put them down on
  purpose, so the line exists to make them findable, not to make them felt.
  **Free Time stops offering a sleeping project's to-dos**, since an app that
  keeps suggesting the thing you deliberately shelved has ignored you — but the
  project still opens and every to-do in it still ticks. The app stops
  SUGGESTING and never forbids, the same asymmetry a blocked to-do follows.
  The sleep key is era id AND name, not the bare name: `tag` means a name inside
  ONE era, so a bare key would silence "Mixing" in every era at once. Pinned by
  a test.

- **A project can be FINISHED** (`Project.finishedTags`, `setProjectTagFinished`,
  `projectRecap`, [FinishProject.svelte](src/lib/components/FinishProject.svelte),
  [finished.test.ts](src/lib/finished.test.ts)). *"I just finished building a
  closet in our bedroom that was a big project. I would be satisfied if I
  could check that whole project off as completed or achieved."* A to-do could
  be ticked and a project could only SLEEP, which says "not now" about something
  that is done. Finishing is the project-sized tick.
  **It is a moment, not a flag.** Two beats: first what the project came to —
  started in March, 3 to-dos done, 1 thing bought — which is most of the
  satisfaction and also the confirmation; then the tick and a burst bigger than
  a to-do's. **Counts, never "3 of 4"**: that would be the banned completion
  percentage arriving at the exact moment it is least deserved.
  **It touches nothing inside.** A to-do still open when the closet is done
  stays open, and the screen says so once, plainly. Ticking loose ends on your
  behalf would fill the wins feed with things that were not done. Free Time
  stops suggesting them, exactly as for a sleeping project — the app stops
  offering, never forbids.
  **Finished projects are never hidden** (the hard rule on completed work): they
  leave the in-progress list for a "Finished" list on the era page that is
  always visible, unlike sleeping ones behind a tap, dated, most recent first.
  The project still opens, still takes new things, says "✓ Finished <date>"
  under its name, and "Not finished after all" undoes it. Finishing counts as a
  win (`winsSince`, so the monthly summary and day-close see it) and has its own
  line in the weekly look-back. The assistant has `finish_project`.
  Finishing takes a project out of sleep: finished and set aside are different
  things to say about one project.
  **The first finish card was too quiet, and came back from a real phone as
  *"kind of boring for a finished project. At least show me a funny dino that
  has some funny remark."*** The burst was over in under a second, so the card
  was read after it had gone, and what remained was a heading and some counts —
  quieter than a ticked to-do on Today. Now ([finishCheers.ts](src/lib/finishCheers.ts)):
  one of the STICKER dinosaurs pops in and wiggles on a ground tinted in the
  project's colour, with a line written for that sticker ("Standing on a
  rainbow. Structurally unwise. Emotionally essential."), and confetti falls
  across the whole screen for about four seconds. Only stickers that read as
  celebration; never the same one twice running, remembered across opens; the
  jokes are about the dinosaur, never at your expense, and a test checks the
  lines for "should", "finally" and "about time". Picked at the moment of
  finishing, so backing out with "Not yet" does not use one up.
  **Both steps are the WHOLE SCREEN, not a sheet.** They shipped as a bottom
  sheet like every other pop-up, which takes only the height it needs — right
  for "Add to project", and it left the top half of the phone empty for the
  best moment the app has: *"Why is it only using half of the screen?"* Now the
  project's colour washes down from the top, the content is centred (a big
  tick in the project's colour to confirm; a 240px dinosaur to celebrate), and
  the button sits at the bottom where a thumb already is. No tap-outside to
  close, since there is no outside. The pop is on
  `transform` and the wiggle on the separate `rotate` property, so the two
  animations do not fight over one property; all of it goes under
  `prefers-reduced-motion`.
  **Renaming a project used to wake it up**, found while carrying the new
  field: `renameProjectTag` carried colour and description but not
  `sleepingTags`, which `setProjectTags` then pruned for the old name. Rename
  now carries sleep and finished both, and a test pins each.

- **The era and project live in the Drive FILENAME, not in a folder tree**
  ([memos.ts](src/lib/memos.ts) `fileName`, [sync.ts](src/lib/sync.ts),
  `Memo.driveName`). Asked as *"would it be an idea that the google drive folder
  gets structured like our app"* — and the answer is the name, which does the
  same job for a fraction of the moving parts. A file is
  `Weddings – Cover- Valerie – 2026-08-14 22.40 – key check.m4a`: era and
  project FIRST, so a flat folder groups itself and Drive's own search finds
  every recording for one song without the app.
  **Why not folders.** A tree is a second index that has to stay true. Rename an
  era and every file underneath has to move; re-file a memo and a file moves;
  do either offline or on two devices and the tree is half-moved and no longer
  matches the app — which is the app's data claiming to be somewhere it is not.
  Correcting a NAME is one metadata patch on one file (`renameFile`), and a
  failed patch leaves the audio exactly where it was.
  **Names are kept true afterwards**, since a memo filed a week later or an era
  renamed both change the answer, and a file named after the old one is worse
  than one named nothing because it reads as fact. `driveName` remembers the
  current name so this costs a string compare rather than fetching every file's
  metadata every sync. Memos uploaded before this get renamed once, which is the
  migration.
  **A rename is SKIPPED when the era cannot be resolved locally.** A memo
  pointing at an era whose record has not arrived on this device resolves to no
  era, and renaming on that would strip the era from the file — then the device
  that does know would put it back, and the two would take turns renaming the
  same file forever. The generic table loop runs before `syncMemos` and brings
  the eras down first, so the gap is small; small is not closed.

- **The memo LIST can be searched, ordered and filtered, and a memo can be
  re-filed afterwards** ([MemoList.svelte](src/lib/components/MemoList.svelte),
  `controls`). The MAP had a project filter and a period filter from the day it
  was built and the list had neither, which is backwards: the map answers
  "where was I", and the list is where you go already knowing what you want.
  **Search matches everything a row can show**, not just the title — era,
  project, place, the ISO date and the readable one — because most memos never
  get a title, which is the entire point of capturing when and where without
  asking. Title-only search would miss almost the whole library.
  `controls` is off by default: the same component draws the whole library in
  Brain, one project's recordings, and the handful behind a map pin, and a
  search box over four recordings is furniture.
  **Re-filing was the real gap.** A memo could only be given an era and a
  project in the panel that appears the moment you stop recording — the exact
  trap to-dos were in, against a principle already written down here: nothing
  has to be filed at capture, but that only holds if it can be moved later. You
  hum something in a car park; which song it belongs to is not knowable for
  another week. The "Belongs to" row is now in the row editor, same shape as
  ideas and buy items.

- **A live microphone track poisons playback on iOS, and the symptom looks like
  a broken recording** ([audio.ts](src/lib/audio.ts) `stop`,
  [audio.test.ts](src/lib/audio.test.ts)). Reported as a memo that would not
  play back, then — the message that solved it — *"I just closed the app on my
  phone and reopened it, now it plays back"*. A relaunch fixing something is
  proof it is STATE, not the file: the blob was fine all along.
  The mic was released only inside `onstop`, and the other branch — taken when
  the recorder has ALREADY stopped by itself — resolved the blob and left the
  capture live. A MediaRecorder stops by itself whenever its track ends
  underneath it: a phone call, Siri, another app taking the microphone, iOS
  suspending a backgrounded PWA. iOS then keeps the audio session in RECORD mode
  for as long as any track is live, so everything played afterwards goes to the
  earpiece or nowhere, until the app is relaunched. The recording saves
  perfectly the whole time, which is what makes it so hard to see.
  **Every path out of `stop()` must release the microphone.** Pinned by a test
  that fails against the old branch — checked by reverting the fix.

- **Pressing record empties every memo player, and holds the remote buttons
  while the mic is live** ([audio.ts](src/lib/audio.ts) `setLive`,
  [MemoList.svelte](src/lib/components/MemoList.svelte) `unload`). Found in a
  car: *"while I was recording another recording started playing"*. Opening
  the microphone over Bluetooth switches the car from its music profile to its
  call profile — the only one with a mic — and many head units answer a
  profile change by sending PLAY, which iOS hands to whatever this app last
  played. On a project page or Brain that was the memo list's player, still
  LOADED with the last take opened: `close()` only paused it, and nothing
  closed it when recording started. The car was being a car.
  Now `startRecording` announces itself BEFORE getUserMedia (that is the
  moment of the switch), every MemoList closes its row and empties the source
  — a paused player is still a resumable one — and the page claims the Media
  Session buttons with no-ops, so a stray PLAY lands on nothing. The claim is
  held 4s past release, because switching BACK sends another PLAY.
  **The flag must drop on every path out**, including a refused microphone and
  a MediaRecorder that will not construct (which also used to leave the mic
  open — the same leak class as the entry below). Stuck on, it would swallow
  the lock screen's buttons for good. Pinned in
  [audio.test.ts](src/lib/audio.test.ts).
  Not done, and worth knowing: over car Bluetooth the recording itself comes
  from the CAR's microphone, on a call-quality line. Fine for a hummed idea;
  not a take.
- **A memo is KEPT, so it has to play back, which is a different requirement
  from being recordable** ([audio.ts](src/lib/audio.ts) `KEEP_ORDER`). The mime
  list was written for the brain-dump path — its comment says "something
  MediaRecorder will produce and decodeAudioData will read back", both true of
  WebM — and the memo path was handed the same list. But a memo has to play in
  an `<audio>` element on every device it syncs to and straight out of Drive,
  and **Safari will not play WebM at all**, so a memo recorded on a laptop is a
  silent row on the phone. `startRecording({ keep: true })` prefers mp4/AAC, the
  one container everything plays; the transient brain-dump keeps Opus, which is
  better per byte and is re-encoded to WAV before it goes anywhere.

- **Several memos share in one go** ([memos.ts](src/lib/memos.ts) `shareMemos`,
  `uniqueNames`, [MemoList.svelte](src/lib/components/MemoList.svelte) select
  mode). *"Can we make sharing multiple memos at once a thing?"* — four takes of
  a chorus to a bandmate were four trips through the share sheet. The Web Share
  API takes an array of files and iOS sends them as one message. "Select" sits
  in the Search & order header in Brain, or on the first month's heading row
  elsewhere (a lone Select row would repeat the awkward-Export mistake); rows
  get a tick instead of a play button, and a sticky bar at the BOTTOM of the
  list carries Share, because picking goes down a long library.
  **The tap that shares must not wait on the network.** Safari opens the share
  sheet only while the tap that asked is still live, and an `await` on a Drive
  download in between can spend it — the sheet then silently never appears.
  So `shareMemos` builds the files synchronously from blobs in hand, and when
  any picked memo is not on this device the button first says "Fetch N"; the
  download completes, and Share is a second, fresh tap.
  **Names are de-duplicated**: two untitled takes in the same minute get the
  same Drive-style name, and a share sheet or downloads folder given two
  identical names keeps one. The second becomes "… (2).m4a". Where multiple
  files cannot be shared, each downloads a moment apart, since browsers refuse
  a burst of simultaneous downloads as spam.
  **The hidden preview pane stops REPAINTING**, not just animating: screenshots
  there can show a state several changes old while the DOM is correct. When a
  screenshot disagrees with `innerText`, trust the DOM.

- **A dead player and a dead Share button both used to say nothing at all**
  ([MemoList.svelte](src/lib/components/MemoList.svelte) `describeFailure`). An
  `<audio>` element fails by firing `error` and then sitting there, and
  `shareMemo` returning 'unsupported' produced an empty note — so a recording
  the browser could not decode gave silence, a dead scrubber, and nothing in the
  console. Both now say what is wrong and NAME THE FORMAT AND SIZE, because "the
  file is damaged" and "this browser will not play WebM" need opposite fixes and
  are otherwise indistinguishable from the outside.

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
- **Gemini 3 refuses a tool round-trip that does not echo its thought
  signature** ([assistant.ts](src/lib/gemini/assistant.ts),
  [assistant.test.ts](src/lib/gemini/assistant.test.ts)). Reported as the
  assistant dying with *"Gemini 400: Function call is missing a
  thought_signature in functionCall parts"*. The model puts an opaque
  `thoughtSignature` on the first function call of a turn, and when that turn
  is sent back as history — which the assistant does every time it looks
  something up — the signature must be on the same part, untouched. The loop
  rebuilt the model's turn from `{name, args}`, which drops it, so every
  question needing `query_state` failed. Gemini 2.5 tolerated this; the model
  change is what made it fatal. **Send `GenerateResult.parts` back verbatim;
  never reconstruct model parts.** Beside it, a second rule the old loop broke
  too: every function call needs a `functionResponse`, in order — it answered
  only the reads, so a lookup plus a write in one turn would have 400'd the
  same way. Writes and navigations are answered with what happened to them
  (proposed / offered), which also stops the model calling them again.
  Only prior turns from EARLIER messages may be text-only, which is why
  Assistant.svelte's history can keep just the reply.
- **`Error 403: access_denied` at sign-in is a missing test user, not verification.**
  Applies only while the app is in Testing mode; it has been published since
  September 2026, so the test-user list no longer gates anything. Kept because
  moving it back to Testing brings this failure back with it.
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

- **A CSS animation with no `fill-mode` snaps back to the element's STATIC
  style the instant it ends.** Reported as *"it flickers at the end of the
  buttons"*, and it was exactly that: the shine ran 1500ms while the class that
  carried it stayed 1600ms, so for the last hundred milliseconds the
  pseudo-element fell back to its own rules — which declared no `opacity`,
  meaning 1 — and a fully lit band flashed into view at its default position.
  Any animation that fades something in must ALSO declare the resting state on
  the element (`opacity: 0`) and use `animation-fill-mode: both`, or there is a
  frame at each end showing whatever the base rules happen to say. The gap only
  has to be one frame to be seen.

- **A Svelte `$state` ARRAY cannot be written to IndexedDB.** It is a Proxy,
  and a proxy cannot be structured-cloned, so `db.todos.add()` throws
  `DataCloneError: [object Object] could not be cloned` — and the add form
  clears itself either way, so the to-do simply never appears and nothing on
  screen says why. Found by watching the console, not the app. `repeatDays` is
  the first ARRAY a form writes, which is why this never came up before;
  `createTodo` copies it, and the store is the right place for that because
  every caller would otherwise have to remember. **Unit tests cannot catch
  this** — they pass plain arrays — so any new array field needs a run through
  the real form.

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

- **"Touched" means INTERACTED WITH, not finished** (`projectPulses` in
  [queries.ts](src/lib/queries.ts), [pulse.test.ts](src/lib/pulse.test.ts)).
  The line under an era's name on the Eras card is the pulse, and it used to
  count only the most recent COMPLETED to-do plus a note's date — so an era
  filled with a dozen to-dos still read *"nothing yet"*. Reported as a
  question: *"I added some to-dos to them, I thought that would remove the
  nothing yet — so what does it stand for?"* The answer is Toon's own:
  *"interacting with an era — adding projects, to-dos, to-buys, memos — is
  part of planning for something and is work towards that era."*
  It now takes the latest of everything that happened in there: a to-do
  written or ticked, an idea written or finished, a thing wanted or bought, a
  recording made, a note or a block edited, and the ERA RECORD changing, which
  is what adding, renaming, recolouring or reordering a project inside it does.
  **The era's own creation is the one exclusion**, and it is what keeps
  "nothing yet" meaning anything: count it and every era reads as touched from
  the moment it exists, so the state could never be seen. `updatedAt >
  createdAt` is "something has happened to this since it was made".
  **ONE definition, four readers, and broadening it moved all four on
  purpose.** The card; the assistant's digest; the *"you haven't touched X in
  a while — on purpose?"* question, which used to ask that about an era filled
  last week; and **Free Time's neglected slot**, which will no longer resurface
  an era you have been actively planning in. That last one is the real change
  and it is the intended one — the slot exists to bring back what has gone
  quiet, and an era you were writing into yesterday has not. If a split is ever
  wanted, `closedLast30` is already the "what came out" measure and is the
  place to start, not a second timestamp.
  **Found while looking: the note half took the FIRST note it found for the
  era**, not the newest. An era holds a note per project since sections
  existed, so it reported an arbitrary row's date — usually not the one last
  written in. Every note in the era is considered now.
  Reading six tables here is what keeps it live — a liveQuery only re-runs for
  the tables it actually read. Memo blobs cost nothing to scan: IndexedDB
  hands back a reference to the stored bytes rather than the bytes.
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
  **A take can be discarded from the panel it just saved into.** Stopping still
  saves with no confirm and no required field — that stays, because a recorder
  which asks a question before keeping your idea can lose it — but the cost of
  that choice is a botched take already on disk, and the only way to remove one
  used to be leaving, finding it in Brain and deleting it there. *"When I messed
  up a song"* deserves an answer on the screen you are already on. Armed
  two-tap like every other delete of audio, and it lands back on the record
  button rather than closing, because messing one up is nearly always followed
  by going again.
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
- **A to-do can be re-filed after it is written, which it could not be**
  (Brain → To-dos row editor, "Belongs to"). Reported directly: *"I just added
  a to do in the to do page. But after adding it, I cannot seem to associate it
  with a project."* Exactly right, and worse than an oversight — this file
  already claimed it worked, under *An era never requires a project first*,
  because the fix landed on the PROJECT screen's rows and never on Brain's. The
  add form asks for era and project; the row editor then offered the title, the
  order, the date, both sizes and a photo, and no way to say where it lives.
  **Changing the era clears the project**, because a project name belongs to
  one era — carrying "Mixing" from Music into Garden would point at a project
  that does not exist there, which is the invisible-not-deleted failure that
  renaming already warns about.
  **If a capability is claimed in this file, check the screen that was
  reported, not the one you fixed.** Second time: `uncompleteTodo` existed and
  no screen called it.

- **Brain's filters fold away, and rows are colour-coded by where they live**
  ([Controls.svelte](src/lib/components/Controls.svelte),
  [colors.ts](src/lib/colors.ts)). Asked for as decluttering. Brain opened as a
  control panel — three selects and a toggle over To-dos, a search box and two
  more over Memos — read past on every visit, competing with the list you came
  for. Same instinct, and the same answer, as the add field that starts closed.
  **THE SUMMARY IS THE LOAD-BEARING PART, not the fold.** Hiding a filter makes
  the app's oldest trap easier to reach: a filtered list that does not say so is
  how you come to believe your other to-dos have gone. So the folded header
  names whatever is on — "Filter · Coding · closed shown" — in the accent, and
  the state is deliberately NOT remembered between visits, because a filter you
  cannot see and did not set today is that same trap with a longer fuse.
  **The dot is derived, never stored**: a project's own colour when it has one,
  the era's name-derived hue when it only has an era, nothing when it is
  unfiled — and unfiled must keep looking like a valid resting state rather
  than a mistake. `eraHue` moved out of ProjectCover into colors.ts so a dot in
  Brain and a card on Eras cannot disagree. It leads the row, ahead of any
  photo, because a column of dots is scannable and dots at varying x positions
  are not — the same finding as the Today picker.
  **The dot became the whole row a day later, and the row needs TWO colours.**
  Asked for as *"you can color the whole box, not just give them a color dot. I
  like that you can visually quickly see what to-dos kind of belong to the same
  things"* — a different question from "which project is this": it is about
  grouping, and a wash of colour is what answers grouping at a glance.
  The wash is the PROJECT's colour and the left edge is the ERA's, because a
  project's colour is only unique inside its era — the palette restarts for
  each one, so the first project of Campervan and the first project of Coding
  are both orange. On a project screen that never mattered; Brain shows every
  era at once, where two identical washes would claim a kinship that is not
  there. Fill says which project, edge says which era, and the pair stays
  distinct when the fill does not (`.row-tint`, `--row` and `--edge`). Mixed
  into the surface rather than laid over it, so it darkens on paper and
  lightens on ink like every other surface token; checked in both themes.
  **Today's cards wear the same two colours**, from the same `tintFor` in
  colors.ts, so a to-do does not change colour between screens. Only while
  open: a finished card turns green, and a project wash over that would bury
  the one colour on the page that means something. A full `.card` needs its
  own `.card.row-tint` rule, because box-shadow is one property and the edge
  would otherwise replace the card's highlight and drop shadow and leave the
  tinted cards looking flat beside the plain ones. The walking dinosaur still
  paints above the tint and below the text.
  **Buy items wear the same two colours** (`BuyList` `tinted`, on in Brain →
  Buy and the era overview, off inside a project where every row would match).
  *"When I filter for eras I have a nice overview with things with the same
  colour together"* — colour only clusters if the ORDER does, so with an era
  filter on, or grouped By era, Brain sorts by place first (era order, then
  the era's project order, era-level after, unfiled last) and only then by
  bought/needed/recent. Recent across all eras stays pure recency, because
  that is what the word promises. Rows now name the project as well as the era.
  **Brain → To-dos does the same** once an era is picked (`byProjectThenNewest`):
  project by project in the era's order, era-level after, newest first within
  each. A day list keeps its own dragged order.
  **And Brain can be narrowed to ONE PROJECT** (`fTag`, the "Era or project"
  select). Asked for with the export in mind: *"I would like to filter by
  project from within the Brain to-dos so I can also export those specifically
  from there. Right now I have to go into that project and export there."* The
  export already takes the list exactly as narrowed, so the filter IS the
  feature — nothing about Export changed.
  **One control for both levels, not a fourth select.** Each era with projects
  becomes an optgroup holding "All of <era>" and then its projects, so the
  panel stays one row — a filter panel taller than the list it filters is the
  clutter the fold was meant to remove. Option values carry the era id with the
  name, since a project name is only unique inside its era.
  Narrowed to one project the sort drops back to `byRank`: every row would
  carry the same heading, so grouping by project says nothing and the order
  that matters is the one you dragged them into.
  **The four kind-tabs carry the same palette** (`SECTION_TABS`), muted when
  unselected and filled when on, so Brain reads as coloured without four
  full-strength labels shouting over the list underneath.
  **And the filter panel is exactly one row**: three selects sharing the width,
  with "Closed" moved up beside the header, because a filter panel taller than
  the list it filters is the clutter this was supposed to remove. The labels
  are short ("Energy", "Date") since "Any energy" and "Dated or not" were
  written for a full-width row that no longer exists. They cannot simply be set
  smaller — any form control under 16px makes iOS zoom in and never zoom back,
  which is a trap recorded above.

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

- **A to-do can carry a photo, and it is the SAME control a buy item uses**
  (`Todo.image`, [PhotoPicker.svelte](src/lib/components/PhotoPicker.svelte),
  [PhotoThumb.svelte](src/lib/components/PhotoThumb.svelte),
  [PhotoViewer.svelte](src/lib/components/PhotoViewer.svelte)). Asked for from
  a real morning: a screenshot of something broken, a to-do written about it,
  and nowhere to put the screenshot. Shopping photos already worked and had
  worked for months — the gap was to-dos, and the work was mostly EXTRACTING
  what BuyList already had so the two cannot drift into offering different
  things in different places.
  Four surfaces show it: Brain, the project screen, the era overview and a
  Today card. **On Today the thumb sits opposite the tick and is smaller than
  it (40 vs 44), so a card with a photo is exactly as tall as one without** —
  measured at 375×812, both 106px. That page has to stay calm.
  **A thumbnail must be a SIBLING of the row's own button, never inside it.**
  Every one of these rows is a big button that opens the editor, and a button
  inside a button is invalid — the inner one silently stops working.
  **THUMB_EDGE, the same cap as a shopping photo, and the cap is the load-
  bearing part.** These ride inside `todos.json`, which the generic sync
  re-uploads WHOLE whenever any to-do changes — so a phone photo left at full
  size would put 4 MB on the wire every time anything is ticked. At 480px a
  screenshot lands around 5 KB. If these ever grow into the hundreds, the fix
  is to move photos into a file of their own, NOT to raise the cap: to-dos are
  never deleted, so their photos accumulate forever by design.
  `PhotoThumb` owns its own viewer rather than reporting the tap upwards,
  because every list wants the identical thing to happen and a list holding its
  own `viewing` variable is a list that can forget to render the overlay.

- **A project can be exported: as text to paste, or as a page to print**
  ([export.ts](src/lib/export.ts), [ExportSheet.svelte](src/lib/components/ExportSheet.svelte),
  [print/+page.svelte](src/routes/projects/[id]/[tag]/print/+page.svelte),
  [export.test.ts](src/lib/export.test.ts)). Asked for with two uses at once:
  printing a project out on the day you finally work on it, and *"right now I
  have to manually type over my coding to-dos from FreeTime to Claude Code"* —
  then *"export only to-dos etc."* **One collection, two outputs**: the text and
  the page are built from the same `ProjectExport`, so they cannot list
  different things. The text is MARKDOWN because both destinations already read
  it — `- [ ] Card database` is a checklist to Claude Code, a notes app and an
  email alike. Sections are chosen, with the two asked-for cases one tap each
  ("Everything", "Just the to-dos"), and the choice is remembered per device
  because the Claude Code export is a thing you do again tomorrow. Finished
  to-dos are off by default: a printout for getting on with it lists what is
  left. The preview IS the text, byte for byte, which also makes it the
  fallback when the clipboard is refused — the text is selected for you.
  **Printed by the browser, not a PDF library.** Save as PDF is in every print
  dialog including the iPhone share sheet; a library would be a third runtime
  dependency producing a worse document than the browser's own typesetting.
  The page is paper — literal black on white — in both themes, since a dark
  preview of a white printout previews nothing; boxes are real boxes to tick
  with a pen, and the project's colour is one rule under the title, because
  tinted rows print as grey mud on a mono printer.
  **Printing the app shell prints ONE page**, and that is a trap worth knowing:
  the shell is a viewport-tall flex box whose `<main>` scrolls inside itself,
  so the printer sees one clipped screenful. The `@media print` block at the
  end of app.css un-windows it (auto height, overflow visible) and drops the
  tab bar, rail and notices. Verified that the rules parse; the print dialog
  itself cannot be opened from the preview pane, and nor can the clipboard, so
  both need checking on a real device.
  **A new dynamic route needs its own `prerender = false`.** The layout
  prerenders everything, and a route under `[id]` that nothing links to at
  build time fails the build ("marked as prerenderable, but were not found
  while crawling") — which fails the deploy. Every sibling carries the one-line
  `+page.ts`; the print route did not at first.
  **Brain's lists export too, as they are on screen**
  ([ListExport.svelte](src/lib/components/ListExport.svelte), `listToMarkdown`).
  Brain cuts across eras, so the useful export there is not a project but the
  list as narrowed — filtered to Coding it is the Coding to-dos, on a day list
  it is that day. The rows are handed in by the page already showing them and
  the export runs no query of its own, so it cannot list something different
  from what you tapped Export on. Grouped under "Era · Project" headings,
  unfiled last, because pasted without the colours a list across eras reads
  as one pile. Copy, Share and the preview are one component,
  [ShareText.svelte](src/lib/components/ShareText.svelte), used by both
  exports so they cannot copy or fail differently.
  **Brain's lists print too** ([ListPaper.svelte](src/lib/components/ListPaper.svelte),
  [PaperOverlay.svelte](src/lib/components/PaperOverlay.svelte), `totalsOf`).
  Asked for with the shopping list in mind: *"to-buys separated for all
  projects, with quantity, cost and total cost for all things within a project
  and also total cost across everything."* So the buy printout is a table —
  box, item (with the shop's domain under it), qty, each, total — one per
  project, each with a subtotal, and a grand total at the foot. Only what is
  STILL to buy: it is carried round a shop with a pen, and bought things would
  inflate the totals it exists to give. To-dos and ideas print as checklists
  and bullets under the same headings.
  **Printed totals are honest in two ways the screen is not.** Per currency,
  never blended — the on-screen list sums everything as one currency, which
  holds while it is all euros, but a printed total is read as THE number and a
  single dollar price would silently become euros inside it. And unpriced items
  are counted beside the number ("1 without a price, not included"), because a
  total over five things of which one has no price is not the cost of five.
  **No URL for these, unlike the project printout**, and that is deliberate:
  Brain's list is whatever the filters said at that moment, and a print route
  would have to re-run the filters — a second copy of the rules that could
  quietly disagree with the list you tapped on. So the paper is drawn from the
  rows already in hand, laid over the app. It is PORTALLED to be a direct child
  of <body> (`lib/portal.ts`), because the one print rule that reliably means
  "print only this" is `body.paper-open > :not(.paper-overlay) { display:none }`,
  which needs it to be one of body's children rather than buried in the
  scrolling shell.
  **Groups sort by era and then by the era's own project order**, for paper and
  text alike (`groupByPlace`). They were in first-appearance order, which from a
  newest-first list printed Campervan, Coding, Campervan, Coding.
  **Separate tables need `table-layout: fixed` and set column widths**, or each
  sizes itself to its own contents and Qty lands at a different x in every
  project, so a page of prices cannot be read down. And `.paper-box` is
  `inline-block`: inside a table cell an inline span ignores its width and
  height and prints as a hairline.
  **The document title is restored even when it was empty** — the app normally
  has none, and `if (previous)` skipped exactly that, leaving the browser tab
  named after the last printout.
  **Export lives on each list's FILTER row, never on a row of its own** — on
  To-dos beside "Closed", on Ideas pinned at the end of the era chips (outside
  the scrolling part, so a long list of eras cannot push it off screen), on Buy
  at the end of the era select. It first shipped on its own right-aligned row
  above Ideas and Buy and came back as *"a bit in an awkward place on the
  phone. It sits on a row all by itself"* — a lone control on a row reads as a
  leftover, which is the Ask-button lesson again. The filter row is also where
  it belongs by meaning: it is the row that says what the list is narrowed to,
  and the export is exactly that narrowed list.
  **Its first deploy failed on CI and not locally, for a reason worth
  keeping.** Two to-dos created back to back shared a millisecond on GitHub's
  faster runner, so `readyFirst` — sorted by chain depth, then `createdAt` —
  had a tie, and fell back to database order, which follows random ids. The
  test gate caught it before anything shipped. `readyFirst` now ends on `id`,
  so a tie is arbitrary but identical everywhere: the screen and an export can
  never list the same project in two orders. **A sort that a person's eye
  depends on needs a total order**, and tests that create rows back to back
  should set `createdAt` explicitly rather than trusting the clock to move.

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
- **Today's capture row is gone, and the assistant is what is left of it**
  ([AskBar.svelte](src/lib/components/AskBar.svelte); CaptureBox.svelte is
  deleted). The two entries below describe that row and are kept because their
  reasoning still applies wherever capture lives — but the row itself was
  removed, on the plainest possible grounds: *"I don't have the reflex to just
  add a random thing and then assign it later. If I have a to-do for a project
  in Family, I just go there and add it there."* A prominent field nobody types
  into is furniture, and it was furniture at the bottom of the one screen that
  has to stay calm — the screen whose hero was already shrunk once for pushing
  habits off the bottom.
  **Spec principle 1 is untouched and that had to be checked, not assumed.**
  "Capture takes one field and no required fields, ever" is a hard rule about
  the APP, not about the Today screen: Brain → Ideas still takes a thought in
  one field with no required fields, and the project chips there file it if you
  want. What moved is which screen carries it.
  **The assistant stays because it was named as the one thing worth keeping** —
  "so you can talk to it and make it add stuff wherever you want", which is the
  same instinct as walking to the project, with the walking done for you. It
  was also the only thing in that row with nowhere else to live; the kept-audio
  recorder is one tap away at Brain → Memos, and the brain-dump recorder is
  inside the assistant itself.
  **It is a round floating button, and the first attempt was not.** It shipped
  as a small labelled button sitting alone in the bar the capture row used to
  fill, and came back as *"a sad little button now that sits at the bottom. It
  feels very out of place"* — fairly: a bar exists to hold a ROW of things, so
  a bar holding one thing reads as the leftovers of something taken away. A
  circle floating over the page means one action and implies no missing row,
  and it hands Today back its full width instead of spending a hairline and a
  band of glass on a single button. Deliberately small and quiet beside the
  Free Time circle: this screen has one hero and it is not this.
  **And it can be dragged anywhere**, because a fixed corner is always over
  somebody's content — which strip of the page it covers depends on the hand
  holding the phone and on what is on the day. Press and drag to move; a press
  that moves under 8px is a TAP, and without that slop every slightly wobbly
  tap would read as a tiny drag and open nothing. It settles against the
  nearer side (parked mid-screen it would sit over the middle of every card)
  and remembers side and height in localStorage, per device and never synced:
  where a thumb reaches is a fact about that phone. Clamped above the tab bar
  and re-clamped on resize, so a spot chosen in portrait cannot strand it off
  screen in landscape. `touch-action: none` is load-bearing — without it the
  browser takes the drag as a scroll and the page slides under a button that
  stays put.
  **In the hidden preview pane the settle animation never finishes**, so the
  button measures at its old spot while its style already says the new one.
  A reload applies the saved position with no transition and shows the truth.
  It is hidden entirely without a Gemini key
  like every other AI surface — so with no key Today simply has nothing at the
  bottom, which is the decluttered state anyway. **If the capture field is ever
  wanted back, it is one component and one line in Today**, and the argument
  for it is spec principle 1's speed, not habit.
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
- **A to-do list pasted straight back from the export, and all six done** —
  the export's first real use was Toon pasting FreeTime's own Coding to-dos
  into Claude Code. The six, and what each turned out to need:

  **Long entries grow instead of scrolling sideways** ([autogrow.ts](src/lib/autogrow.ts)).
  *"Horizontal scrolling in a tiny bar while doing the entry is not very
  practical"*, and the same of the assistant's box after a dictation. The add
  field, the rename field and the assistant's input are one-line textareas that
  fit their content (`field-grow` keeps one line at exactly the 44px an input
  was, so nothing that stays short changes height). **Enter still submits** —
  a to-do is a title, and a newline would break type-Enter-type-Enter — and
  pasted line breaks are flattened with `oneLine`. The value is the action's
  parameter only so the height re-fits when text changes from outside (cleared
  after Add, a transcription appended), which fires no input event.

  **Dictation you can WATCH** ([speech.ts](src/lib/speech.ts),
  [speech.test.ts](src/lib/speech.test.ts)). *"Can we not have the audio write
  down what you are saying almost in real time, like when you have a chat with
  an AI, instead of recording a whole thing and having it analysed after?"*
  Where the browser has `SpeechRecognition`, the words now stream into the box
  as they are spoken — which also deletes the wait described in the entry
  below, because there is no round trip left to make faster.
  **The Gemini path stays and is not a legacy branch.** It is what runs where
  the recogniser is absent, and the hard rule requires it anyway: every AI
  feature keeps a working path that is not this one.
  **A recogniser that EXISTS is not a recogniser that WORKS**, and the device
  to worry about is an installed web app on iOS — the most-used one here and
  the most likely to answer with a flat refusal. So `liveDictation` is state,
  not a constant: if the live path fails before a single word arrives, it drops
  to false and the recorder path takes over ON THE SAME TAP, so the failure
  costs a moment instead of the feature. A refused microphone is excluded from
  that, since falling back would only ask for it again.
  **Interim results are reported as interim.** A caller that treated a guess as
  final would leave half-heard words in the box when the recogniser corrected
  itself; settled text and the guess in flight are separate, and the box is
  rebuilt from both.
  **It restarts itself.** Every implementation ends the session after a pause
  and `continuous` only lengthens the fuse, so a pause to think would otherwise
  end dictation silently. Restarted only while the caller still wants to
  listen, or it would be an unkillable microphone; a refused restart is treated
  as the end rather than looped on.
  **It is not offline**, unlike the rest of the app — Chrome and Safari both
  send the audio to their own service — and it listens in ONE LANGUAGE, which
  is why Settings has a Dictation picker. A Dutch phone asked to hear English
  produces confident nonsense and nothing on screen would say why. It follows
  the device by default.
  It announces the microphone through `announceMic`, the same signal the memo
  recorder sends, because the car that sent a stray PLAY does not care which
  API opened the mic.
  **Not verifiable from here**: the preview pane refuses the microphone, so the
  streaming has only been exercised against a stubbed recogniser. Whether it
  works in the installed iOS app is knowable only on the phone.

  **Dictation: faster, and visibly busy.** *"It takes anything between 5 and 20
  seconds for your vocal prompt to show up so sometimes it feels like it didn't
  work."* Two causes, two fixes. The wait was mostly Gemini 3 THINKING about a
  transcription, which has nothing to think about: `generate({ thinking:
  'minimal' })` now asks it not to, and if a model ever refuses that setting
  with a 400 naming it, the request is retried without — an optimisation must
  cost one retry, never the feature, and the day that happens is the day MODEL
  changes and nobody is watching. And the only sign of life was a disabled
  box's placeholder, below the floor where quiet becomes absent: a strip now
  shows a live level meter while listening and moving dots with a seconds
  counter while writing it down, because a wait you can watch passing feels
  shorter than one that might be frozen. Measured on a real phone still to do.

  **The assistant is on every screen, as a pop-up that remembers**
  ([AskBar.svelte](src/lib/components/AskBar.svelte) in the layout).
  *"Make the assistant more integrated with the whole app (maybe as a
  pop-up)."* It was a full-screen overlay reachable from Today alone. Now the
  ✦ is in the layout (hidden on the print page), opens a sheet that leaves the
  top of the screen showing, and STAYS MOUNTED after the first open — closing
  it or moving screens keeps the conversation and anything not yet added,
  because a pop-up is a place you step out of. "New chat" starts over. It is
  told which era and project are on screen (`AskContext`, read from the route)
  so "add a to-do here" means here; anywhere else it is told nothing is in view,
  so it does not file things where you happened to be earlier.

  **A follow-up can fix a proposal** (`revise_pending`, `drop_pending`,
  `applyPendingEdits`). *"Be able to adjust assistant entries with a follow-up
  recording to tweak AI suggestions."* Proposals were append-only, and the
  model could not even see what it had proposed a message ago: the history
  keeps only its reply TEXT. Now the waiting proposals go into the prompt,
  numbered, and two tools change or drop one by number. They are a THIRD tool
  category (`PENDING_TOOLS`) — not writes, since nothing reaches the store until
  Add, and not reads, since the loop would run a read through `runQuery`. Every
  number resolves against the list the model was shown, so "drop 1, change 3"
  cannot change what used to be 4. The classification test now demands each
  tool sit in exactly one of the three.

  **Quiet memos play at a sensible volume, file untouched** ([loudness.ts](src/lib/loudness.ts)).
  *"Voice memos need to be normalized because the volume is too low"* — true by
  design, since music memos record with auto gain off. Each recording is
  decoded once (OfflineAudioContext: renders nothing, opens no audio session)
  and raised so its peak sits at −1 dBFS, capped at +18 dB so near-silence does
  not become hiss, through a limiter. On PLAYBACK rather than into the file,
  because only afterwards is the loudest moment known — a record-time boost
  either clips the chorus or leaves a quiet take quiet, and does nothing for
  memos already made. The cost, said on the row: shared and Drive copies play
  as recorded.
  **The iPhone silent switch is the trap.** An `<audio>` element ignores it;
  Web Audio obeys it — so boosting would make every memo silent on a phone set
  to silent. The boost is used only where `navigator.audioSession` can declare
  playback, or where there is no switch (a fine pointer). The preview pane at
  phone width reports a coarse pointer and no audioSession, so it correctly
  declines there; test the boost at desktop width.
  **Switching memos leaked an audio context**, found while writing this:
  `open()` called `revoke()`, which empties the URL but never `unload()`, so
  each switch left the previous context open and the leftover handle stopped
  the next quiet memo being boosted at all. `open()` unloads first now, which
  is also more correct for the car's stray PLAY.

- **Three from the Coding export, again pasted straight back** (2026-09-18).
  **The assistant's proposals live IN the chat, whole, with Add / Edit /
  Delete each** ([Assistant.svelte](src/lib/components/Assistant.svelte),
  `editableText` / `withEditedText` in [gemini/tools.ts](src/lib/gemini/tools.ts)).
  They sat in a strip under the conversation, one `truncate`d line each —
  a dictated to-do read "Check reliability of app closing beha…" and could
  only be added or binned unread, shown with a screenshot. Now each is a card
  in the scroll: kind and destination in small type ("To-do · Home ·
  Garden"), the words big and wrapped, Add for just that one, Edit to reword
  it, Delete; "Add all N" when there are several. The chat scrolls to its
  newest line. **Edit changes the WORDS only** (title, text or name —
  `EDITABLE_ARG`), and the label is rebuilt from them so the card never
  describes the old wording; an empty edit is refused. Where it goes is
  corrected by saying so ("put it in Garden instead" → `revise_pending`),
  which already works. **Adding one pulls in the places it names**: a to-do
  filed under a project that is itself still a proposal would otherwise land
  on the era, so `addOne` applies those first, matched by name, and nothing
  else. A note's label is no longer shortened, since a note is the thing
  whose middle you need to read.
  **A PROPOSAL OPENS UP, and Edit became Open**
  ([ProposalEditor.svelte](src/lib/components/ProposalEditor.svelte),
  `proposalFields` / `withArgs` in [gemini/tools.ts](src/lib/gemini/tools.ts)).
  Reported from a real session: *"I told the assistant the to-do would only
  take 20 min and low headspace. It suggested the to-do, but I couldn't adjust
  the other things I would normally be able to adjust when I do it manually."*
  Edit changed the WORDS and nothing else — and a model gets a size wrong far
  more easily than it gets a title wrong, so the only way to correct one was to
  add it and then go and find it wherever it landed.
  **The same controls as the manual form**, deliberately: WhenPicker,
  DurationPicker, EnergyPicker, ProjectSelect. A proposal reviewed with
  different controls from the ones that write a to-do by hand is a second
  dialect of the same form, and the two would drift the way every other
  duplicated control in this file did.
  **Only the fields `applyWrite` ACTUALLY WRITES** (`proposalFields`, pinned by
  a test that reads the two together). A control for an argument the apply step
  ignores is a setting that silently does nothing, which is worse than not
  offering it — so a buy item gets a place and no sizes, `add_project_to_era`
  gets an era and no project inside one (the name being typed IS the project),
  and ticking an existing to-do opens nothing at all.
  **An era that is still a proposal must not be quietly unfiled.** `projectId`
  may hold an era's NAME rather than its id — that is what lets one reply make
  an era and file into it — so the select has no option for it. It is matched
  by name as well as id, and when it resolves to neither the panel says so in
  words ("Going to Coding, which another suggestion here creates") rather than
  showing "Nowhere yet" over something that is going somewhere.
  Nothing is saved by opening one: the store is untouched until Add, which is
  spec 7.1 and the entire reason proposals exist. `withArgs` REMOVES an
  argument set back to nothing, so "Someday" and "Not sure" mean unset rather
  than set-to-empty, and it relabels as it goes so the card never describes the
  version before the change.

  **A to-do can get its photo while it is written**, in Brain and inside a
  project (`createTodo({ image })`), with a small preview — it used to take
  add, reopen, add photo, for what is usually the reason the to-do exists: a
  screenshot of the broken thing. The photo resets after each add; the era,
  project and sizes do not, as a run of to-dos shares those.
  **The quick-notes writing box grows with its text** (`grow` in
  QuickNotes.svelte) instead of scrolling inside three lines. Not autogrow.ts:
  that one makes Enter submit, and a note needs its new lines.

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

- **Notes sync as JSON first and .md second, and it used to be only the .md**
  ([sync.ts](src/lib/sync.ts) `syncNotes`, [sync.test.ts](src/lib/sync.test.ts)).
  Two failures at once, both of which look like nothing happening. `syncNotes`
  walks the LOCAL notes, so a note written on the laptop was never even looked at
  by a phone that had no row for it — nothing pulled it down, ever. And the file
  was named after the project alone, so once a project could hold a note per
  section, an era's note and every one of its projects' notes wrote to
  `crafting.md` and overwrote each other on every sync. Notes now go through the
  generic per-record merge like every other table; the .md files are the readable
  copy in Drive (spec 8.2) and are **export only** — the database decides which
  version wins before they are written. A file edited in Drive directly is still
  never destroyed: it is parked under a "(conflict <date>)" name first.

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
  That landed on the PROJECT screens only, and this entry read as though it were
  everywhere — Brain kept the gap for months afterwards. See *A to-do can be
  re-filed after it is written* below.
- **A tick could not be untapped, and the undo had been sitting in store.ts
  the whole time** (`uncompleteTodo`, [day.ts](src/lib/day.ts)
  `reopenDayIfIncomplete`, [day.test.ts](src/lib/day.test.ts)). Reported as
  *"I clicked a to do by accident and now it's marked as done but actually
  isn't. How do I reverse?"* — and the answer was that you could not. The
  function existed from the first week, labelled "Undo, for a mis-tap", and
  NOTHING called it: Today's tick was `disabled` once complete, Brain's was
  `!t.completedAt && completeTodo(...)`, and both project screens drew a closed
  row's ✓ as an inert `<span>`. Third time this shape has appeared — the dead
  "+ New project" button and `Project.archived` with no way to set it — so it
  is worth stating as a rule: **a store function with no call site is a feature
  that does not exist.** Grep for one before assuming a capability is reachable.
  Every tick toggles now, and a completed Today card carries a named **"Not
  done after all"**, because tapping the green tick again is where the hand
  already is but nothing on screen said so.
  **Undoing the THIRD completion reopens the day.** Closing is a consequence of
  the tick, so undoing the tick has to undo it, or the header goes on saying
  "Day closed" over a day with two things done and the close screen sits in
  front of the to-dos. `unlockedCount` is deliberately NOT wound back: the
  unlock really happened and may already hold a to-do, and a day holding more
  slots than it admits to is a worse state than one with a spare.
  Undo fires no celebration, for the same reason a habit's confetti only plays
  on the way in.

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

- **An era's overview must be honest about being one, or it is worse than absent.**
  The heading said "Everything in Crafting" and was read literally — fairly, since
  to-dos and shopping really did list every project's. But Notes showed only the
  era's OWN note, so looking there for a note written inside a project found an
  empty box that looked like the answer, with nothing on screen saying the list was
  partial. Toon offered to have the whole overview removed; the fix is the other
  way round. **Every section spans the whole era and every row names its project**:
  to-dos grouped under theirs, shopping grouped by project with a subtotal each,
  notes listed per project with a snippet and a link, blocks labelled. The heading
  is "Across every project" with a line under it saying to tap a project to work
  inside one. A partial list under a total-sounding heading is a lie the app tells
  once and gets believed.

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
  **Name, description and colour are edited from inside the project too**
  ([ProjectTagEditor.svelte](src/lib/components/ProjectTagEditor.svelte)). Only
  the colour used to be reachable there — a lone dot in the header — so renaming
  a project or writing its line meant going back out to the era list and finding
  the row you had just come from, which is a strange way round when you are
  stood inside the thing. One shared component now serves both, so the two
  cannot drift into offering different fields in different places; each screen
  adds its own extra actions around it (move, sleep and remove stay on the era's
  list, where they are operations on a list).
  **Renaming from inside has to navigate**, because the project's name is in
  that page's own URL and staying put would show "this project is gone" the
  instant it succeeded.
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
- **A to-do can name ONE it comes after, and that is a link, not a level**
  ([order.ts](src/lib/order.ts), `Todo.after`). Asked for with the garden:
  cleaning up, removing the bamboo, sowing grass, installing pots — and the
  grass cannot be sown until the garden is clear. The word used in the request
  was "order or hierarchy", and the distinction matters: this is a SIDEWAYS
  link between two to-dos in the same list, never a parent. Sub-tasks would be
  the third level the depth rule forbids, and this is not that.
  **One predecessor, never a list.** Same argument as one tag per to-do: a
  chain is a line you read down, several predecessors is a graph, and a graph
  needs a diagram. If a job really waits on two things, chain them — the
  resulting order is the one you wanted anyway.
  **The order is derived, never arranged.** `readyFirst` sorts by how many
  unfinished things stand in the way, then by when it was written, so the
  garden reads clean-up → bamboo → grass → pots with nobody dragging anything,
  and re-sorts itself as things get ticked. Nothing is written to the waiting
  to-do when its blocker is completed — blocked-ness is derived, so it cannot
  go stale.
  **THE ASYMMETRY IS THE DESIGN. The app will not OFFER a blocked to-do; it
  never forbids one.** Free Time filters them out of the pool, because handing
  you "sow the grass" on a free afternoon looks like a plan and is not one. But
  the tick circle still works, and Today's picker still lists them with what
  they are waiting for, because that is you choosing rather than the app
  suggesting. Same instinct as nothing ever being overdue: this app is not the
  boss of the garden.
  Two failure modes are handled and both are load-bearing. **A dangling link
  never blocks** — if the blocker was deleted, or arrived from a device this
  one has not synced, the to-do is free; blocking on an unresolvable id would
  freeze it forever with nothing on screen to explain it and no way to undo it.
  And **loops are refused at the picker AND in the store**: `possibleBlockers`
  never offers something that already waits on this one, `setTodoAfter` checks
  again for anything written elsewhere, and `chainDepth` carries a visited set
  because half a loop can be legal on each of two devices. Pinned by
  [order.test.ts](src/lib/order.test.ts).
  **It is asked while the to-do is being WRITTEN, not only afterwards**, in
  Brain's add form and the project screen's: *"the comes-after feature should
  be available when you add a to-do. Right now you have to add it, reopen it
  and set it."* Same complaint as the photo and the day before it, and the same
  answer — a field the row editor offers should be offerable at the moment the
  thing is written. `possibleBlockers` takes anything with an id rather than a
  whole Todo, so the form can ask before the row exists: `{ id: '' }` matches
  nothing, every legal sibling is offered, and no cycle can be closed by a row
  that is not there yet. **Cleared after each add**, unlike the era and the
  sizes: those are shared by a run of to-dos, but what one to-do waits for is
  about that one to-do, and leaving it set would silently chain the next four
  onto the same row.
  Resolving a link needs the COMPLETED to-dos too, which is why
  `queries.allTodos()` exists — `openTodos()` filters away exactly the rows
  that answer "is the thing before it done?", and getting the right answer from
  the narrow list is an accident that reverses the moment that filter changes.

- **Free Time tops up a day instead of replacing it, and is reachable all day**
  ([FreeTime.svelte](src/lib/components/FreeTime.svelte) `room`). It used to be
  offered ONLY from an empty day — reported as *"once I added a to do, I can't
  use the freetime picker anymore to add a new one?"* — and the reason it was
  hidden was sound even though the effect was not: `accept()` called
  `setDaySlots`, which REPLACES the day's slots and resets the unlock count, so
  offering it mid-day would have quietly wiped what was there, completed items
  included.
  So it fills what is free. `room` is how many slots are left; the plan is
  sliced to it (suggesting three when one fits makes two of them a refusal on
  the way out), and `accept` adds them one by one. An EMPTY day still goes
  through `setDaySlots`, because "here is your day" is also what reopens a
  closed one and resets the unlock count — that path is unchanged.
  **`roomLeft` falls back to three, not zero, while the day record loads.** It
  was `day ? … : 0`, which was harmless while it only gated a button and stopped
  being harmless the moment it also told the flow how many slots to plan.
  Both ways in now sit side by side once the day has something on it: *Free
  time?* and *Add (N left)*.

- **Every section on Today says what it is, and the hero shrank to make room.**
  Habits had a heading and the calendar strip and the day's three did not, so
  they ran together as one undifferentiated column; asked for directly. The
  calendar's heading lives INSIDE CalendarStrip, because that component is the
  only thing that knows whether it has anything to show and a heading over
  nothing is worse than no heading.
  The Free Time circle was `w-[64%] max-w-[264px]`, which pushed Habits under
  the capture bar on an iPhone — *"the habits are pushed underneath the add
  anything at all"*. Now `w-[48%] max-w-[196px]` with tighter gaps: still by a
  distance the largest thing on an empty day, and everything else stays on
  screen. Measured at 375×812 with a calendar strip, a to-do and three habits:
  the habits row ends at 454 of 812, well clear of the bar at ~690. **If this
  page grows another section, measure it there again** — this is the screen
  that has to stay calm, and it is also the one everything wants to be on.

- **Subtle has a floor, and below it a thing is not understated, it is absent.**
  Three separate reports now: an add button that was grey on grey, a "pick
  something yourself" that was grey prose and got found by accident, and the
  Today wave at a 1.8% swell — *"I don't really see the habits or to do's
  pulsing"*. The rotation was working perfectly the whole time (verified: one
  item at a time, cycling evenly through the to-do and all three habits), it
  simply could not be seen. **When a control or a signal is deliberately quiet,
  check it on a real screen, not in the diff.**
  What it is now is a light running AROUND THE EDGE of the row — a conic
  gradient rotated by an animated `--shine-angle`, masked to the border ring —
  plus a glow on the tick circle, and **a dinosaur walking past inside it,
  behind the text**. Toon's idea and a better one than the swirl of light it
  replaced: *"like the buttons are a window through which we see a dinosaur
  pass."*
  It is one of the fifty-two STICKER dinosaurs — the same ones that cover the
  era cards — drawn fresh each time and never the same twice running, with a
  coin flip on which way it walks. CSS cannot roll a die, so the page chooses
  and hands the picture and the direction over as custom properties. **One
  mirror does both jobs**: `scaleX(-1)` turns the animal round AND reverses its
  travel, because the keyframes move it left-to-right in its own now-mirrored
  space, so there is no second set of keyframes to keep in step.
  **The walk takes three seconds and one comes round every nine.** It crossed a
  whole card in a second and a half at first, which is a bolt rather than a
  stroll — *"moving a bit too fast to really see them well"*. Doubling the walk
  meant doubling the gap too, or the page would be animated more often than it
  is still; three-in-nine keeps almost exactly the proportion of quiet that
  one-and-a-half-in-five had. **`NUDGE_FOR` must stay ahead of the longest
  animation in app.css** — if it ever falls short, the class comes off mid-walk
  and the animal vanishes in the middle of the row.
  **WALKING FORWARDS TAKES TWO CONTROLS, AND THE OBVIOUS ONE IS NOT ENOUGH.**
  Asked for as "make the dinosaurs walk in the direction that they are looking".
  Mirroring cannot do it: `scaleX(-1)` flips the art AND the travel together, so
  it PRESERVES whether an animal is going forwards — a left-facing sticker
  mirrored is a right-facing sticker moving left, still backwards. What fixes it
  is reversing the TRAVEL (`animation-direction: reverse`), and working the
  algebra through gives the rule: local travel must equal the sticker's natural
  facing, at which point the mirror cancels on both sides and all four
  combinations come out forwards. So `--dino-dir` comes from `Sticker.faces` and
  `--dino-face` stays a free coin flip for variety. Verified by measuring the
  background position early and late in all four cases.
  `Sticker.faces` is judged BY EYE and is a person's call per picture — nothing
  in the pixels or the file names says which end the head is, since several are
  drawn face-on, a few curl their necks right round and one is upside down.
  [scripts/sticker-contact-sheet.py](scripts/sticker-contact-sheet.py) lays them
  out numbered on a grid so the call can be made in one look. **A new sticker
  must declare one**, and a test asserts it: the symptom otherwise is a single
  animal moonwalking through a to-do, which nobody would trace back to a missing
  field.
  It started as the Twemoji sauropod silhouette from Dino.svelte, which still
  reads well if the sticker set is ever dropped. Either way it is **not
  hand-drawn**, which is a rule with four failed attempts behind it.
  It went through three earlier shapes, all worth knowing about: a scale swell,
  which moved the card and made a still page feel unsteady; a band across the
  FACE, which washed over the text for a second and a half; and a spiralling
  glow, which was a smear. The rim is more visible than any of them — motion at
  a boundary is what peripheral vision is good at — and it never touches a word.
  **The dinosaur is behind the text via `z-index: -1`, which only works because
  `.nudge` sets `isolation: isolate`.** A negative pseudo-element paints after
  its parent's background and before its parent's content — but only inside a
  stacking context its parent owns. Without the isolation it joins the page's
  context and disappears behind the row entirely. That line is load-bearing, not
  tidying. It is drawn as a MASK with the shine colour behind it, so one copy
  serves both themes.
  **The row must never get `overflow: hidden`** — the completion burst is a
  child of it and would be cut in half — which is why both the face version and
  this one are built to stay inside their own box.
  **It is NOT the accent, and the reason is worth keeping.** A flat wash of
  `--color-accent` at a third opacity is orange PAINT on a dark grey card, and
  it reads as a dirty yellow smear — reported that way. Light needs three
  things paint does not have, and it needs all three: a near-white CORE with
  gold falling away either side (a specular highlight has a hot centre; one
  flat colour is a stain); a yellower, lighter gold than the accent's orange;
  and `mix-blend-mode: plus-lighter`, so the band ADDS light rather than
  tinting what is under it — that last one does most of the work. On paper
  none of it applies, since adding light to white gives white, so light mode
  uses a saturated gold at normal blending. All four values are `--shine-*`
  tokens redefined per theme, like the rest of the palette.
  Worth ruling out before touching the numbers again: the whole thing is
  disabled under `prefers-reduced-motion`, which is on for anyone who has
  turned on Reduce Motion in iOS accessibility settings.

- **"Automatic" means "whatever the phone says", and that is not what it reads
  as** ([ThemePicker.svelte](src/lib/components/ThemePicker.svelte)). Reported
  as *"my appearance is set to automatic but it's daytime now and my app is
  still in nighttime"*, and confirmed a message later — *"but so is this chat
  window so maybe it is more a problem with my phone than the app"*. It was the
  phone. An iPhone left on Dark keeps this app dark at noon, and the app is
  doing exactly what it was asked to — but the word promises a
  switch that only happens if the phone itself is set to switch. The picker now
  says which of the two the phone is currently reporting, which turns a mystery
  into a fact, and names the setting to change (iPhone Settings → Display &
  Brightness → Automatic) at the point of confusion rather than behind the ⓘ.
  **And `system` is re-applied on every foreground** ([theme.ts](src/lib/theme.ts)).
  The `prefers-color-scheme` listener is the right mechanism and is not enough
  on its own: an installed app on iOS is suspended rather than closed, so it can
  sit through an entire sunrise with its JavaScript frozen, and a change event
  that fires while nothing is running is one nobody hears. Same signal, and the
  same reasoning, as the update check.

- **Every habit row on Me was rendering the WINS empty-state.** "Nothing closed
  yet. It fills itself in." appeared under all three habits, so tapping one on
  Today looked like it did nothing and the row looked broken rather than
  clickable — which is why the detail page, where the six-month heatmap has
  lived all along, was never found. A bad automated edit had replaced the cycle
  line with an `<Empty>` block; the `since()` helper it was meant to use sat
  unused right above. **If a screen shows copy that belongs to a different
  screen, look for a mangled edit before designing anything.**
  The row now carries a fortnight of dots plus "N logged · since <month>", so a
  tap on Today is visible immediately and the row obviously leads somewhere.
  **Still no streak, and that is the spec's rule rather than an oversight**: a
  streak counter can only ever tell you that you broke it, and the fear of
  breaking one is what made the previous system a machine for guilt. (What
  DOES exist is milestones — past tense, permanent, nothing to lose. See
  *What you have done* above for why that is a different thing.) What is
  shown is what happened — days on or off against no target, gaps that nothing
  counts — which is the same argument that lets the "where the work went" chart
  exist. If a streak is asked for again, this is the paragraph to read first.

- **The Today page waves and celebrates, and the shape of the wave IS the
  no-nag rule** ([+page.svelte](src/routes/+page.svelte) `nudged`, the `.nudge`
  keyframes in [app.css](src/app.css), [celebrate.ts](src/lib/celebrate.ts),
  [Burst.svelte](src/lib/components/Burst.svelte)). Asked for as *"pulse or
  something to say 'don't forget about me 😉'"* plus *"some kind of variable
  animation when you tab it to complete"*. This is the closest the app comes to
  the banned nag, so the constraints are load-bearing and not styling:
  **it never escalates** — the same gentle movement at nine in the morning and
  nine at night, because a pulse that grows more insistent the longer something
  sits there is an overdue state wearing a costume; **it never singles one
  out** — the turn goes evenly round the list, so it cannot read as the app
  pointing at your worst item; **it says nothing in words** — "don't forget
  about me" on the screen would be aimed at the reader, and the house rule is
  that the personality is never at your expense; **one thing at a time**, to-dos
  and habits in ONE rotation, because two things waving at once is a busy screen
  rather than a live one. It stops on a closed day, on a finished list, and in a
  tab nobody is looking at.
  **FINISHING A WHOLE SECTION OFF gets its own moment** (`cheerSection`,
  `clearedLine`). Asked for as *"can I get some kind of celebration when I did
  all my to-dos, and/or all my extra to-dos, and/or all my habits for the
  day?"* The three slots always had one — closing the day IS the spec's
  mechanic — and the other two lists simply went quiet. Now "Also on today's
  list" says *"That's the list clear."* and the habits say *"Every habit,
  done."*, each with a burst, each gone again in four seconds.
  **The TRANSITION is celebrated, never the state**, and that is the whole
  correctness of it: it fires from the tap that empties the list, not from the
  list being empty, so opening the app in the evening with everything already
  done does not throw confetti at you for work finished hours ago. The check is
  made BEFORE the write, against the row being ticked — "this is the last one
  still open" — which is also the only synchronous way to ask, since the
  liveQuery has not come back yet.
  **Once per section per day**, so a mis-tap and a re-tick do not replay it; in
  memory only, because after a reload the only route back to the transition is
  to untick something first.
  **Transient, not a label.** A permanent "all done" line would be furniture on
  the one screen that has to stay calm, and the ticks and chips already say the
  state — this says the moment. The words are about the work and never about
  you, the same house rule the dinosaur's jokes follow: "well done!" is exactly
  the thing this app does not say.
  **And it shipped as one green line, which came back as *"that's kind of
  boring. Make it fun!"*** — the same note the finished-project card got, in
  almost the same words, so it got the same answer: a real dinosaur and a line
  about what the dinosaur is doing ([clearCheers.ts](src/lib/clearCheers.ts)).
  **Second time now**, which is worth stating as a rule: *this app's
  celebrations are made of artwork and a joke, not of typography.* A coloured
  line of text is not a celebration, however good the colour.
  **Scaled for a Tuesday.** The finish card is a whole screen, a 240px sticker
  and four seconds of confetti, because finishing a project is rare. Clearing
  today's list happens daily, so this one lives inside its own section, the
  animal is 56px on a tinted ground (the artwork loses its outlines on a bare
  page — see stickers.ts), and it leaves after six seconds. A full-screen
  interruption every evening would be the app talking over you, which is what
  the no-nag rule is actually about.
  **Its own pool and its own storage key**, never the same animal twice
  running, so the two sections cleared on one evening bring two different ones.
  The pool is tested for the house rule and for one more: **no line may mention
  tomorrow** — congratulating you and then pointing at the next day is a streak
  with a smile on it.
  The list only counts as clear when the shopping row is not also sitting
  there; for habits, "done" means settled, which is done-today for an every-day
  habit and the week's rhythm kept for one that has a rhythm.

  The celebration is **variable on purpose** — six bursts, never the same one
  twice running, the same reasoning as the rotating Free Time scenes: an
  identical celebration stops being one by about the fourth day, and a repeat
  reads as "nothing happened". Geometry only (sparks, dots, stars, petals),
  which is the icon lesson again — hand-written beziers make fine confetti and
  terrible animals. It fires BEFORE the database write, because a celebration
  that arrives after a round trip reads as a glitch; it is
  `pointer-events: none`, because a row that stops taking taps while a sparkle
  is over it would be worse than no sparkle; and it plays only on the way IN for
  a habit, since confetti for unticking something is the app being pleased about
  the wrong thing. **Every bit of it goes under `prefers-reduced-motion`** — the
  tick still turns green, which is the part carrying the meaning.

- **The Today picker is grouped, and its entry point had to stop whispering.**
  It was a flat list of bare titles, newest first — fine at five to-dos and
  useless at fifty, since nothing on a row said which era it belonged to or how
  big it was, so choosing meant recognising every title from memory. Four
  arrangements now (Recent / Era / Time / Head), grouped with headings rather
  than merely sorted, because a heading answers "what am I looking at" without
  comparing two rows to work it out — the same reasoning as the buy list's
  shops. Empty groups are dropped. Each row carries its era, project and both
  sizes.
  Each row carries its project's colour as a dot down the leading edge — the
  same colour that project wears on the era page and at the top of its own
  screen, derived through `projectTagColor` rather than stored anywhere new, so
  a to-do can never carry a colour that disagrees with its project. A column of
  dots is scannable in a way that dots at varying x positions inside a footnote
  are not, and a to-do with no project still gets the dot in transparent,
  because a ragged left edge is harder to read down than an occasional gap. It
  earns its keep the moment two projects hold a job with the same name — "varnish
  the wood" in Campervan and in Garden are one glance apart rather than two
  footnotes apart.
  **"Pick something yourself" was grey prose starting with "Or", and was found
  by accident rather than by looking.** Quiet is right for a secondary action
  next to the Free Time button; invisible is not, and the difference is whether
  it looks pressable. It is an accent pill now — the same correction the add
  button needed when it was grey-on-grey, which is a mistake worth only making
  once more.
  Size labels live in [sizes.ts](src/lib/sizes.ts) now, because they appear in
  the two pickers, in row footnotes and in these headings, and there were
  already two copies of the effort list (one of them dead code in the project
  page). User-facing copy in more than one place drifts.

- **The calendar strip reads EVERY ticked calendar, not just the primary one**
  ([google/calendar.ts](src/lib/google/calendar.ts),
  [calendar.test.ts](src/lib/google/calendar.test.ts)). It asked
  `/calendars/primary/events` and nothing else, so events on a calendar made
  for a band, a client or a company never appeared — and **an absent category
  looks exactly like an empty one**, which is why it went unnoticed until Toon
  asked whether it covered all of them. It now lists `calendarList` and reads
  each chosen calendar in parallel.
  **"Chosen" means `selected` in Google's own list — the same checkbox that
  decides what shows in Google Calendar's web UI.** That rule is worth keeping:
  what you see there is what you see here, adjusted in a place that already
  exists rather than in a settings screen of ours, and it keeps Holidays and
  Birthdays out without a hardcoded blocklist. The primary calendar is always
  included, ticked or not. If the calendar list cannot be fetched it falls back
  to primary alone, so a permissions hiccup degrades to the old behaviour
  rather than a blank strip. The scope was already `calendar.readonly`, which
  covers all of this — no re-consent was needed.
  Ids are composite (`calendarId:eventId`), because two calendars can hold the
  same event id and a duplicate `{#each}` key drops one silently. The same
  event on two calendars — an invitation that also sits on a shared calendar —
  collapses to one card, keyed on title plus start.
  Each card names its calendar in that calendar's own colour, so a band night
  and a client meeting are told apart at a glance; the primary calendar is left
  unnamed, since saying it on every card says nothing.

- **The calendar strip folds, and the count in its header is what makes that
  safe** ([CalendarStrip.svelte](src/lib/components/CalendarStrip.svelte)).
  Asked for as decluttering Today. It reuses the project screens'
  `Collapsible` rather than growing a second fold mechanism — same triangle,
  same per-device localStorage key (`today/calendar`), so whether your calendar
  is folded stays a fact about that phone and never syncs to the laptop.
  **Folded it still says "Calendar 3".** A day with three meetings on it that
  looks like an empty day is worse than the clutter, and the whole reason the
  strip hides itself entirely when there is nothing to show is that same rule
  read the other way: the header must never claim more or less than there is.
  Default is unfolded, so nothing changes for anyone who does not fold it.

- **The calendar cache expired at midnight and at no other time.** It was a
  module variable keyed on the DATE, so on a phone — where an installed app is
  suspended rather than closed — adding an event in Google and coming back
  showed the previous list for days, with nothing that could make it look
  again. Reported as *"I did a quick test by adding something for today and
  syncing FreeTime but it didn't appear"*, which was true twice over: the cache
  held, and **syncing never touched the calendar at all**, being Drive
  reconciliation. Now: a five-minute TTL, a refetch when the app returns to the
  foreground (the same safe moment the update check uses), and `syncNow` clears
  it — "sync" is reasonably read as "go and get the latest", and clearing costs
  nothing because nothing fetches on its own.

- **"Tomorrow instead" on a Today card, and the actions got names.** Asked
  after a real morning: *"I wanted to varnish the furniture of my campervan
  today, but because it is raining... so what happens now with that to do?"*
  The answer was already fine — take it off, nothing records it as missed, and
  the project going quiet brings it back through the neglected slot — but
  "not today, tomorrow then" meant a trip to Brain to find the to-do and set a
  date, from a card you are already looking at.
  **It moves the to-do into TOMORROW'S three; it does not date it.** A date is
  for a real commitment, something promised to someone, and it would take the
  obligation slot from then on. "I'll do it tomorrow" is a plan, and plans live
  in the day's slots — so tomorrow it is simply already there. The to-do itself
  is untouched: still undated, and carrying no record of having been moved.
  Rain three days running and it moves three times, counted by nothing.
  **Withdrawn when tomorrow is already full**, rather than offered and refused.
  The × remains, which puts it back in its project either way.
  The layout is the interesting part. "Tomorrow" beside the × ate about eighty
  pixels of title and pushed a medium one onto three lines; two bare glyphs
  instead would have been exactly the row of unlabelled symbols this file
  already complains about under *A control has to name what it acts on*. Both
  actions moved to a line of their own and gained words — **"Tomorrow instead"
  and "Not today"** — which costs a few pixels of height and buys back the whole
  title. The bare × is gone with it.

- **A to-do can be put straight into Today's three, without the Free Time flow**
  ([PlanToday.svelte](src/lib/components/PlanToday.svelte), and "Or pick
  something yourself" under the Free Time button). Asked for as: *"today I want
  to varnish the wood in my campervan. I made a to do for that but I would like
  to be able to plan it in so that when I open the freetime app, I see it there
  in the today section."* Free Time asks how long you have and what your head
  is like before it suggests anything — the right tool for *what should I do?*
  and the wrong one for *I already know*.
  **The gap was worst exactly where it mattered.** Today's manual picker only
  renders once the day already has something in it (`{:else if roomLeft > 0}`,
  after the empty-day branch), so on an EMPTY day the only route into the three
  was the questionnaire. The one case where you most need to put something in
  was the one case you could not.
  **It writes `Day.slots`, never `Todo.date`,** and the difference is the whole
  point. A date is an obligation marker that feeds the obligation slot; it puts
  nothing on the screen. "I see it there in the today section" means the slots.
  Brain's row editor now carries both, and they are deliberately far apart —
  the When chips (a date) at the top, "Do it today" (a slot) down in the action
  row. Two controls saying "Today" a centimetre apart would be read as one.
  **The three are still three.** `addToDay` throws once the day is full, and
  the button is replaced by the plain sentence "Today already has its three"
  rather than growing a fourth slot or failing quietly. The DayFullError catch
  is still needed even though the button hides itself: the cap lives in data
  and two devices share one day.

- **Today's three and its habits reorder by press, hold and drag**
  ([reorder.svelte.ts](src/lib/reorder.svelte.ts), `reorderDay`,
  `reorderHabits`, `Habit.order`, [reorder.test.ts](src/lib/reorder.test.ts)).
  **The hold is the design**: every row there is already a tap (tick, log)
  and sits in a scrolling page, so a drag begins only after 350ms without
  moving more than 8px — move sooner and it was a scroll, lift sooner and it
  was a tap. The tap that follows a drag is swallowed, or lifting off a habit
  you just moved would log it.
  **Touch has its own listeners**: stopping the page from scrolling once the
  drag has begun needs a non-passive `touchmove` calling preventDefault;
  `touch-action: none` would make Today unscrollable from its biggest
  targets. The lifted row moves by the CSS `translate`/`scale` properties,
  never `transform`, because `.rise` holds `transform` with fill-mode both and
  an animation beats an inline style.
  The order is previewed live and written ONCE on release. `reorderDay` only
  rearranges — ids not on the day are ignored and missing slots kept — so a
  drag that raced another device cannot slip past the three. Habits store a
  position (unset sorts last, oldest first), and Me uses the same order.
  Verified with synthetic touch events in the preview; **feel it on a real
  phone**, since hold timing and iOS scroll interplay only show up there.
  **An era's projects drag too** (`reorderProjectTags`), on the era page's
  in-progress list. Sleeping and finished projects are not dragged — they keep
  their places after the dragged ones — and the write is a pure permutation of
  `tags`, deliberately NOT through setProjectTags, whose job is pruning.
  Colours are pinned first, since an era from before stored colours falls
  back to position and would otherwise repaint on a move.
  **Found on the way: "+ New project" deleted sleeping and finished projects**
  (10–17 Sept 2026). It wrote `[...tags, name]` where `tags` is the AWAKE
  list, and setProjectTags pruned everything else — the project left the era
  while its to-dos, notes and shopping still pointed at its name. Now
  `allTags`. **Any list on a screen that is a filtered view of `tags` must
  never be written back as `tags`.**
  **"Also on today's list" drags too**, and its absence was reported as a bug:
  *"when I hold-press a to-do card the text gets highlighted to copy instead
  of lifting the card"* — on those rows there was no drag, so a long press
  was an ordinary text selection. Its order is `Day.listOrder` (the day's
  plan, not the to-do's: moving a to-do to another day must not carry a
  position), and Brain's day list sorts by it too so the two agree.
  **Done sinks on Today** — the three, the day list and the habits (`sinkDone`),
  asked for directly. It was briefly the opposite for the day list ("a row
  jumping away undoes your order"); Toon preferred what is left on top. It is
  DISPLAY ONLY — the stored order is untouched, so unticking puts a row back
  where it was — and a just-ticked row is held in place (`settling`) while its
  burst plays, then slides down, or the celebration would play at a spot the
  row had already left. Safari needs `webkitUserSelect` set as a property;
  `setProperty('-webkit-user-select')` is not reliably honoured.

- **"Add to FreeTime": a hand-over screen, and a Chrome extension that fills
  it** ([routes/add](src/routes/add/+page.svelte), [clip.ts](src/lib/clip.ts),
  [clip.test.ts](src/lib/clip.test.ts), [extension/](extension/README.md)).
  Asked: *"a Chrome extension … if I see something on a website I would like
  to buy, add it to a project within FreeTime? Maybe even more things?"*
  **The extension saves NOTHING.** Everything lives in this origin's IndexedDB,
  which no extension may write to, and writing to Drive's JSON behind the app
  would race the sync. So it reads the page and opens `/FreeTime/add#…` with
  what it found; the app shows it filled in, you pick where it goes, and Add
  writes through store.ts like any other screen — the assistant's rule
  (spec 7.1): outside things propose, a tap writes.
  **In the hash, not the query**: a `#…` never reaches a server, so the page
  you were reading and its price are in nobody's log, and there is room for a
  thumbnail. **Validated, not trusted** (`parseClip`): only http(s) links, a
  photo only as a small `data:image`, never a remote URL for the app to fetch,
  unknown kinds fall back, and an unparseable price is left out. The app
  re-shrinks the photo to THUMB_EDGE whatever the sender did.
  Four kinds: to-buy (name, qty, price, link, photo, optionally straight onto
  the shopping list), idea and to-do (both gained `url`, shown as "🔗 Open link"
  in their editors), and note — appended to a project's notes, or a QUICK note
  when no era is picked. The place is remembered per device
  (`freetime.clip.place`), since clipping comes in runs for one project.
  **The extension** (Manifest V3, loaded unpacked — no Web Store) reads
  schema.org Product JSON-LD first, then og:/product: meta tags, because
  shops publish those for search engines and they outlast any layout. It
  fetches and shrinks the photo itself (a shop's server refuses other sites,
  so the app could not), can screenshot the visible tab into a to-do's photo,
  and adds right-click entries for a selection, a link and an image.
  `<all_urls>` is for reading the page you click on and fetching its photo.
  **It opens a small window, not a tab** (`chrome.windows.create` type popup,
  420×760 at the right edge of the browsing window; `#popup=1`): *"it opens an
  extra tab — can it open a little window in the same tab?"* Not IN the tab,
  and that is the constraint worth knowing: FreeTime in an iframe or panel on
  the shop's page is third-party there, and Chrome partitions its storage — an
  EMPTY IndexedDB with none of your projects, and whatever is added lands in
  that separate store rather than in your FreeTime. A window of its own is
  top-level, so it is the real app. In popup mode the tab bar and the
  assistant hide (`.clip-popup`), there is a Cancel, and it `window.close()`s
  itself 1.4s after Add (allowed: an extension-opened window with one history
  entry — /add uses replaceState, never push, to keep it that way).
  **Not built yet: the iPhone route.** Chrome extensions do not exist on iOS;
  a Shortcut in the share sheet opening the same `/add#kind=…&url=…&title=…`
  is the plan, with title and link only (a Shortcut cannot read the page's
  price or photo the way the extension can).
  **A to-buy is added with its details in one go** ([BuyAddForm.svelte](src/lib/components/BuyAddForm.svelte)),
  asked in the same breath: *"add the quantity, web link and price in the same
  thing, not adding it first and clicking it open."* Once there is a name,
  Qty / Price each / Link / Photo appear under it; one form for Brain → Buy,
  a project's To buy and the shopping list. **The link box is `type="text"`,
  never `type="url"`**: the latter makes the browser silently refuse to submit
  "hornbach.nl/glue", which is how links are typed; `https://` is added on
  save. And a to-buy with a link carries a **↗** on its row that opens the
  shop — a sibling of the row's button, never inside it.

- **The Project dropdown works on its own** ([ProjectSelect.svelte](src/lib/components/ProjectSelect.svelte)).
  It listed only the chosen era's projects and sat disabled saying "Pick an
  era first" — *"can't we make the dropdown work both ways, where when you
  select a project first the era gets filled in automatically?"* It now lists
  every project grouped under its era (optgroups), the chosen era's group
  first, and a pick reports both era and project. Option values carry the era
  id with the name, since a project name is only unique inside its era. Used
  by Brain's add form, a to-do's Belongs to, the shopping list's add box and
  moving a quick note into a project. The Era dropdown is unchanged: picking
  an era still clears a project that belongs to another.

- **Your own order for to-dos, ideas and to-buys — one per item, everywhere**
  ([rank.ts](src/lib/rank.ts), [rank.test.ts](src/lib/rank.test.ts),
  `rankedReorder` in reorder.svelte.ts, `setRanks`, `Todo/Idea/BuyItem.rank`).
  *"Change the order of to-dos within projects as well as within Brain. Maybe
  also the ideas, to-buys. Of course when we filter the order should reflect
  the filter."* The last sentence is the design: ONE number per item, not one
  order per screen, so Brain filtered to Bedroom and the Bedroom screen agree.
  **Unset means newest first** (`-createdAt`) — Brain's old order, so nothing
  moves until dragged and a new item appears under the Add it was written in.
  That REVERSED a project's to-dos, which were oldest first ("a plan you read
  down"); what lost was the per-screen default, because two defaults for one
  item cannot both hold once a filter shows the same rows. Chains still win
  over rank on a project screen (`readyFirst`: depth, then rank) — a waiting
  to-do never sits above what it waits for.
  **A drop writes ONE item**, ranked between its new neighbours ON SCREEN
  (`placement`). That is what makes a filtered drag behave: the hidden rows
  keep their places. Only when the neighbours leave no room (a tie, or a list
  sorted by something else first) is the visible list renumbered.
  **What floated up had to stop floating**: the on-the-shopping-list flag no
  longer lifts a to-buy above the rest, since that would undo a drag — the 🛒
  on the row says it. Bought items and done ideas still sink. Grouped buy
  lists (by shop, by era) do not drag: the group comes from the item, not
  from where it was dropped. A Brain DAY list drags as `Day.listOrder`, the
  order Today already uses; one Reorder decides at drop time, because an
  action bound to a row is not re-bound when the day filter changes.
  **A row open for editing does not drag** (`{ id, off }`): a hold in a text
  field is for the text, and iOS Safari can refuse typing in a field inside a
  `user-select: none` ancestor — app.css now keeps inputs selectable anywhere.
  **On a computer, dragging projects did nothing**: the era's project rows are
  LINKS, and a held-and-moved link starts the browser's own drag-this-link,
  which swallows the mouse. Touch never does that, so only the laptop broke.
  Draggable rows now cancel `dragstart` and `selectstart`.
  **The day field in Brain's add form was an empty grey bar wider than its
  box** — an empty `<input type="date">` on iOS draws as nothing and has a
  minimum width of its own. [WhenPicker.svelte](src/lib/components/WhenPicker.svelte)
  is chips — Someday / Today / Tomorrow / "📅 Pick a day" — with the real date
  field laid invisibly over the last chip, which then shows the day picked.
  Used by the add form and the row editor, so they cannot drift.

- **ONE shopping list, in Brain → Buy** ([shoppingList.ts](src/lib/shoppingList.ts),
  [ShoppingList.svelte](src/lib/components/ShoppingList.svelte),
  [ShoppingListButton.svelte](src/lib/components/ShoppingListButton.svelte),
  [shoppingList.test.ts](src/lib/shoppingList.test.ts)). **It replaced a
  first attempt that lasted a day**: a to-do marked "shopping trip" opening
  its project's To buy list. Four concepts (a project, a to-do, a checkbox, a
  🛒 to find) for "things to get at the shop", and it came back as *"I'm not
  really following how to make a shopping list. It must be easier otherwise I
  will never use it."* Toon's own design replaced it, and it is simpler:
  a "🛒 Shopping list" button beside Brain → Buy's era filter opens the list
  full screen; things are created there (era and project optional) or put on
  from any to-buy row's 🛒, or from "Add from your to-buys" inside it; and
  the list can be given a DAY, on which it appears on Today under "Also on
  today's list". `Todo.shopping` is retired and read by nothing.
  **The "needed soon" star BECAME the list** (`BuyItem.needed`, name kept as
  schema). Asked *"we can star a to-buy, why was that again?"* — it was the
  priority-that-is-not-a-priority, and "needed soon" is what a shopping list
  is; two flags for one idea is how the first list became unfollowable.
  **The list is a VIEW, not a place.** Every item keeps its era and project,
  so it still shows in Brain, on the era overview, in project To buy sections
  and on printouts — nothing hangs under anything, and the depth rule holds.
  Bought items keep the flag and leave the list — except those bought TODAY,
  which stay ticked, so a tick in the shop does not pull the row from under
  your thumb. **The day is `Day.shopping`**, on the synced day record; at most
  one day carries it and a past one is ignored (no overdue shop). The row
  editor can now also set a buy item's PROJECT, not only its era.
  **Removing from the list is not deleting** (`BuyList` `inList`). Asked for
  with the guard spelled out: *"remove shopping list items in case I made a
  mistake, but it should not be so easy to remove to-buys from other projects
  from within the shopping list."* In the list the row's button is ✕ — take
  it off this trip; it stays in its project — with Undo for five seconds,
  because one tap is right for "not this time" and wrong for a misplaced
  thumb. Delete (two taps) appears only for things that belong to NO era, the
  groceries typed straight into the list; a project's to-buy says "Part of
  Home · Bedroom … to delete it altogether, open that project" instead. The
  list is a view, so it may change what is on it, never what exists.
  Taken off, a project-less item lands in "Add from your to-buys" — and was
  then undeletable from anywhere but Brain → Buy: *"those are irrelevant
  because someone else got them already … where do I delete those?"* Those
  rows now carry the same two-tap Delete, under the same rule (no project
  only). The list's When row is WhenPicker too (`noneLabel`, `future`); it
  was the same bare date field that drew as an empty bar on iOS.
  **On Today it shows only while something is left to get** (`shoppingToday`):
  planned for today AND at least one item on it unbought. An empty list on its
  day sat there as a line about nothing; everything bought means the trip is
  done, so it goes then too.

- **Quick notes, and two round buttons beside Today's title**
  ([QuickNotes.svelte](src/lib/components/QuickNotes.svelte), `QuickNote`,
  db v7 `quickNotes`, synced as `quick-notes.json`,
  [quickNotes.test.ts](src/lib/quickNotes.test.ts)). *"Like opening Notes on
  my iPhone — I just took a measurement and I need to remember the numbers."*
  📝 opens them and 🛒 opens the shopping list (its count is plain text, never
  a red badge). **A quick note is its own table, deliberately**: not an idea (a
  measurement is not a thought to develop) and not a project note (choosing a
  project is the delay being avoided). The screen opens on a box to write in,
  with the notes underneath; a note exists from its first letter, there is no
  Save, and a note left empty is removed on the way out. The top box creates
  its note exactly once however fast the letters come (`pending`).
  **A note can move on**, asked for straight after: *"turn a note into a
  project or add a note to an existing project's notes."*
  `quickNoteToProjectNote` APPENDS (the append_note rule — a number must not
  overwrite a page) to a project's or era's notes; `quickNoteToProject` makes
  a sibling project named by the first line, with the whole note as its
  notes, and refuses a name the era has (sleeping and finished included).
  Either way the quick note is removed: it moved, and two copies of a number
  drift apart.

- **Quick notes do sums, search, and delete in bulk** ([calc.ts](src/lib/calc.ts),
  [calc.test.ts](src/lib/calc.test.ts)). *"Add, sum up numbers in the quick
  notes. Also a way to delete multiple. And a search bar."*
  **A typed "=" at the end of a sum writes the answer after it, INTO the
  note** — kept, synced, and countable like any other number. Only on a typed
  "=" (InputEvent `insertText`), so pasting or editing an old "3 + 4 = 7"
  never appends a second 7. Words before the sum are skipped by trying the
  longest parseable tail of the line. **Never `eval`**: notes arrive from other
  devices, so it is a small parser for numbers, + − × ÷ (and x, :) and
  brackets that returns null for anything else. A comma is a decimal point;
  thousands separators are refused rather than guessed.
  **Σ Total adds the LAST number on each line** — where a price or an answer
  sits — one per line, because "2.43 by 1.10" is one measurement and not two
  amounts. That is a guess about meaning, so the parts it added are one tap
  away and always named as "the last number on each line".
  Search is always there once there are notes; Select turns rows into tick
  circles with a bottom bar (All/None, "Delete N", two taps).

- **Quick notes do lists — which is what "sum up" meant** ([textLists.ts](src/lib/textLists.ts),
  [textLists.test.ts](src/lib/textLists.test.ts)). The request *"add sum up
  and numbers"* was read as arithmetic and built as such (the entry above);
  what Toon meant was an OPSOMMING — a bulleted or numbered list. Worth
  remembering when a request is dictated in English by a Dutch speaker:
  "sum up" can mean enumerate. The calculator stayed, being harmless.
  Enter on a list line continues it in its own style (`-` `*` `•` `- [ ]`,
  `1.` `1)`, `a.` `a)`, indentation kept); Enter on an EMPTY item ends the
  list, the Notes-app way. Done after the fact on `insertLineBreak` /
  `insertParagraph` rather than by intercepting keydown, which phone
  keyboards do not reliably send. "• List" and "1. List" toggle the current
  or selected lines (numbers ↔ bullets ↔ plain), cancel pointerdown so the
  keyboard stays up, and keep a multi-line selection selected. Totals and
  row previews strip markers, so "1. milk" is not the number one.
  **The preview browser's Enter key inserts nothing, even in a bare
  textarea** — test line breaks with `document.execCommand('insertLineBreak')`,
  which fires the same InputEvent a keyboard does.

- **Habits have colours** (`Habit.color`, `habitColor`, `setHabitColor`).
  *"They look bland while they should look inviting."* The project palette,
  handed out at creation (first colour no other habit wears) and changeable on
  the habit's page. Older habits derive one from their ID — not the name or
  position, so renaming or dragging does not repaint them. Me's rows and the
  heatmap wear it too.
  **Colour must never be what says DONE.** The first version washed waiting
  habits in their colour and filled done ones, and a row of different colours
  read as some already ticked: *"it looks like some are ticked off when the
  colours are different."* Now a tick circle answers "done?" — waiting is a
  LIGHT tint with an empty ring in the habit's colour; done is the card FULLY
  in its colour with a white circle and a ✓. (A plain grey waiting chip was
  tried in between and Toon wanted the colour back: the tint was never the
  problem, the missing circle was.) Colour says WHICH,
  the circle says WHETHER. Same on the habit's own page.
  **A habit can be renamed and deleted** (`renameHabit`, the habit's page),
  which it could not be at all — asked as *"is there a way to adjust my
  habits?"* Adding (Me) and colour and state (the habit's page) existed and
  were not findable from Today, so the Habits heading there now carries an
  Edit link to Me. Delete is two taps and says how it differs from Retired:
  retiring keeps the history, deleting takes it off every screen (every
  reader of habitLogs joins to LIVE habits, so orphaned logs show nowhere).

- **A habit can have a RHYTHM — "3 times a week, no particular days"**
  (`Habit.timesPerWeek`, `habitWeek` / `timesThisWeek` / `rhythmLabel` in
  [habits.ts](src/lib/habits.ts), `setHabitRhythm`,
  [habits.test.ts](src/lib/habits.test.ts)). Asked for as *"a way to track
  weekly habits (e.g. 3 times a week) without specific days"*. Every habit
  showed on Today every day, so one meant three times a week sat there
  un-ticked on the other four — **an overdue state arriving by accident**, in
  the app whose first rule is that it does not have one.
  **A rhythm can be satisfied; it can never be missed**, and that sentence is
  the whole design. Nothing counts what is left (no "1 to go", no bar, no
  fraction anywhere); a week that came up short is never mentioned, on Monday
  or ever; and the number is only ever one you typed — nothing is inferred
  from how often something happens to get logged, which is the judgement the
  old tracker made and lost trust over. **Meeting it is the only thing it
  changes**: the habit settles to the end of the row and drops out of the
  wave for the rest of the week. That is permission to stop, which is the
  opposite of a target.
  **"2 of 3" is deliberately never rendered**, and the difference from the
  banned "out of 7" (weekly.ts) is WHERE THE DENOMINATOR CAME FROM: seven is
  a number the app would be inventing on your behalf, three is one you set.
  That is the argument to check anything new here against — and the chip says
  "2 this week", a fact, with the rhythm itself living on the habit's own page.
  **The chip now answers two questions with two channels.** THE CIRCLE IS
  ALWAYS TODAY — it is what the tap does, and a tap must always be visible.
  THE FILL ANSWERS THE HABIT'S OWN QUESTION: "today?" for a daily one, so the
  two coincide exactly as before; "this week?" for one with a rhythm, so it
  fills on the third and stays filled whether or not today was one of them. A
  line under the name says which state it is in in words, because the colours
  alone were misread once already ("it looks like some are ticked off").
  **A count, never a set of weekdays.** Picking Mon/Wed/Fri would make four
  days of the week something to be late for; the request said "without
  specific days" and the rule agrees with it.
  Only up to today counts (a log dated later in the week comes from a device
  whose clock is ahead, and would call the rhythm kept before it was), and a
  date counts once however many rows say so, since two devices can each write
  it before they merge. `weekStart` moved to [days.ts](src/lib/days.ts) so the
  look-back and a rhythm cannot disagree about which seven days a week is.

- **What you have done: MILESTONES, which are not streaks**
  ([milestones.ts](src/lib/milestones.ts),
  [MilestoneCard.svelte](src/lib/components/MilestoneCard.svelte),
  [milestones.test.ts](src/lib/milestones.test.ts)). Asked for with the danger
  named in the same breath, which is why it could be built at all: *"I know
  streaks are dangerous, because when you build one up and then lose it, it can
  trigger me to give up instead of rebuilding. But it would be nice to have
  something that tells me: you did this habit 100 times. Or 4 consecutive weeks
  of ear training. Something that pushes me to keep going without leaving the
  emptiness of losing."*
  **THE BAN IS NOT ON COUNTING — IT IS ON A NUMBER YOU CAN LOSE.** The app
  already counts, on every habit row ("47 logged") and in the cycle history,
  and nobody ever objected to those. What a streak adds is that the number is
  LIVE: it sits on screen at 23, you watch it, and one quiet Tuesday it reads
  0. That zero is the thing this app exists not to do, and the old system's
  whole failure in one digit.
  So every milestone is **past tense and permanent**, the same shape as a win
  in the wins feed or a finished project: reached on a day, and nothing that
  happens afterwards removes it or reduces it. The rules that keep it there,
  all pinned by tests: **no run in progress is ever shown as a number**, so
  there is nothing to watch and nothing to drop; **nothing says a run ended**,
  or was broken, or was your best; **nothing says how far it is to the next
  one**, because a card that hands you the next number turns what you did into
  what you have not done yet.
  **All time, never per year.** The request said "100 times this year", and a
  yearly count is a streak with a calendar for a trigger — on 1 January a habit
  done 300 times reads 2, which is precisely the emptiness being avoided.
  **One line per RUN, at the highest it reached** (4, 8, 12, 26, 52 weeks), so
  a twelve-week run is one entry rather than three, and **a later run earns its
  own line** rather than being compared with the first: coming back and doing
  four more weeks is recognised, which is the exact moment the old system
  punished. A week counts when the habit met its OWN rhythm — three times for
  a habit meant three times a week — since "at least once" would hand a weekly
  habit runs it did not do.
  Derived from the logs every time, never stored: no table, nothing to migrate,
  and a log arriving from another device counts the moment it lands. The moment
  is found by asking whether any milestone is dated TODAY, which is stateless;
  the cost is that unticking and reticking the hundredth replays the card, and
  that is a shrug next to a table for remembering confetti.
  Not done and worth considering: naming milestones reached in the weekly
  look-back, which is already a "what happened" surface.

- **GOALS ARE NOT A SECOND CONCEPT — they are a habit with a rhythm.**
  Proposed as *"maybe we should have goals next to habits. Habits are daily
  things, goals are weekly things you want to do. A habit would be every day I
  do my ear training; a goal would be at least three times a week I go to the
  gym."* That is exactly `Habit.timesPerWeek`, which shipped two days earlier —
  the gym habit set to 3×, asking on no particular days and settling once the
  week has had its three.
  **The reason to refuse a second table is the one written at the top of this
  file.** Two parallel systems for the same shape of thing, with nothing to
  tell you which one something belongs in, is precisely what killed the
  previous app: blocks above the tabs and to-dos inside them, and a photo that
  belonged to neither. A Goal would need its own logs, its own row on Today,
  its own history, its own place in the weekly look-back — all of it a copy of
  what habits already do, and the first question every morning would be "is
  this a habit or a goal?"
  **The two DO look different on Today now**, asked for straight after —
  *"can you try the split?"* — and it is a rendering change and nothing else:
  "Every day" then "This week", under the one Habits heading, still one table
  and one concept. It earns its keep because the two read differently: an
  every-day habit sitting un-ticked means today, and a three-times-a-week one
  sitting un-ticked on a Tuesday means very little.
  **Headed only when both kinds exist.** One heading over the only group there
  is costs a line of the calmest screen in the app and says nothing.
  **One `Reorder` per group, which is not optional**: a single instance orders
  by document position, so it would read the two lists as one column and let a
  habit be dragged under the other heading — moving it on screen while
  changing nothing about it, so it would snap back on the next render. Each
  commits the WHOLE order with its own group rearranged in place, so
  `Habit.order` stays a total order and the groups cannot interleave.
  **The chips live in a snippet taking the list and the drag**, so the two
  groups cannot drift apart — and the `{#each}` is INSIDE the snippet, because
  `animate:flip` must be on the only child of a keyed each and a `{@render}`
  in between breaks that.
- **A to-do's DAY can be set inside a project, not only from Brain**
  (the project screen's row editor and its add form, `WhenPicker`). Asked for
  directly. Every other field was editable there — name, blocker, both sizes,
  photo, where it belongs — and the one that says WHEN was only in Brain, so
  the to-do written ten seconds ago had to be found again on another screen.
  It is the same WhenPicker Brain uses, so the chips cannot drift, and it sits
  at the TOP of the editor while "Do it today" stays down in the action row:
  a date feeds Free Time's obligation slot and Brain's day list, that button
  puts it in today's three, and two controls saying "Today" a centimetre apart
  read as one. The row footnote names the day now (leading, ahead of the
  sizes) — without it, a date set on this screen would be invisible from it.
  The add form offers it too, and the day STAYS between to-dos like the sizes,
  since a run of them written in one go is usually for one day; the photo is
  still the odd one out and resets.
  **And the ERA OVERVIEW was missed the first time round**, reported a day
  later: *"from the project page I couldn't set a date for these to-dos, only
  in Brain."* Those particular to-dos were filed to the era with no project,
  so they live on `/projects/[id]` — a different file, with its own row editor
  — and only the project screen had been given the picker. Same lesson as
  *"a to-do can be re-filed after it is written"*, which landed on the project
  screens while Brain kept the gap for months: **WHEN A CAPABILITY IS ADDED TO
  ONE LIST, CHECK EVERY OTHER SCREEN THAT SHOWS THE SAME ROWS.** There are
  three: Brain, the era overview, the project. The era row also printed the
  raw `2026-09-21`; it names the day now, like every other list.

- **The assistant could not set how long a to-do takes, and did not know what
  day it was** ([gemini/tools.ts](src/lib/gemini/tools.ts) `create_todo`,
  [gemini/assistant.ts](src/lib/gemini/assistant.ts),
  [assistant.test.ts](src/lib/gemini/assistant.test.ts)). One sentence exposed
  both: *"add two to-dos for tomorrow… both are quick, 20 minutes to-dos"*
  arrived undated and with no duration.
  **`create_todo` had `energy` and no `takes`.** The app has had two
  independent sizes for months (sizes.ts: how much head, and how long) and the
  tool only ever offered the first, so the twenty minutes had nowhere to go —
  a model cannot fill a field that is not in the schema. Both are there now,
  each saying in its description which words belong to it, and the prompt says
  a sentence often gives BOTH.
  **Nothing ever told the model the date.** `date` wants YYYY-MM-DD and the
  model has no clock, so "tomorrow" could not be expressed and came out as
  Someday — correctly, by its own rules. The system instruction now carries
  today's weekday and ISO date, and tomorrow's.
  **The no-date rule had to be reworded, not relaxed.** It said *"never set a
  date unless they stated a real deadline"*, which a model can read as "only a
  hard external commitment". A day they SAID — tomorrow, Friday, the 3rd — is
  stated, and refusing it is the app losing information the user gave it. What
  stays banned is inventing one because something sounds urgent: that is what
  would manufacture the overdue state this app does not have.

- **A suspended phone never renews its Google token, and that is why a day
  away ended signed out** ([auth.ts](src/lib/google/auth.ts)
  `startRenewalWatch`, [auth.test.ts](src/lib/google/auth.test.ts),
  [ReconnectNotice.svelte](src/lib/components/ReconnectNotice.svelte)).
  Reported as *"I get logged out of Google a lot. If I don't interact for a
  day it logs out."* `renewIfSafe`'s own comment said it runs at "app start, or
  returning to a backgrounded app" — and only the app-start caller was ever
  wired, in the layout's `onMount`. An installed app on iOS is SUSPENDED rather
  than closed, so onMount may not run for weeks: the app comes back holding an
  hour-old token, sync pauses on `no-token`, and nothing ever tries again. The
  calendar cache, the theme and the update check all learned this same lesson
  — a device that has been asleep has to be told to look again — and this file
  is where that belonged the first time.
  **The renewal is refused while a field has focus.** It is a full-page
  redirect; prompt=none returns immediately, but "immediately" is still a page
  load, and losing a half-written capture to a token refresh would be worse
  than the bug being fixed.
  **And when Google will not renew quietly, the app now says so on every
  screen** rather than only in Settings, which is the last place anyone looks
  when nothing appears wrong. One state only: connected before, no usable token
  now. Not offline (the network is broken, not the app), not signed out (there
  is nothing to reconnect to). No dismiss, for the update notice's reason — a
  warning you can wave away leaves you believing everything synced. It names
  what is still true ("Everything is still saved here"), because "sync has
  stopped" reads as "your work is at risk" and it is not.
  **Renewal now happens BEFORE the hour is up, and retries sooner**
  (`RENEW_AHEAD_MS` 10 min, `SILENT_BACKOFF_MS` 5 min, was 30). Reported again
  as *"it's kind of annoying I have to log in every day almost."* Waiting for
  the token to be DEAD put every attempt at the worst possible moment — the
  next morning, when Google is least likely to say yes quietly — and a refusal
  then bought half an hour of not trying. Trying with ten minutes left costs
  one invisible page load while a working token is still in hand.
  **Google's refusal is now recorded and shown** (`Settings.lastSilentError`,
  the Settings status line): login_required, interaction_required and
  consent_required need different answers and were indistinguishable.
  **If it keeps happening on the iPhone, the answer is a tiny auth backend.**
  Google issues no refresh token to a client that cannot hold a secret, so the
  hour is the ceiling for a static site; a Worker holding the secret and the
  refresh token is the only thing that removes the daily tap. That breaks "no
  backend" for sign-in alone — data stays local and in Drive — and is Toon's
  call to make, with the error code above as the evidence.
  **This reduces the frequency; it cannot guarantee a renewal succeeds.**
  prompt=none needs a live Google session in this browser, and an installed
  iOS web app does not necessarily share Safari's. When Google declines, a tap
  is the only way through — which is what the notice is for.
  **And the first real reading came back `interaction_required`, from a
  LAPTOP that was signed in to Google in the same browser at that moment**
  (`Settings.googleAccountId`, `login_hint` in beginSignIn, `rememberAccount`).
  That combination rules out the session — which is what `login_required`
  would have said — and leaves the other thing prompt=none cannot do: PICK AN
  ACCOUNT. "Do this without showing me anything" is unanswerable in a browser
  holding two Google accounts, because the account chooser is interaction, so
  Google refuses. Nothing in the request said which account it was.
  It does now, on SILENT attempts only: an explicit sign-in must still offer
  the chooser, or the app quietly becomes single-account with no way to switch.
  The id is `sub`, read once from Google's `tokeninfo` endpoint, which needs no
  extra scope — asking for `email` instead would put a fresh consent screen in
  front of every existing install to learn something we do not otherwise want.
  **A failed lookup must cost nothing**: with no hint stored, a renewal is
  exactly what it was before, so the fetch is swallowed whole. Devices that
  predate this learn the id at app start while a working token is still in
  hand, rather than waiting for the very failure it prevents.
  **THE HINT WAS NEVER ACTUALLY SENT, and the app had to be made to say so
  before anyone could know.** The Settings line came back as *"That attempt did
  not name your account"* while the same card named the account —
  develteretoon@gmail.com — three lines lower. Both were true: the email comes
  from Drive's `about`, and the id came from `tokeninfo`, which never produced
  one. **tokeninfo answers about the TOKEN, and this token carries no identity
  scope** (drive.file and calendar.readonly; no openid, no email, no profile),
  so Google can answer 200 with neither `sub` nor `email` in it. The comment
  sitting over that code said "sub always is", which was a guess written as a
  fact, and it cost a day of looking at the wrong half of the problem.
  **login_hint takes an email address OR a sub** — Google's own wording — so
  the fix is to use the address, which is the one that reliably arrives,
  because Drive will always say whose Drive it is. A second bug came out with
  it: a bare `return` when tokeninfo was not ok also skipped the email lookup
  below, so one failure took out the fallback for itself. Two blocks now,
  neither able to abort the other.
  **The lesson is the diagnostic, not the bug.** Three rounds were spent on
  session state, publishing status and account ambiguity while the request was
  quietly going out without the parameter meant to fix it. When a fix depends
  on something being SENT, make the app report what it sent — a guess about
  your own code is worth no more than a guess about Google's.
  **The reason now SURVIVES the reconnect that fixes it** (`lastSilentErrorAt`,
  shown in Settings as "Google last refused a quiet renewal 6h ago —
  interaction_required"). It used to be cleared on a successful sign-in, which
  destroyed the evidence with the very action taken to fix the problem: reading
  it meant noticing the notice, resisting the tap, and going to Settings first.
  A failure that happens overnight cannot be diagnosed by catching it in the
  act. `lastSilentAuthAt` is still cleared, since that one means "an attempt is
  in flight"; the reason and its time are history and are kept.
  **The second half was not code at all: the consent screen was in TESTING
  mode, and Google expires a testing app's grant after SEVEN DAYS whatever the
  flow.** So a re-sign-in roughly weekly was the documented behaviour of that
  setting rather than a bug here, and no amount of renewal logic could have
  fixed it. Published to external production on 20 September 2026; the app
  stays unverified, which costs a one-time "unverified app" warning
  (Advanced → Go to FreeTime) and nothing else at this scale. **Moving it back
  to Testing brings the weekly sign-in back**, which is why config.ts now says
  so beside the scopes.
  **Publishing needs a privacy policy URL, which is why the app has a
  `/privacy` page** ([privacy/+page.svelte](src/routes/privacy/+page.svelte),
  linked from Settings → Data). Google refuses to switch an app to external
  production without a valid app name, support email, home page AND privacy
  policy — so the page is the price of not being signed out every seven days.
  It is written as FACTS ABOUT THIS APP, not boilerplate: every claim names
  something checkable in the code (drive.file only touches files this app
  made, calendar events are read and never stored, the Gemini key lives only
  in IndexedDB, the map asks OpenStreetMap for tiles and never uploads a
  coordinate). **If the app ever starts doing something else, that page is
  wrong and has to change with it** — a privacy policy describing a different
  app is worse than none. Its date is `__APP_VERSION__`, so it cannot drift
  from the build it describes. Home page is the app's own URL; the App logo
  stays EMPTY on the Branding page, since uploading one forces the brand
  verification review that publishing is meant to avoid.

- **"Connected" with a dead token had no way forward but Disconnect**
  ([settings/+page.svelte](src/routes/settings/+page.svelte) `needsFreshSignIn`).
  Reported twice, weeks apart: *"I again needed to disconnect my google and
  reconnect in order for things to sync up."* A laptop signed in on Saturday
  and opened on Monday has an hour-old token and `googleConnected` still true.
  The silent renewal runs at launch; when Google declines to do it quietly —
  which is Google's call and not a bug here — the app is left holding nothing.
  **The screen then showed only "Sync now" and "Disconnect", because Connect
  lives in the not-connected branch.** So the one action that fixes it was
  reachable only by disconnecting first, which reads like throwing your setup
  away in order to get it back. The status line was already correct ("Google
  wants a fresh sign-in — it would not renew quietly"); diagnosing accurately
  and then offering no way to act is its own failure, and the sibling of the
  "signed out of a device that never signed in" bug two entries below.
  If this recurs even WITH the button, the next thing to look at is the flow
  itself: Google has deprecated the implicit flow for client-side apps in
  favour of Google Identity Services, whose token client can refresh silently
  in an iframe instead of a full-page redirect. That is a real change, not a
  tweak — read the "Google gives a static site no refresh token" trap first,
  because the constraint that forced this design has not gone away.

- **The add field starts closed, behind a "+ Add" button**
  ([AddField.svelte](src/lib/components/AddField.svelte), the project screen's
  To-dos section and Brain → To-dos). Toon's words: *"it's not very clean to see
  the add bar above the to do's that are already there... I would just put an
  +add button and have the already added to do's below it."* A text input parked
  permanently over a list is furniture you read past every visit, competing with
  the thing you came to look at.
  **This is NOT the bug that was fixed two commits earlier, and the difference
  has to stay clear.** The field used to vanish BY ITSELF — it rendered only
  while the list was empty or while the add sheet had just chosen it, so writing
  one to-do made it disappear with no control left behind and nothing to explain
  it. Here the button is always there and the field closes only when you close
  it. If a future report says "the add field is gone", check which of these two
  it is before changing anything.
  **The fast path is preserved deliberately.** Opening focuses the field, so the
  tap that opens it is the tap that starts writing; adding does NOT close it and
  re-focuses, so five to-dos are still type-Enter-type-Enter and not five taps
  on a button. Escape closes, and so does the button, which says **Add** with
  something typed and **Done** on an empty field — one control for the two
  things there are to do at that moment, rather than a disabled Add sitting next
  to a Close.
  **The closed button is solid with accent text, and both halves of that are
  load-bearing.** Dashed would twin the project screen's "+ Add to <project>",
  which is the primary way in and covers every kind of thing — two identical
  dashed boxes stacked at the top of a project read as one button drawn twice.
  Muted grey on a faint ground would twin the to-do rows directly beneath it and
  read as an empty row. Accent text on `bg-surface-1` is neither.
  Still on the older always-open bar: Brain → Ideas, Brain → Buy, and the
  project screen's To buy section. Swapping them over is passing `AddField` the
  same three props; it was left alone because only to-dos were asked for.

- **Everything written in one field can be renamed afterwards**
  ([RenameField.svelte](src/lib/components/RenameField.svelte)). Reported
  plainly: "once you've hit add you can't adjust name anymore". It was true of
  to-dos, ideas and buy items — you could change a to-do's era, project,
  effort, duration, date and what it waits for, but not what it *said*. That is
  backwards: capture is one field typed at speed, which is the whole point of
  it, and the cost of speed is typos and names that turn out to be wrong an
  hour later. The field sits at the top of the row editor that already exists,
  so nothing new opens.
  `value` rather than `bind:`, because the row underneath is a liveQuery and a
  sync landing mid-edit would fight the cursor; it saves on blur and on Enter.
  **An empty name is refused, not saved** — a row with no text cannot be read,
  cannot be tapped open, and therefore cannot be renamed back.

- **A list for a day is a DATE, not a new kind of thing** ([days.ts](src/lib/days.ts),
  Brain → To-dos). Asked for as *"a to do list for a day... that doesn't have to
  belong to an era or project but is just all the things I need to do that day"*.
  A to-do already has `date`, so the day chips are that field used as both the
  filter and the destination — the same rule as the Ideas project chips and the buy
  list, where whatever you are looking at is where a new one lands. No table, no
  new concept, and no third level: it cuts ACROSS eras and projects rather than
  sitting under one, and because it is the same field, anything on a day list
  already feeds Free Time's obligation slot and already shows under "Has a date".
  **It is deliberately not the Today screen's three slots.** Three is a hard
  ceiling with an unlock behind it and the constraint IS the feature (spec 5.3);
  "everything I have to do tomorrow" is a different question, and pushing it
  through the three would either break that mechanic or lose most of the list.
  **But TODAY's day list is shown on Today, under the three** (`dayList` in
  [+page.svelte](src/routes/+page.svelte), "Also on today's list"). Keeping it
  off that screen came back as *"I just added some to-dos from the brain area
  and added them for today, but they don't appear on the today page. That
  seems like a mistake no?"* — it was. Keeping the two concepts apart was
  right; hiding a list you wrote FOR TODAY from the screen called Today reads
  as losing it, and putting the two controls far apart in the editor did not
  prevent the confusion. The day list takes no slot, does not count towards
  closing the day and does not wave. **Only today's date**: yesterday's
  unticked list does not follow you forward, since that is an overdue pile by
  another name. Ticked rows stay, sunk.
  **A row on Today opens to change its day**, which is what makes a date usable
  for something that waits on somebody else. Asked from a real situation: an
  organiser emails about next year, the band is asked in Messenger, *"this can
  take a few days before everyone replies... I won't check that project every
  day so that to-do might get lost."* The answer is a date — a dated to-do
  comes to Today by itself, wherever it lives — but the loop is: look at it,
  find nobody has answered yet, push it a day. That push used to mean a trip to
  Brain or into the project, which is far too much friction four mornings
  running.
  **The app still never carries it forward.** Yesterday's list does not follow
  you here, for the reason above; what changed is only that carrying it is one
  tap instead of four. And a day that IS missed is not lost — Free Time's
  obligation slot takes dated to-dos oldest first and says "Dated 23 Sep",
  which is a fact rather than an accusation.
  **The same WhenPicker as everywhere else**, so there is one way to say when a
  thing is for. **Worded as a date, never as "Tomorrow instead"**: that control
  on a slot card moves a to-do into tomorrow's THREE and sets no date, and two
  controls a centimetre apart saying the same word would be read as one thing —
  the mistake already recorded about "Today".
  The drag is turned off while a row is open (`{ id, off }`), since a hold in
  an open row is for the row, not for moving it.
  **A day list reads DOWN ITS CHAINS** (`byDayList` takes a `TodoIndex`).
  Reported as *"the also-on-this-day to-dos don't respect the order of to-dos
  if you had given them a comes-after setting."* It sorted by the dragged
  order alone and never looked at `after`, so "sow the grass" could sit above
  "remove the bamboo" — on the one list whose entire point is reading top to
  bottom, and while every other list that shows a chain already read down it.
  **Depth beats the drag**, exactly as `readyFirst` does on a project screen:
  dragging a blocked row above its blocker snaps back, because the link is a
  fact about the work while the drag is a preference about the rest. Within
  one depth the dragged order is untouched, and a blocker that gets ticked
  stops holding anything down, since `blockerOf` ignores a completed one.
  **The index must be EVERY to-do, not the day's.** A blocker filed in a
  project you are not looking at is still a blocker; an index of the visible
  rows alone would fail to resolve it, read the link as dangling and quietly
  sort the row as ready. Pinned by a test that puts the blocker on another day.
  **And the row now says what it waits for**, leading the footnote: the list
  is sorted by something invisible otherwise, and an order you cannot explain
  reads as an order that is wrong. Both day lists — Today's and Brain's — pass
  the index, because the same list on two screens must not be in two orders.

  **A TO-DO CAN COME ROUND AGAIN** (`Todo.repeatDays`, `TodoLog`, db v8,
  [recurring.ts](src/lib/recurring.ts),
  [RepeatPicker.svelte](src/lib/components/RepeatPicker.svelte),
  [recurring.test.ts](src/lib/recurring.test.ts)). Asked for plainly: *"we need
  to put the trashcans outside every Thursday evening, so I would like that it
  would appear in my Today page every Thursday."*
  **It is a to-do and not a habit, although the machinery rhymes.** A habit is
  about you and is deliberately day-less — *"3 times a week, without specific
  days"* — because fixing Mon/Wed/Fri turns four days into something you can be
  late for. A bin day is not an ambition: Thursday is a fact about the lorry.
  So it stays in today's list with the day's other jobs and never joins the
  habit chips, the heatmap or the milestones. Toon chose this shape over the
  habit one when both were offered.
  **AND IT IS NOT A DATED TO-DO PER WEEK, which was the obvious build and is a
  trap.** Free Time's obligation slot takes dated to-dos with a date of today
  or earlier, oldest first — so generating one per Thursday means a single
  missed bin day becomes the first thing Free Time offers for the rest of time.
  An overdue pile arriving through the back door of the mechanic that exists to
  prevent one. **One row plus a log per day it was done has nothing to
  accumulate**: a missed Thursday is a Thursday with no log, counted by
  nothing.
  `TodoLog` is habitLogs' twin down to the `[todoId+date]` compound index and
  the undelete-rather-than-insert in `toggleTodoLog`, which keeps one id per
  day so two devices ticking the same Thursday merge instead of stacking.
  **`repeatDays` and `date` are mutually exclusive** and `setTodoRepeat`
  enforces it: a thing that happens every Thursday is not also promised for the
  14th, and Today would otherwise have to pick which of the two it was showing.
  **Free Time never offers one** (`repeats` in the pool filter): with no
  `completedAt` by design it would sit in that pool for ever and be suggested
  on a Tuesday, and "free time?" is a question about an hour, not a reminder
  that Thursday is bin day. It still appears on its own days and still ticks —
  the app stops suggesting and never forbids, the same asymmetry a blocked
  to-do has.
  The row says "Every Thursday" in words next to its project; opening it offers
  **Repeats** where an ordinary row offers **When**, since a repeating row has
  no day to move — it has days it comes round on.
  **AND IT SHIPPED MISSING FROM THE PROJECT'S ADD FORM — the same gap, for the
  THIRD time, in the very commit whose message cited the rule.** Reported
  within the hour: *"I went into my Family era, to House project, wanted to add
  the trash cans recurring to-do there but I don't see the option."* Prose in
  this file did not stop it, so [screens.test.ts](src/lib/screens.test.ts) now
  does: it reads the route SOURCES and asserts that every screen a to-do can be
  written or edited on offers all five controls. Unusual, and deliberate — the
  failure is never in the logic, it is a control absent from one file, and
  nothing rendered can notice something that was never there. When a fifth
  place to write a to-do appears, add it to that list; that is the whole
  maintenance cost and it is cheaper than the bug.
  **The assistant can set all of it too** (`repeatWeekdays`, `afterTitle` on
  `create_todo`), asked for in the same breath: *"the assistant should be able
  to set all the same things I could do manually."* Weekdays go by NAME,
  because a model has no reason to know 0 is Sunday; the blocker goes by TITLE,
  because the digest hands it titles and no ids, and it is resolved inside the
  same era and project when Add is tapped — **a title that is not there is
  dropped**, exactly as a project name the era does not have is dropped, since
  a to-do blocked on a row that does not exist would sit unstartable with
  nothing to explain it. The review panel offers both as controls, so the id
  path (what the panel knows) and the title path (what the model can say) meet
  in one place: `after` wins over `afterTitle` when both are set.

  Two details that are not decoration: a day list sorts OLDEST first, because a
  plan for a day reads top to bottom while every other list is a feed where the
  newest is what you came back for; and the row footnote NAMES the date
  ("Tomorrow"), dropping it entirely inside a day list where it is already the
  heading. `shiftDay` builds dates from parts and never `new Date('2026-09-06')`,
  which is UTC midnight — the day before, anywhere west of Greenwich, which would
  quietly file things on the wrong day.
- **EFFORT AND DURATION ARE TWO AXES. Do not collapse them again.** `Todo.energy` is
  how much of your head a job takes; `Todo.takes` is how long it takes, in the same
  buckets Free Time asks about. Free Time filters on both, independently: how your
  head is bounds the effort, how much clock you have bounds the duration. There used
  to be a `TIME_CEILING` mapping a time window onto an effort ceiling — twenty minutes
  free meant "quick wins only" — and it is simply wrong. Toon's words: *"a quick win
  means it doesn't take much effort, but it doesn't mean it can't take much time. You
  can spend a whole day on quick wins."* Sanding a board is easy and takes an
  afternoon; a decision you have been avoiding is twenty minutes of hard thinking.
  I had it wrong twice — first by conflating them in the planner, then by relabelling
  the effort chips as durations, which deleted the effort axis entirely.
  **Both stay optional** and unset passes either filter, for the reason above.
- **Nothing in the Free Time flow may await the network with the screen unchanged.**
  Choosing a head state awaited `generateQuestions()` — a Gemini round trip — with no
  busy state and no guard, so the tap appeared to do nothing, got repeated, and each
  repeat fired another request until one returned and the flow lurched forward.
  Reported as *"I pressed many buttons but it didn't move on, and then suddenly it
  did."* The buttons now disable on the first tap, the step says what it is waiting
  for, and the call has a 6-second deadline after which the static questions run —
  which are not a degraded mode, they are what runs with no key at all.

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
  while a chip is lit files it there. **Renaming a project must carry all six**
  (to-dos, ideas, memos, note, blocks, shopping); miss one and it is not
  deleted, it is invisible, which is worse. Pinned by
  [notes.test.ts](src/lib/notes.test.ts) and, for ideas,
  [ideas.test.ts](src/lib/ideas.test.ts). Removing a project unfiles its
  to-dos, recordings and ideas back to the era but deliberately leaves its note
  and blocks on the old name, so recreating it brings them back — a test pins
  that, so it is not an oversight to "fix".
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
