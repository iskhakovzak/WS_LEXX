# Persistence audit: «во многих местах не сохраняется»

Owner's complaint: after a save, things must survive a page reload and an API/site restart, and every screen must
remember its context (day, period, tab, filters, view, selected person, open item, open folder).

This file covers both classes across every route in `App.tsx` and the nav. It records each issue as: what was lost,
the cause, the fix, and how the fix was verified.

## How it was checked

- An isolated database `edge_tracker_persist` on the local Postgres. The API was built from this branch, ran on :8190
  with `JOBS_ENABLED=false` and a proxy that blocks outbound hosts, and applied every migration on start (including
  0274). vite ran on :24710 against that API. Test users were created in that database and tokens were minted for
  them; nobody signed in through `/api/auth/login`.
- **`scripts/persistence-smoke.mjs`** is reusable. It is not part of `pnpm run checks`, and it writes test rows, so run
  it only against a test database.
  - `--phase write` writes in every section, then reads each write back fresh (the same as a reload).
  - `--phase verify` reads everything back after the API has been restarted.
  - `--phase ui` drives headless Chrome over CDP with no extra dependencies. It covers tabs (`role=tab`) and segmented
    controls on 49 routes, URL params that must survive a reload, and a text draft that must survive a reload.
  - `--desk-config` adds the desk-settings round-trips: an emptied scaling rule list, the discipline threshold, and a
    renamed seeded setup.
- Results on this branch:
  - write → reload: 17/17 pass (author notes skipped because the desk switch `nav.authorNotes` is off).
  - API restart → verify: 17/17 pass.
  - UI: every tab, segmented-control, param and draft check passes. `/coach` is excluded by design (see "Not fixed").
- Verified column legend:
  - **R** = write → reload, smoke.
  - **S** = after an API restart, smoke.
  - **UI** = Chrome reload, smoke.
  - **T** = unit or route test.
  - **C** = code path read and typechecked, not round-tripped live.

## Summary

| Class | Found | Fixed |
|---|---|---|
| Data loss: server (silently dropped fields, re-seeds on restart, swallowed errors, races, no storage) | 17 | 17 |
| Data loss: web (failed saves thrown away, text cut, user data only in one browser, long text with no draft) | 7 + 8 + 19 forms | all listed below |
| Context not remembered (URL params ignored, stale or never written; filters, views and pickers lost) | 37 | 37 (2 left by design) |

## 1. Data loss: server

| Section | What was lost | Cause | Fix | Verified |
|---|---|---|---|---|
| Trade ideas | Every edit a trader made to their own idea (403 `STAFF_ONLY`) | The edit form always sends `trader` (the author); the API treated any `trader` field as a change of author | Only a real change of author is staff-only (`routes/tradeideas.ts`) | R, S |
| Trade ideas | Horizon / valid-until on create, trade-link source: a DB error still answered 201/200 | `.catch(() => undefined)` | Errors propagate | C |
| Watchlist | Screenshot links on create and edit, with 200 returned | `screenshotUrl` was missing from the writable columns (`lib/watchlist/store.ts` `CONTENT_COLUMNS`) | Column added, cleaned like ideas/events (`sanitizeMultiLineUrls`) | R, S |
| Scaling | A rule list saved empty came back as the defaults after a restart | The seed ran on every empty table | One-time seeds: migration 0274 `seed_markers` + `lib/seedMarkers.ts` | S |
| Scaling | A discipline threshold typed as 8 read back as 80 | Read-time ×10 "legacy" normalisation on every load | 0274 converts the old 1–10 rows once; reads return what was saved (`routes/scaling.ts`, `lib/scalingEngine.ts`) | R, S, T |
| Playbook (seed) | A renamed seeded setup came back under its old name after a restart; cleared tags were re-filled | The boot seed inserted by name on every boot and re-filled empty tags | The seed runs once per database (`lib/migrate.ts` + `seed_markers`) | S |
| Game plan (templates) | Quick focus rules / rule of the day of a saved template | `TemplateBody.doc` (strict `PlanBody`) stripped them | `doc` accepts `focusRules` and `ownRule` (`lib/gamePlan.ts`) | R, S |
| Morning check-in / coach | The morning plan text was wiped by a flags-only save. Two quick saves created duplicate rows, and reads picked either one | The POST always wrote `free_text` (null when absent); check-then-insert with no unique key | One row per person and day (0274 dedupes and adds a unique index); upsert; an absent `freeText` keeps the text (`routes/emotionalstate.ts`) | R, S |
| Themes | One view change undid another (columns, then sort or tab) | Read → merge → write of the whole view | Per-field merge in one SQL statement (`mergeView`) | R, S, T |
| Voice notes | Every save failed with 500 `STORAGE_FAILED` without the Replit object storage (local runs, any host without a bucket) | Audio went only to the Replit sidecar at 127.0.0.1:1106 | Without a bucket, audio is stored in Postgres (0274 `voice_note_audio`) and served by `/voice-notes/:id/audio` | R, S |
| Permissions | A save made while the DB read had failed wiped every custom permission | The PUT started from the 15 s cache, which turns a failed read into "no overrides" | The PUT reads fresh and strict (`loadOverrides(true)`) | C |
| Academy path | An approval whose stage change failed stayed "approved", and a retry was refused | Request marked approved before `setStage` | Reverted to pending when `setStage` throws | C |
| Academy cohorts | An end date before the start date was stored while the answer was 400 | The check ran after the UPDATE | One transaction, rolled back on an invalid range | C |
| Playbook ↔ trades | Linking or unlinking a trade from the playbook left the old setup name in the trades list | Only `playbook_id` was written, but the setup tag is `playbook_id` plus the name | The name is written or cleared with the link (`routes/playbook.ts`, `routes/playbook-spaces.ts`) | C |
| Playbook ↔ trades | A trade tagged with a setup created less than a minute ago kept the name without the link | 60 s office-setups memo never cleared | Any successful `/playbook` write clears it (`routes/index.ts`) | C |
| Playbook | Setup score on a trade, or a revision snapshot: failures were silent | `.catch(() => {})` | The score write throws; the snapshot failure is logged | C |
| Personal settings | A personal key a screen sent was silently dropped with 200 | `SettingsPatch` is a whitelist; there was no generic per-person store | `prefs` block, merged per key, `null` removes a key, size-bounded (`lib/people/uiPrefs.ts`, `routes/users.ts`) | R, S |

