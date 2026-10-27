# Product

<!-- impeccable:product-schema 1 -->

WS_Desk (repository and internal name WS_LEXX / WS_DeskOS): the internal site of a proprietary trading desk.

## Platform

web (desktop first for the working day; every screen also works on a phone, 390 px)

## Users

- **Traders** of the desk, on the ladder of the in-house Academy: Джун → Трейдер → Сеньор. They open the site every
  trading day: before the open (plan, playbook), during the session (risk, catalysts), after the close (day review).
  New traders are the people the product most needs to keep.
- **Curators** — senior people who lead a group of traders: the review queue, risk, 1:1s, notes, scaling decisions.
- **Admin / owner** — desk settings, people and permissions, integrations, usage, the office report.
- Staff are traders too: admin and curators get every trader feature on their own book, plus a picker to look at any
  trader. What a section shows can be narrowed per Academy stage; by default everything is open.

## Product Purpose

Make the daily loop of a desk trader stick — morning plan → trading → evening review — and give the curator one place
to see who needs what today. Success is measured on real usage (the pilot funnel in «Админка → Использование»), not on
demo data: traders who plan, trade within limits, review their day, and climb the ladder.

## Positioning

A desk's own operating system rather than a generic trading journal: trades arrive from the desk's broker reports
(PropReports) without manual entry; the curator, the Academy ladder, the desk's rules, limits and playbook live next to
the trader's numbers; the desk's language (R, setups, стоп, IMX, PropReports, ступени, 1:1) is the product's language.

## Operating Context

- US equities, New York session: every «today», day switch and date parameter is the NY trading date; weekends and
  NYSE holidays are not trading days.
- The trading day: premarket plan and «В игре» tickers, the screener and catalysts (earnings, offerings, analyst
  actions, macro), live risk and the daily loss limit, then the day report, the journal and the curator's review.
- Desktop during the session (a second monitor next to the trading platform), phone for a quick look.
- Interface in Russian (primary), English and Uzbek; tickers, metrics and the user's own notes are not translated.

## Capabilities and Constraints

- **Data entry:** trades come only from PropReports (sync and import). Manual input lives only in the playbook and the
  plans. Screens never offer «import» or «manual» labels for trades.
- **Analytics:** period reports (/stats), «где мой edge» (/analytics), behaviour, what-if, benchmark, the office report;
  the same trade «Разрезы» (facets) and the «Исключить IMX» switch everywhere.
- **Desk work:** curator cabinet, risk desk, scaling, rules and violations, discussions, feed, ideas, notifications.
- **Academy:** path and stages, courses, exams, cohorts, mentor; an AI mentor and one AI entry per screen (the page's
  question in the header + Ctrl+J).
- **Market:** game plan, catalysts, analyst actions, offerings, themes, watchlist, Big 7, indicators, calculator, trainer.
- Stack constraints that shape UI work: React 18 + Vite + Tailwind 4; all copy through i18n dictionaries (no Cyrillic
  literals in code); size ratchets (file ≤ 600 lines, function ≤ 300); layered imports; z-index only from tokens.

## Brand Commitments

- Name and mark: **WS_Desk** wordmark and the WS mark (components/ds/brand.tsx); never reworked casually.
- The owner's photo backgrounds (e.g. «Пантеон») are part of the brand: full photo on the dashboard, sign-in and lock
  screen; work screens dim it under the content column by default.
- Motion stays on by default (the owner's choice); people can switch it off in «Вид».
- The owner's saved appearance preferences are never reset by a release.
- Voice: plain, short Russian of the desk; numbers with signs and units; the honest «—» for no data.

## Evidence on Hand

- Real desk data in the local database (trades from PropReports, plans, playbook) — used for every screen check.
- Design audit of all screens with scores and per-area reports: `docs/design-audit/` (SUMMARY.md + day, analytics,
  knowledge, manage); waves 1, 2A, 2B and 3 implement it.
- Pilot plan and success metrics: `docs/PILOT.md`.
- Absent and not to be invented: customer testimonials, external benchmarks, pricing.

## Product Principles

1. **Answer first.** Every screen answers its one question on the first screen — the number, the list, the next step —
   before filters and explanations.
2. **The owner's six UX laws on every screen:** closure (finish what a screen starts), figure–ground (text never sits on
   the photo), banner blindness (one alarm in one place), prefill (open on the useful default, never an empty form),
   connectedness (one fact = one value everywhere, links between related screens), fewer choices.
3. **Honest data.** No data is «—», a real zero is «$0»; a stale source says «устарело»; a count follows the view.
4. **One pattern per job.** One filter toolbar, one period vocabulary, one day switcher, one AI entry — learned once,
   used on every screen.
5. **Retain the new trader.** The daily loop must be quick enough to do every day.

## Accessibility & Inclusion

- WCAG AA contrast on work screens, also over photo backgrounds (the content scrim and near-opaque panels exist for it).
- Smallest text 12 px; 44 px touch targets on phones; every icon button has an accessible name; keyboard shortcuts
  never fire while typing.
- Three interface languages; layouts must survive the longest of them.
