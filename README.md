# FREETIME

A personal life-organizer PWA. Single user, local-first, no backend.

The full design rationale lives in [freetime-spec.md](freetime-spec.md) — that document is
the source of truth. This file covers how the code is put together and how to run it.

---

## What exists today

Phase 1 of the eight-phase plan in spec §10, plus the data foundations for the rest.

| Working | Where |
| --- | --- |
| Capture box — one field, Enter, done | [CaptureBox.svelte](src/lib/components/CaptureBox.svelte) |
| Today screen with the three + the unlock rule | [routes/+page.svelte](src/routes/+page.svelte) |
| Projects grid with pulse (no progress bars) | [routes/projects/+page.svelte](src/routes/projects/+page.svelte) |
| Project detail — Notes / To-dos / Buy | [routes/projects/[id]/+page.svelte](src/routes/projects/%5Bid%5D/+page.svelte) |
| Brain — inbox, all to-dos, ideas, lists, buy | [routes/brain/+page.svelte](src/routes/brain/+page.svelte) |
| Me — habits, wins history | [routes/me/+page.svelte](src/routes/me/+page.svelte) |
| Day-close screen | [DayClose.svelte](src/lib/components/DayClose.svelte) |
| Full schema for every record type in spec §3 | [db.ts](src/lib/db.ts), [types.ts](src/lib/types.ts) |
| Installable, offline-capable PWA | [vite.config.ts](vite.config.ts) |

Not built yet, in the spec's order: the Free Time question flow and AI ranking (2),
Google OAuth + Drive sync (3), Gemini assistant and voice capture (4), habit cycle
history and heatmap (5), monthly summary (6), list detail screens (7), Calendar (8),
and the Notion importer.

The Today screen currently fills its three slots by picking from open to-dos by hand.
Phase 2 replaces that picker with the real Free Time flow; the day/unlock machinery it
writes to is already in place and enforced.

---

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site into build/
npm run preview  # serve build/ locally
npm run check    # svelte-check, TypeScript strict
```

Everything runs with no network, no accounts, and no keys. That is the point — the AI
is an accelerant, never a dependency (spec §7.4).

---

## How it fits together

**SvelteKit with `adapter-static`.** The whole app compiles to plain HTML/JS/CSS. There
is no server at runtime; GitHub Pages just serves files. `fallback: '200.html'` makes it
a single-page app, so a hard refresh on `/brain` doesn't 404.

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

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which builds and publishes to GitHub Pages. `configure-pages` has `enablement: true`, so
Pages switches itself on the first time the workflow runs — no settings toggle needed.

This is a **user repo** (`Sadonnodas.github.io`), served from the domain root. A project
repo would serve from a subpath and require `paths.base` juggling in every link, plus a
messier OAuth redirect URI.

## Secrets

There are none in this repo, and there must never be any.

- The **Gemini API key** is pasted into Settings by the user and stored in IndexedDB. It
  is visible in their own browser's network tab, which is acceptable for a single-user
  app on their own device. Restrict it by HTTP referrer to the Pages origin in Google
  Cloud Console.
- **Google OAuth** uses the PKCE flow as a public client — no secret exists to leak. The
  refresh token is stored in IndexedDB.

Both land in phase 3/4. Nothing is read from `.env` at build time.

## Icons

`static/icons/*.png` are generated placeholders — a dark tile with an accent ring — made
by [scripts/make-icons.mjs](scripts/make-icons.mjs) (a dependency-free PNG writer). Drop
real artwork in with the same filenames to replace them, or edit the script and re-run
`node scripts/make-icons.mjs`.