## 2. Data loss: web

| Section | What was lost | Cause | Fix | Verified |
|---|---|---|---|---|
| Coach (mentor check-in) | The full morning plan (≤ 2000) shrank to the coach's 300-character display copy | The coach re-posted its shortened note | An untouched note is not sent, and the API keeps the text (`components/mentor/api.ts`, `checkin.tsx`, input up to 2000) | R, S (API side) |
| Journal | Text typed during a 5xx or network failure; your own text on a 409 conflict | The local fallback ran only on 404; a conflict replaced the text with the server copy | 0/5xx keep a local copy marked for sync; the conflict toast offers "Restore my text" | T |
| Junior notes | Text after a failed autosave or a reload; text over 6000 characters cut silently | Swallowed error, no retry, no local copy; server `slice` | Toast, retry, keepalive, local copy until saved; the API answers 400 `TEXT_TOO_LONG` (note: writes there are retired with 410 since wave 1) | T |
| Indicators | A note or favourite whose save failed, overwritten on the next sync | Sync replaced the local copy | Pending keys are pushed first (`components/indicators/storage.ts`) | T |
| Playbook card | Typed text after a failed autosave | Pending edits were cleared, then a refetch reset the field | On 0/5xx the patch goes back to pending and is retried; no reset | C |
| Chart drawings | Drawings whose save failed; the last change before a reload | An older server set won on load; no flush on hide | A pending local copy wins and is pushed; flush on hide/close | T |
| Add to playbook | First example from the trade silently missing | `.catch(() => null)` | Toast | C |
| Author notes | Text after a failed save | No keepalive, no local copy | Keepalive and a local copy that is re-saved on load | C |

**User data that lived only in one browser → moved to the account** (`useServerPref`, `users.settings.prefs[key]`;
the old localStorage key is read once and written up, so nothing is lost):

| Key | What | Verified |
|---|---|---|
| `feed.bookmarks` | daily feed bookmarks | R, S (prefs round-trip) + C |
| `notes.authorTemplates` | author-note templates | C |
| `junior.template`, `junior.snippets` | the junior's own template; the curator's quick replies | C |
| `trades.views` | saved trade views (the old key was not even per person) | C |
| `analyst.views` | saved analyst views | C |
| `ask.pinned` | pinned "Ask the journal" questions | C |
| `big7.hot` | the day's Big 7 hot list | C |

**Long text with no draft → a local draft per account and item until saved** (`hooks/use-text-draft.ts`):

- trade sheet notes and review
- feed editor
- weekly review: self-review, curator comment + score + goals, **goal for next week**, **regime reflection**
- curator notes
- EOD review comment
- breach review
- ask-curator
- academy answer and grading comment
- **academy lesson editor**
- new or edited discussion thread
- trade idea thesis and comments
- mistake dialog
- event form
- **morning check-in**

Verified: UI (the weekly-review goal draft survives a reload in Chrome) for the hook; C for the other forms.

## 3. Context not remembered

Mechanisms: URL params through `hooks/use-search-param.ts` (`useSearchParam` / `useSearchParamId` /
`replaceSearchParams`, history replace, other params kept) for shareable context; `usePersistentState` (localStorage)
for view conveniences; `usePeriodParam` for periods.

