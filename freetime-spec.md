# FREETIME — Build Specification

A personal life-organizer PWA. Single user. Static hosting, local-first, Google Drive sync, Gemini-powered capture and planning.

This document is the source of truth for the build. Read it fully before writing code.

---

## 0. Context for the implementer

**Explain as you go.** The user is building this for themselves and wants to understand and maintain it, not receive a finished black box. Narrate what each piece does and why, in plain language. When you make a choice with a real trade-off, say what the alternative was and why you didn't pick it. When you introduce a library, pattern, or piece of browser API, explain it briefly the first time rather than assuming familiarity. Prefer boring, readable code over clever code, and comment the non-obvious parts.

Ask when something is genuinely ambiguous rather than guessing and building the wrong thing.

This app replaces an abandoned Notion workspace. The abandonment cause is documented and drives most design decisions:

- **Too much structure.** Nine projects × a per-project template = 443 files holding ~124 real records. Every project page was empty boilerplate.
- **No visible output.** Completed items disappeared. The app only ever showed the backlog.
- **Habit tracker with 216 auto-generated rows and 4 total check-ins**, all on one day. The user *did* the habits; the system didn't notice, so it gave nothing back.
- **Two competing taxonomies** (Projects + Workstreams) that neither replaced the other. 46 of 112 todos had no workstream, 27 had no priority, 69 had no date.
- **The system lagged behind the user's interests.** The activity currently consuming all their free time (disc golf) does not appear anywhere in the export.

**Therefore, non-negotiable principles:**

1. **Capture must be under 5 seconds.** No required fields. Ever.
2. **Completed items are never deleted and never hidden.**
3. **Nothing is ever "overdue."** Undated items wait patiently.
4. **A new project/habit/list is one tap and one field.**
5. **Every AI feature has a working non-AI fallback.** The app must be fully usable offline with no API key.
6. **No streaks, no completion percentages, no weekly planning.**

---

## 1. Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | SvelteKit + `adapter-static` | User has prior SvelteKit experience |
| Language | TypeScript, strict | |
| Local store | IndexedDB via **Dexie** | Single source of truth at runtime |
| PWA | `vite-plugin-pwa` | Offline shell, installable, standalone display |
| Styling | Tailwind | Mobile-first, large tap targets |
| Hosting | GitHub Pages on a **user repo** (`<user>.github.io`) | Avoids base-path config and simplifies OAuth redirect URI |
| Sync | Google Drive REST v3 | |
| Calendar | Google Calendar REST v3, read-only | |
| AI | Google Gemini API (`gemini-2.5-flash`) | Direct browser calls |

**No backend. No server. No build-time secrets.**

---

## 2. Credentials — two separate things

Do not conflate these.

### 2.1 Google OAuth (Calendar + Drive)

- **PKCE flow, public client, no secret.**
- Scopes: `https://www.googleapis.com/auth/calendar.readonly`, `https://www.googleapis.com/auth/drive.file`
- `drive.file` grants access only to files the app itself creates — non-sensitive, and it keeps the rest of the user's Drive out of scope.
- `calendar.readonly` **is** a sensitive scope. Leave the OAuth consent screen in **Testing** mode with the user as the sole test user. This avoids Google verification entirely; cost is a one-time "unverified app" warning.
- **Use the redirect flow, not a popup.** Popups break out of iOS standalone PWA mode and lose the session.
- Store refresh token in IndexedDB. Refresh silently on 401.

### 2.2 Gemini API key

- Obtained by the user from Google AI Studio. **Pasted into Settings once**, stored in IndexedDB.
- Never in the repo, never in the build, never in `.env` committed to git.
- The key is visible in the user's own browser network tab. That is acceptable for a single-user personal app on their own device.
- **Mitigation to implement/document:** in Google Cloud Console, restrict the API key by HTTP referrer to the GitHub Pages origin.
- If no key is present, all AI features degrade gracefully (see §7.4).

