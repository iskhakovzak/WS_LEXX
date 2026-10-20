# WS_LEXX full-site audit — brief for every auditor (read fully before touching anything)

Owner (2026-10-20): «пройдись по каждому разделу, по каждой теме, по всему, напиши огромный план оптимизации и
улучшений, проверь каждый функционал». You audit ONE area (your assignment is in the message that launched you).
Your output is a findings file; another step turns all files into the owner's plan. Be concrete, be honest, be
useful to a desk owner who will decide what to build next week — not to a CTO.

## Product in one paragraph
WS_LEXX is a prop-desk trading journal for a US-stocks desk (~50 traders, 6 curators/25 juniors planned). Trades
come automatically from PropReports (files or API); traders plan the day, trade, review the day, follow rules and
risk limits, learn in the Academy, and earn discipline points/quests. Curators review juniors; the owner (admin)
runs the desk. The owner's single goal for this phase: **retain new traders through the daily loop** (plan → trade →
review → curator feedback, every day). Levels: Стажёр → Джун → Трейдер → Сеньор. Three UI languages: RU (primary),
EN, UZ. Phone use is real (juniors on phones).

Owner UX laws (apply as a checklist on every screen): one focal point per screen; figure/ground (the important
thing is visually dominant); no banner blindness (no repeated red/yellow banners on every screen); prefill (never
ask what the system already knows); connectedness (a number means the same thing on every screen and links to its
source); fewer choices (defaults over menus).

## Environment (LOCAL only)
- Site: http://127.0.0.1:24410 (Vite dev, proxies /api → 8090). API: http://localhost:8090. Both are up.
- DB: postgresql://postgres:postgres@localhost:5432/edge_tracker (embedded Postgres). Only 2 real users locally:
  «Закир» (admin, 910 trades, account 31206881) and «chert» (trader, 270 trades). A test «Куратор (аудит)» (curator,
  ward: chert) exists for curator views. The old 30-user dataset lives in schema cleanup_backup_20261019 — don't
  touch it.
- Tokens (Bearer, 30 days): scratchpad/audit/tok_admin.txt, tok_trader.txt, tok_curator.txt (same folder as this
  file). Use `curl -s -H "Authorization: Bearer $(cat tok_X.txt)" http://localhost:8090/api/...`. Add
  `-H "Accept-Language: en"` / `uz` to check translations of API texts. Never call /api/auth/login.
- Code: C:\Users\WS\Desktop\lexx\Project-Deploy — api: artifacts/api-server/src (routes/, lib/, jobs/, db/migrations/),
  web: artifacts/edge-tracker/src (pages/, components/, i18n/locales/{ru,en,uz}/, components/shell/nav.ts).
  docs/PERSONA_REVIEW.md = the previous audit (19 Oct) and its open owner questions — read it; don't re-report what
  it says is fixed unless you verified it is still broken.
- You have NO browser. The browser pane belongs to the lead. Verify behaviour through the API, the code, targeted
  vitest runs (`npx vitest run <path>` inside artifacts/api-server or artifacts/edge-tracker) and `npx tsc --noEmit`.
  For UI claims (layout, phone, focal point) read the page/component code and the i18n files and say «по коду».

## Hard rules
- READ-ONLY audit: no git commands, no edits to repo files, no migrations, no .env edits, no servers started/stopped,
  no row deletes, no password/role/level/limit changes. Harmless user actions are OK (a draft plan, a comment, a
  board) — list every write you made in your report so it can be cleaned up.
- No external hosts except what the API itself calls. Never print token values or secrets.
- Don't fix anything. Don't rewrite anything. Find, verify, describe.

## How to audit a section (do this for EVERY page/route in your area)
1. **Purpose in one line** (who uses it, when in the daily loop). If you can't say it, that's a finding.
2. **Exercise it** as each relevant role (trader / curator / admin): list the API calls the page makes (grep the
   page's hooks/api.ts), call them with each token, check status codes, response times (`curl -w "%{time_total} %{size_download}"`),
   empty states (a user with no data), error states (bad ids, missing params, another user's ids → must be 403/404),
   and the three languages. Try the mutations the page offers (with harmless data) and read back the result.
3. **Check the loop**: does this screen push the trader to the next step of the daily loop, or is it a dead end?
   Does it duplicate a number/feature that lives elsewhere (connectedness)?
4. **Check code smells that bite users**: N+1 queries, no pagination, unbounded responses (> 500 KB), missing
   indexes for the main query, client-side filtering of large lists, stale caches, time-zone bugs (everything is
   New York time), money/percent rounding, Cyrillic literals in code (i18n), missing EN/UZ keys (compare locale
   files), hard-coded names («Закир», «Дмитрий»), dead routes/components (not in nav, not linked), TODO/FIXME.
5. **Phone**: by code — does the page use the responsive patterns (sm:/md: classes, mobile nav), tables with
   horizontal scroll, touch targets ≥ 40 px? Flag pages that are clearly desktop-only.
6. **Security quick pass**: every mutation guarded by auth + the right capability (lib/permissions.ts), owner
   checks on ids, zod on bodies, no raw SQL interpolation, uploads limited, no secrets in responses.

## Output — write `scratchpad/audit/<area>.md` (Russian, owner-readable; code refs in backticks as file:line)
```
# Область: <name>
## Итог (5–8 строк): что в порядке, что болит сильнее всего, 3 вещи, которые я бы сделал первыми
## Разделы
### <Page name> (/route) — назначение
- Проверено: <что и как: вызовы, роли, языки, тесты>
- Работает: <коротко>
- Ошибки: [P0 блокер / P1 серьёзно / P2 мелочь] <что, как воспроизвести, где в коде>
- UX (по законам владельца): <нарушения, конкретно>
- Улучшения: <идея — зачем — усилие S/M/L — эффект на daily loop H/M/L>
- Вопросы владельцу: <если есть>
## Сквозные находки по области (производительность, i18n, телефон, безопасность, мёртвый код)
## Таблица: все проверенные вызовы API (метод, путь, роль, код, время, размер) — компактно
## Что я записал в базу (для уборки)
## Топ-10 улучшений области, отсортировано по эффект/усилие
```
Severity honesty: P0 = data loss, wrong money/risk numbers, security hole, page crash for a role. P1 = a feature
doesn't do what it says / dead end in the loop / phone unusable. P2 = polish. Don't inflate. Don't pad with
generic advice («добавить тесты»). Every improvement must say what changes for the trader/curator/owner.

Budget: be thorough but finish. Report in your final message: the file path, the counts (P0/P1/P2/improvements),
and your top 3 in two lines each.