| Route | Was lost / broken | Fix | Verified |
|---|---|---|---|
| /rules, /error-tracker | `?trader`, `?tab` read but never written: a reload jumped back to the link's values (staff picker) | Written on change | UI (tabs, segmented) |
| /ratings | Stale `?tab=quests` beat the user's tab | `?tab` written | UI |
| /stats | Stale `?horizon`; opened calendar day; equity view; breakdown sort | `?horizon`, `?day`; the others in localStorage | UI (param) |
| /risk | Open trader card, card tab, view | `?trader`, `?tab=limits` (cleared on close), `?view` | UI |
| /scaling | Open trader card; desk filter | `?trader` (cleared on close); filter in localStorage | UI (segmented) |
| /events | In-app links ignored; sheets reopened on every reload; staff picker lost | Reactive URL; `?date`, `?view`, `?ticker`, `?id`, `?trader`; `?new` dropped on close | UI |
| /dailyfeed | `?highlight` never removed, and it reset the remembered category on each reload | Removed once handled | UI (segmented) |
| /trade-ideas | Ticker filter dropped from the URL; stage and horizon not kept | `?ticker`, `?stage`, `?hz` | UI |
| /discussions | `?q` never written; type filter | `?q` (debounced), `?kind` | UI |
| /notifications | The URL writer dropped other params; group filter | Other params kept; `?group` | UI |
| /academy/challenges, /cohorts, /mentor, /path, /learn, /content-admin | Open item, person, tab, week, filters only read or never kept | `?id`, `?user`, `?filter`, `?tab`, `?week`, `?student`, `?view`, `?cohort`, `?pprogram`, `?status`, `?node`; toggles in localStorage | UI (tabs / segmented / param) |
| /trades | Open trade sheet | `?trade` | C |
| /journal (queue) | Queue tab, trader, overdue toggle, sort | `?qtab`, `?qtrader`; the rest in localStorage | UI (segmented) |
| /game-plan | Horizon filter; trader in the "traders" view | `?hz`, `?trader` | UI (tabs) |
| /analytics, /behavior, /benchmark | Breakdown dimension, sorts, metrics, chart modes | localStorage | UI (tabs) |
| /chart-lab | Staff person picker; overlay unit | `?trader`; localStorage | UI (segmented) |
| /watchlist | Open card; filters | `?ticker`; localStorage | UI |
| /big7, /indicators, /themes | Open sheet; catalyst week and scope | `?sym`, `?id`, `?theme`; localStorage | UI (/indicators) + C |
| /offerings | Day scope; open sheet. Also `?when=` from a link was overwritten by the auto-switch on mount | `?when`, `?ticker`; the auto-switch re-arms only on a new day | UI (param, after the fix) |
| /office | Drilled-in day | `?day` | C |
| /desk-day | Chart timeframe | localStorage | C |
| /analyst-actions | Firm filter, ticker filter, open sheet | `?firm`, `?ticker`, `?sheet` | UI (segmented) |
| /trade-idea-stats | Author (a person); best/worst toggle | `?author`; localStorage | UI (segmented) |
| /playbook (Today) | Setup tab; inbox window | `?stab`; localStorage | UI (segmented) |
| /admin | Audit log who / what / object; people filter; open person card | `?who`, `?what`, `?obj`, `?person`; localStorage | UI |
| /curator, /integrations | Notes filter; report mode, trader filter, reconcile view | localStorage | UI (tabs) |

## Not fixed (and why)

- **Left by design or as owner decisions:**
  - `/coach`: the mentor's rhythm tab opens on the part of the day (brief before the session, debrief after).
    Remembering a pick would override that.
  - `/stats`: "only my trades" is per visit, an existing owner decision.
- **Academy:** a cohort's enrolment stage is not the trader's stage. An approved transfer
  (`academy_trader_stage`) wins by design (`lib/people/stage.ts`). Saving through the cohort changes only the cohort
  row. This is a product decision, not lost data.
- **Low-risk races, not fixed:**
  - The personal game-plan autosave can finish an older request after a newer one. The client aborts old requests,
    and the window is tiny. A stale-write guard (`updatedAt` → 409, as the journal has) is the next step.
  - Theme boards' PATCH reads then writes the whole row.
- **In memory:** a news-channel post retry (`lib/newsChannel/schedule.ts` `pendingRetry`) is lost on a restart during
  its retry window. It is the desk's channel, not user data.
- **Smaller forms still without a draft:**
  - watchlist form
  - rule dialog
  - violation explanation
  - idea review actions
  - trade comments
  - rating comment
  - mentor and assistant chat composers
  - scaling and risk comments
  - cohort dialogs
  - theme dialogs
- **Idea and event drafts** are dropped if the person closes the dialog after a failed save.
- **Junior notes:** writes are retired (410) since wave 1. The client fixes only matter if the section is revived.

## Files in other agents' areas

- `components/mentor/api.ts`, `components/mentor/checkin.tsx` (web side of the AI mentor): an untouched note is not
  re-sent; input length. `lib/mentor/*` was not touched.
- `routes/emotionalstate.ts`: the check-in the mentor reads. Upsert, and an absent `freeText` is kept.
- `components/morning-checkin.tsx` (a dashboard widget): a local draft only, no layout change.
- `lib/scalingEngine.ts`, `lib/disciplineIndex.ts`: removed the read-time ×10 of discipline thresholds (data converted
  once in 0274). Discipline is not one of the one-truth metrics, but it sits next to them.