---

## 3. Data model

All records share a base:

```ts
interface Base {
  id: string;           // uuid v4
  createdAt: string;    // ISO
  updatedAt: string;    // ISO — drives sync conflict resolution
  deletedAt?: string;   // tombstone; never hard-delete
}
```

### 3.1 Project

```ts
interface Project extends Base {
  name: string;
  color?: string;
  archived: boolean;
}
```

Seed from the Notion export: Bearfeet, Music, Studio, Campervan, Crafting, Coding, Family, Personal, Work. Add: Disc Golf.

**Flat. One level. No workstreams, no sub-projects.** The old Workstream values (VAEL, Guided Ear Training, Album, Gigs, Merch, BF 2.0, Will Metz Academy, Health) become *projects in their own right* or are dropped — the user decides at import time. Do not model a second hierarchy.

### 3.2 Todo

```ts
interface Todo extends Base {
  title: string;
  notes?: string;
  projectId?: string;              // optional
  energy?: 'quick' | 'moderate' | 'focus';   // optional
  date?: string;                   // YYYY-MM-DD — ONLY for real obligations
  completedAt?: string;            // ISO — set on completion, never cleared by cleanup
}
```

No priority field. Energy + date carry the load. `energy` maps directly from the Notion `Difficulty` column: `Quick Win → quick`, `Moderate → moderate`, `Focus → focus`.

### 3.3 Idea

```ts
interface Idea extends Base {
  text: string;
  projectId?: string;
  promotedToTodoId?: string;
}
```

Ideas are thoughts with no action attached. Promotion to a Todo is one tap and keeps a backlink.

### 3.4 BuyItem

```ts
interface BuyItem extends Base {
  name: string;
  url?: string;
  priceCents?: number;
  currency?: string;      // default 'EUR'
  projectId?: string;
  purchasedAt?: string;
}
```

Import the 12 existing items with their URLs and prices.

### 3.5 List and ListItem

```ts
interface List extends Base {
  name: string;           // "Books", "Albums", "Disc golf courses"
  icon?: string;
}

interface ListItem extends Base {
  listId: string;
  text: string;
  url?: string;
  state: 'want' | 'doing' | 'done';
}
```

**Structurally separate from Todos and must never appear on the Today screen.** A book you want to read is a want, not a task; surfacing it as a task turns it into a small debt. Completing a ListItem *does* emit a win (§6).

### 3.6 Habit and HabitLog

```ts
interface Habit extends Base {
  name: string;
  state: 'active' | 'dormant' | 'retired';
  stateChangedAt: string;
}

interface HabitLog extends Base {
  habitId: string;
  date: string;    // YYYY-MM-DD
}
```

**Critical:** logs are append-only and survive state changes forever. A dormant habit retains its complete history. Moving a habit to dormant is an explicit user choice, not something the app infers from inactivity.

**No streak counting anywhere in the app.** The habit detail view shows a calendar heatmap plus a **cycle history**: `active Jan–Mar · dormant Mar–Aug · active Aug–`. That framing turns "I abandoned guitar again" into "this is the fourth cycle, and they always come back."

### 3.7 Day

```ts
interface Day extends Base {
  date: string;              // YYYY-MM-DD, unique
  slots: string[];           // Todo ids, ordered
  unlockedCount: number;     // starts 3, +1 per unlock
  closedAt?: string;         // set when slot 3 completes
}
```

`slots.length` may never exceed `unlockedCount`. See §5.3.

### 3.8 Note

Project notes are stored as **plain markdown**, one file per project, synced as real `.md` files in Drive. Not a DB record — the point is that they're readable and editable without the app.

---

## 4. Screens

Bottom tab bar, four tabs, nothing nested deeper than two levels.

### 4.1 Today (default)

Top to bottom:
1. **Calendar strip** — today's Google Calendar events, read-only, no interaction. Hidden entirely if calendar isn't connected.
2. **The three** — large cards, tap to complete. If empty: a single prominent **Free Time** button.
3. **Active habits** — a row of large, physical tap targets. Immediate visual response on tap.
4. **Capture box** — pinned to the bottom, always visible, always focused-on-tap.

When the third slot completes, the screen transitions to the **day-close state** (§6.1).

### 4.2 Projects

Grid of cards. **No progress bars.** Each card shows *pulse*:
- Last touched (last completion or note edit)
- Closed in last 30 days
- Open count

Quiet projects look quiet, not failing.

Project detail has exactly three tabs: **Notes** (markdown editor), **To-dos**, **Buy**.

### 4.3 Brain

The memory bank. Should feel well-stocked, never overdue.
- **Inbox** — unsorted captures. Swipe left → todo, right → idea, up → list picker. Leaving it unsorted is not a failure state.
- **All to-dos** — filter by project, energy, has-date
- **Ideas**
- **Lists**
- **Buy** (master view, all projects)

### 4.4 Me

Habits (with dormant/retired management), the wins feed, monthly summaries, and Settings.

---

## 5. The Free Time flow

The centerpiece. Invoked when an opening appears in the day.

### 5.1 Question generation

Two questions are **always asked**, though the wording varies:
- Available time → `20min | 1-2h | half day | all day`
- Brain state → `fried | normal | sharp` (maps to `quick | moderate | focus`)

Beyond those, Gemini generates **1–2 rotating questions** so the flow doesn't feel identical every time. It receives current app state (project pulses, open todo titles by project, active/dormant habits, last 14 days of completions) and must return:

```ts
{
  questions: Array<{
    id: string;
    text: string;
    options: string[];
    maps_to: 'time' | 'energy' | 'project_pull' | 'mood' | 'freeform';
  }>
}
```

Rotating questions should be *specific to state*, not generic. Good examples:
- "You haven't touched Campervan in six weeks — is that on purpose?"
- "What do you secretly wish you were working on?"
- "Anything nagging at you that you keep not doing?"
- "Want to finish something, or start something?"

**Cache generated question sets and don't repeat one within 7 days.** Keep a static fallback set of ~12 questions for offline/no-key operation.

### 5.2 Selection

**Hybrid — deterministic filter, AI ranking.** Do not let the model pick freely from the whole database.

1. **App filters** the candidate pool by energy and time. This is pure code, no AI.
2. **Gemini ranks** the filtered candidates into three slots and writes a one-line reason for each.

The three slots:

| Slot | Source | Rule |
| --- | --- | --- |
| **The pull** | The project named in the "secretly wish" answer | The thing they'd have drifted to anyway — now it counts |
| **The neglected** | Quietest project by pulse | **Must be sized to stated energy.** A 5-min quick win when fried, never a focus block |
| **The obligation** | Anything with `date <= today` | Only if one genuinely exists |

Each slot is independently **reshuffleable** and **skippable without ceremony** — no confirmation, no "are you sure", no guilt copy. The neglected slot is the most likely to feel like nagging; make dismissing it frictionless.

If there's no obligation, leave the slot empty or offer a second pull. **Two is a complete day.**

Accepting writes a `Day` record with `slots` and `unlockedCount: 3`.

### 5.3 The unlock rule — implement exactly

This is the single most important behavioural mechanic in the app.

- A day holds **three** items. The UI must make a fourth **impossible to add in advance** — not discouraged, not warned about. Impossible.
- On completing the third: the day is **immediately marked closed and successful**. Show the day-close screen.
- **Only then** does a "one more?" affordance appear. Accepting increments `unlockedCount` and allows one more.
- Repeat indefinitely, one at a time, never visible in advance.

Rationale: four planned means finishing three is 75%. Three planned with a fourth earned means finishing three is 100% and the fourth is a bonus. Identical work, opposite feeling. The user's stated problem is expectation-minus-reality; the only controllable variable is expectation, and it must not float upward during the day.

---

## 6. Wins

**Never manually logged.** Derived entirely from `completedAt` on Todos and `state: 'done'` on ListItems. The user does not reflect on wins spontaneously and will not remember to log them — a feature requiring that would end up as empty as the old habit tracker.

The feed is not a page the user visits. It arrives at the two moments they're already standing still:

### 6.1 Day-close
Triggered by the third completion. Shows today's three, then **everything closed this week across every project**. Dismissible, not persistent.

### 6.2 Monthly
On first open on/after the 1st: *"Last month: 23 things closed across 6 projects"* with the list. Once. Never nags.

A browsable full history lives in **Me** for when they do want it.

---

## 7. Gemini integration

### 7.1 Assistant

A conversational surface (text + voice) that can read and write app state via **function calling**:

```
create_todo(title, projectId?, energy?, date?)
create_idea(text, projectId?)
create_buy_item(name, url?, priceCents?, projectId?)
add_list_item(listId, text, url?)
create_list(name)
create_project(name)
complete_todo(id)
log_habit(habitId, date)
query_state(kind, filters)   // read-only, for "what's open on Bearfeet?"
```

All writes go through the **same local store as manual edits**, so they queue offline and sync identically. Never let the model write to Drive directly.

**Confirm before writing.** Show what will be created as editable chips; one tap to commit, one tap to discard. The user is forgetful, not careless — silent AI writes would erode trust in the store, and the store's trustworthiness is the whole product.

### 7.2 Voice capture

The driving use case: a long unstructured brain-dump that becomes many discrete items.

**Use `MediaRecorder` → audio blob → Gemini multimodal (inline audio).** One round trip returns transcript *and* structured items. Do **not** use the Web Speech API — support in iOS Safari is unreliable and this must work on the user's phone.

Flow:
1. One big button. Tap to start.
2. Record freely — minutes are fine.
3. Tap to stop. Audio uploads, Gemini returns structured items.
4. Review screen: chips, edit, commit. Or commit all.

If offline: **store the audio blob and queue it.** Process when connectivity returns. Losing a brain-dump because of no signal is the worst possible failure for this app.

Practical constraint worth designing around: this gets used in a car. The interaction must be *start it before pulling off* — one large button, audible confirmation tone on start and stop, nothing that requires reading or precise tapping. No review screen shown while recording.

**iOS caveat to verify early:** `getUserMedia` in an installed standalone PWA has historically been restricted on iOS. Test this in Phase 4 on the actual target device before building the review UI on top of it. If it fails, fall back to launching in Safari for capture.

### 7.3 Prompt/state budget

Never send the whole database. Send a compact digest: project names + pulse numbers, open todo titles (title only, capped ~150), active/dormant habits, last 14 days of completions. Target under ~4k tokens.

### 7.4 Degradation — mandatory

| Feature | Without key / offline |
| --- | --- |
| Free Time questions | Static fallback set, rotated |
| Free Time selection | Deterministic rules only (filter + slot rules, no ranking) |
| Voice capture | Queue audio; or hide button and use text capture |
| Assistant | Hidden |

**Every other feature works fully offline with no key.** The AI is an accelerant, never a dependency.

---

## 8. Sync

### 8.1 Model

**Local-first.** All reads and writes hit IndexedDB and return instantly. Sync is a background reconciliation, never in the interaction path. No spinners on write.

### 8.2 Drive layout

A visible `FreeTime/` folder in the user's Drive:

```
FreeTime/
  projects.json
  todos.json
  ideas.json
  buy.json
  lists.json
  list-items.json
  habits.json
  habit-logs.json
  days.json
  notes/
    bearfeet.md
    campervan.md
    ...
```

Notes as real `.md` files is deliberate: the user's data must be readable and editable without the app. If they abandon this project, nothing is trapped.

### 8.3 Conflict resolution

**Per-record, not per-file.** On sync: fetch remote, merge by `id`, higher `updatedAt` wins, union of tombstones. Write back the merged set.

Single user on two devices makes real conflicts rare. Do not build CRDTs. Do keep a small `conflicts` log surfaced in Settings on the rare occasion a record is overwritten within a short window — cheap insurance, quiet by default.

Notes (markdown) are last-write-wins per file; on conflict, keep both as `bearfeet.md` and `bearfeet (conflict 2026-08-26).md` rather than losing text.

### 8.4 Triggers

On app focus, after any write (debounced ~10s), and on a ~5min interval while foregrounded. Never block UI.

---

## 9. Import

A one-time importer for the Notion export (parses the CSVs).

**Import wholesale:** the 12 buy items (with URLs and prices), and the 17 VAEL bug reports as todos on a VAEL project.

**Present for triage, don't auto-import:** the remaining ~95 todos, shown as a swipe-through list — keep / drop / assign project. Forced re-entry is a useful filter; much of the backlog is stale (February dates, already-done items).

**Do not import:** the habit rows (216 rows, 4 real check-ins), the ten duplicated "Ideas & Inspiration" tables (near-empty, full of "Test new idea"), the People table (one row), or the empty project pages.

**Do import as a note:** the Optreden Ardooie setlist. It's the single richest page in the export and it belongs in Bearfeet's notes.

---

## 9b. A second user (future, not v1)

The site is a public URL — anyone can visit it. The **data** is not shared: each visitor signs in with their own Google account and gets their own empty app, backed by their own Drive folder and their own IndexedDB. So a second person can start using it with **zero code changes**.

Two setup steps for a second person:
1. Add their Google account as a **test user** on the OAuth consent screen (Google allows up to 100 while in Testing mode).
2. They enter their own Gemini API key in Settings, or reuse a shared one — the free tier covers two people fine.

**Shared to-dos are a genuinely different problem** and are deliberately not in v1:

- `drive.file` scope only grants access to files this app created. For person B's app to read person A's list file, B must select it once via the Google Picker, which needs the Picker API wired up. Workable, but fiddly.
- Broadening to the full `drive` scope would trigger Google's verification process. Avoid.
- Two people editing the same records is exactly where per-record last-write-wins starts quietly losing edits — the conflict model in §8.3 is designed for one person on two devices, not two people at once.

**If shared lists are ever wanted, build the small version:** one shared list (groceries, house tasks), not shared projects. If real multiplayer is ever needed, a small hosted backend (e.g. Supabase free tier) is less total pain than fighting Drive permissions — but that is a different app and should be a deliberate decision, not a creeping one.

---

## 10. Build phases

Each phase must be independently usable. If the user loses interest at phase 3, they should still have something better than what they had.

| # | Scope | Done when |
| --- | --- | --- |
| **1** | Local-only core: capture, todos, projects, Brain screen, Dexie schema, importer | Usable for a week with real data, no network |
| **2** | The three + Free Time (deterministic rules only, static questions) + unlock mechanic | The daily loop works end to end |
| **3** | Google OAuth + Drive sync + PWA install | Same data on phone and laptop, offline-capable |
| **4** | Gemini: key entry, assistant, voice capture | Brain-dump in the car → structured items |
| **5** | Habits (three states, cycle history, no streaks) | |
| **6** | Wins: day-close + monthly | |
| **7** | Lists (books, albums, disc golf) | |
| **8** | Google Calendar on Today | |

**Calendar is deliberately last.** It's the fiddliest integration and the least essential — the user's calendar already works fine in Google.

---

## 11. Explicitly out of scope

Do not build these, and do not suggest them:

- Streaks or streak-breaking mechanics
- Project completion percentages or progress bars
- Weekly or monthly planning views
- A priority field
- Nested databases, relations, or user-configurable views
- Any "overdue" state, red badge, or nag notification
- Manual win logging
- Multi-user, sharing, or collaboration
- Analytics or telemetry of any kind
