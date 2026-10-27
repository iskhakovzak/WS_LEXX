---
name: WS_Desk
description: The working surface of a prop trading desk — dark, quiet, numeric, the photo kept at the edges.
colors:
  canvas: "hsl(0 0% 4%)"
  surface: "hsl(0 0% 8%)"
  surface-popover: "hsl(0 0% 9%)"
  ink: "hsl(0 0% 94%)"
  ink-muted: "hsl(0 0% 63%)"
  hairline: "hsl(0 0% 15%)"
  field-border: "rgb(255 255 255 / .12)"
  glass-bg: "rgb(255 255 255 / .045)"
  glass-border: "rgb(255 255 255 / .09)"
  selected: "hsl(0 0% 94%)"
  selected-ink: "hsl(0 0% 4%)"
  up: "hsl(151 50% 55%)"
  down: "hsl(0 85% 71%)"
  warn: "hsl(38 92% 62%)"
  chart-neutral: "hsl(214 32% 70%)"
  chart-gold: "hsl(46 74% 59%)"
  chart-violet: "hsl(263 47% 70%)"
typography:
  display:
    fontFamily: "Inter, -apple-system, 'Segoe UI', system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.25rem + 0.5vw, 1.75rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.028em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "'tnum'"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.35
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
  code:
    fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
rounded:
  sm: "6px"
  md: "10px"
  item: "12px"
  lg: "14px"
  xl: "16px"
  2xl: "20px"
  full: "999px"
spacing:
  inline: "8px"
  tile: "12px"
  stack: "12px"
  head: "12px"
  grid: "12px"
  section: "16px"
  panel: "16px"
  field: "16px"
components:
  button-primary:
    backgroundColor: "{colors.glass-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: "36px"
    padding: "0 16px"
  segmented-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.selected-ink}"
    rounded: "{rounded.full}"
    height: "28px"
  control:
    backgroundColor: "{colors.glass-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: "36px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  toolbar:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.2xl}"
    padding: "8px"
  chip-active-filter:
    backgroundColor: "{colors.glass-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: "28px"
  pill:
    rounded: "{rounded.full}"
    height: "22px"
---

# Design System: WS_Desk

This file describes the system as built (index.css, components/ds*, components/shared, lib/appearance). Values in the
frontmatter are the default theme «Полночь» (dark); «Оникс», «Платина» and «Светлая» redefine the same tokens in
`index.css`, and «Вид» (lib/appearance) can change the accent, font, density and background per person. Read
`PRODUCT.md` first. Code is the source of truth; when this file and the code disagree, fix one of them in the same change.

## Overview

**Creative North Star: "The desk at night"**

A trading desk after hours: a dark room, one photograph on the wall, and on the desk only the numbers that matter today.
The interface is a working surface (Operate mode) — dense, calm and consistent screen to screen, so a trader learns a
pattern once and uses it on fifty screens. Colour is spent on meaning (profit, loss, warning), not on chrome. The brand
lives in the WS mark, the owner's photographs and the desk's own language, not in decoration.

The photo is part of the brand, but text never sits on it: the dashboard («лицо») shows it in full; every other screen
is a work screen where a content scrim dims the photo under the content column and panels go near-opaque.

**Key characteristics:**
- Dark neutral canvas, near-opaque panels, 1 px hairlines, almost no shadow at rest.
- One sans (Inter by default) with tabular figures; a code face only for code and IDs.
- Green / red / amber only for good / bad / needs-attention; everything else is ink and grey.
- Pill-shaped controls (999 px), 20 px page surfaces, 36 px default control height.
- One pattern per job: one filter toolbar, one period vocabulary, one day switcher, one AI entry.
- Motion on by default, short (120–320 ms) and about state.

## Colors

The palette is neutral; the accent is «ink» by default (people may pick an accent colour in «Вид»; the primary button
then takes it). All tokens are HSL triplets or rgba in `index.css` (`:root`, `.dark`, light themes).

### Neutral
- **Night canvas** (`--background`, hsl(0 0% 4%)): the app ground behind the photo / scrim.
- **Panel** (`--card`, hsl(0 0% 8%); on work screens `--glass-work-bg` ≥ 90 % of it over a photo): Panel, Toolbar,
  StatGrid strip, tables.
- **Popover** (`--popover`, hsl(0 0% 9%)): menus, popovers, sheets, dialogs (`glass-thick`).
- **Ink** (`--foreground`, hsl(0 0% 94%)): text and numbers. **Muted ink** (`--muted-foreground`, hsl(0 0% 63%)):
  descriptions, captions, «—», zero values.
- **Hairline** (`--border` / `--glass-border` / `--field-border`): 1 px separators, control outlines.
- **Selected** (`--selected` = ink, `--selected-foreground` = canvas): the active segment of a Segmented — a neutral
  fill, never the accent.

### Semantic
- **Up** (`--up`, hsl(151 50% 55%)): profit, good, done. **Down** (`--down`, hsl(0 85% 71%)): loss, bad, a breach.
  Light themes deepen both for 4.5:1.
- **Warn** (`--warn`, hsl(38 92% 62%)): needs attention — «устарело», near a limit, «без разбора».
- **Chart** (`--chart-1…5`): series in charts only; one hue per chart, neutrals for the rest.

### Named Rules
- **The Meaning Rule:** green and red say good / bad (or win / loss), never direction or metric type. A win rate near
  50 % and a trade count are ink. Fees are not amber. A sparkline takes the tone of its total, not of its last move.
- **The Photo Rule:** text never sits directly on the photograph. Work screens get the content scrim
  (`--content-scrim` .8 dark / .76 light) and near-opaque panels; «Вид» → Фон → «Рабочие экраны: фото / затемнённое /
  ровный» (default: затемнённое).
- **One accent use:** the accent (or ink ring) marks the primary action and focus; selection uses the neutral fill.

## Typography

**Font:** Inter by default (`--app-font-sans`); «Вид» offers Geist, Source Serif 4 and a mono stack per person
(self-hosted, OFL). `font-mono` maps to the sans for figures; real code / IDs use IBM Plex Mono (`--app-font-code`).
Numbers always use tabular figures.

### Hierarchy
- **Display** (600, clamp 24–28 px, 1.15, −0.028em; `type-display`): the page title (PageHeader h1) and the dashboard
  greeting. One per screen. Never truncated — it wraps.
- **Headline / KPI** (600, 24 px, 1, tabular): a StatCard value, the one number a block answers.
- **Title** (600, 15 px, 1.2): Panel and section titles (`text-sm font-semibold`).
- **Body** (400, 15 px, 1.5; `text-sm`): descriptions, lists, table cells. Prose capped near 65–75 ch.
- **Label** (500, 13 px, 1.35; `text-xs`): field labels, chips, table headers, meta.
- **Caption** (500–600, 12 px; `text-2xs`, `micro-label`): the smallest text in the app — sidebar group labels, badges.

### Named Rules
- **The 12 px Floor:** nothing below 12 px — in CSS, Tailwind, SVG `fontSize` or canvas fonts (charts use 12).
- **Sentence case everywhere:** no uppercase or letter-spaced labels on work screens (sidebar groups, section labels,
  table headers included). Tracked capitals survive only on the lock screen / its easter eggs as a brand moment.
- **Two families on work screens:** the sans and the code face. The italic serif is for the lock screen, sign-in clock
  and opening intro only.
- **One language per screen:** KPI labels in the UI language («Винрейт», «Профит-фактор», «Брутто / Нетто»).

## Layout

- **Page** (`Page`): centred, max 1600 px (`--page-max`), side gutter 16 → 24 px, `gap-section` 16 → 20 px between
  sections; `width="narrow"` 960 px only for reading / settings pages.
- **Order of a screen:** PageHeader → Toolbar (scope + filters) → active filter chips → the answer (the number, the
  curve, the list) → details. The first number of a screen is on the first screen, also at 390 px.
- **Grids:** `BentoGrid` (1 col, 12 from lg); a panel keeps its content height (no stretched empty glass).
- **Spacing names:** `gap-inline` 8 (controls in a row), `p-tile` 12, `gap-stack` 12 (blocks in a panel), `gap-head` 12
  (panel header → body), `gap-grid` 12 → 16, `p-panel` 16 → 20, `space-y-field` 16.
- **Control heights line up:** sm 32 / md 36 (default) / lg 40; touch screens grow targets to 44.
- **Phones (< 768 px):** header description is one line + «ещё»; the toolbar keeps one row where possible (search +
  «Фильтры (n)»); filters open as a bottom sheet; the period is a native select; a Segmented scrolls sideways with an
  edge fade; KPIs go 2 × 2 or a divided list.
- **Z-index** only from tokens (`z-raised` … `z-sheet` 50, `z-modal` 60, `z-popover` 70, `z-toast` 80, `z-tooltip` 90).

## Elevation & Depth

Flat at rest, lifted only when floating. `canvas < glass-panel (shadow-sm) < overlay (glass-thick + --glass-shadow)`;
tiles inside a panel carry no shadow. A border or a shadow, never both, on a resting surface. Backdrop blur is 10–12 px
(it sits over a photo, kept low for the GPU); on work screens panels are near-opaque, so blur is not doing the work.

### Shadow Vocabulary
- **Panel** (`--shadow-sm`: `0 1px 2px -1px rgb(0 0 0 / .06), 0 1px 3px 0 rgb(0 0 0 / .06)` light; heavier in dark):
  resting glass panels.
- **Overlay** (`--glass-shadow`: `0 8px 32px rgb(0 0 0 / .5)` dark): popovers, menus, sheets, dialogs.

## Shapes

- **999 px** — every control: Button, Input, Select trigger, Segmented (track and segment), FilterChip, Pill, Kbd,
  sidebar items, active-filter chips.
- **20 px** — page surfaces: Panel, Toolbar, StatGrid strip, Dialog, header, toasts.
- **16 px** — second level: popover / menu / select surfaces, tiles, DataTable box. **12 px** — rows inside a 16 px
  surface with a 4 px inset (concentric). **14 px** tooltips; 10 / 6 px micro.

## Components

Primitives: `components/ui/*` (shadcn on Radix). Design system: `components/ds.tsx` + `components/ds/*`. Cross-feature
patterns: `components/shared/*`. Use them; never fork a local copy.

### Page frame
- **PageHeader** — title (display), one-line description (+ «ещё» on phones), optional `meta`, `actions` (real
  actions only: CSV, print, a create button), and the screen's AI question at the end (registered via the page-ask
  slot; Ctrl+J). No icon tile (the `icon` prop names the nav icon and is not drawn). Never put filters in `actions`.
- **SectionTabs** — the views of a page (underlined tabs, «Ещё ▾» for overflow). **Segmented** is for a filter or a
  mode, never for page views.

### The filter pattern (components/shared/filters/filter-toolbar)
```
PageHeader
Toolbar   [ ToolbarSearch ] [ Segmented: main mode ] [ PeriodPicker · person · unit ] [ Фильтры (n) ] …end
chips     Лонг ×  NVDA ×  Без IMX ×  Месяцы: скрыто 3 ×   Сбросить
```
- **Toolbar** sits directly under the PageHeader, one glass row (8 px padding), wrapping only when it must.
- **ToolbarSearch** — the screen's only search box; «/» focuses it, Esc clears then blurs. Never two searches.
- **One Segmented** — the main mode (e.g. /trades: По дням · Все сделки · Разобрать N · Худшие · …). Counts only where
  they are a to-do.
- **FiltersButton** «Фильтры (n)» — everything else (selects, chips, toggles, sort, saved views, the trade «Разрезы»
  grid with «Исключить IMX»). Popover under the button on desktop (`md` 380 / `lg` 560 / `xl` 860 px), bottom sheet with
  «Сбросить фильтры» and «Показать: N» on phones. The badge counts active filters inside.
- **ActiveFilters** — every active non-default filter as a removable chip (excluded facet values struck through,
  more than two in one column folded into «Месяцы: скрыто N»), then «Сбросить». A filtered list never looks unfiltered.
- **Trade «Разрезы»** (components/shared/trade-facets): `FacetFilterSections` / `RangeFacetSections` inside the button,
  `facetChips` / `rangeFacetChips` in the chip row; the IMX line («Итог $X · из них IMX $Y») sits with the numbers.

### Period (components/shared/period/PeriodPicker + lib/period-range)
- **Vocabulary:** Сегодня · Неделя · Месяц · Квартал · Год · Всё · Период… (`today|week|month|quarter|year|all|custom`).
  Presets are windows ending today: 7 / 30 / 90 / 365 days; «к прошлому периоду» compares with the equally long window
  before. A screen may show a subset (the analytics group omits «Сегодня» — a single day is /day-report); a
  calendar-anchored report (/office: year, Q1–Q4, month) passes its own options with the same words and says so.
- **Forms:** a Segmented row on desktop, `compact` («Месяц ▾» menu) inside a busy toolbar, a native select on phones.
- **URL:** `?period=` (+ `&from=&to=` for «Период…»), legacy values (`7d`, `30d`, `ytd`, `"90"`) read via
  `normalizePeriod`; `hooks/use-period-param` for one screen, `hooks/use-analytics-scope` for the analytics group
  (/stats, /analytics, /behavior, /what-if, /benchmark share period · person · unit through the URL and
  `ws.analyticsScope.v1`, so the scope follows the person between those screens). The scope row is always the first
  thing under the header, in the same order.
- Chart zoom presets (equity curve) use the same words and windows.

### Day (components/shared/day-stepper `DayStepper`)
- `‹ [📅 пн, 27 окт.] ›  [Сегодня]` — ‹ › step session days (weekends and NYSE holidays skipped; `step="calendar"` for
  calendar-day screens), the date opens a calendar (days after `max` disabled), the home button («Сегодня», «Последний
  день», «Следующая сессия») shows only away from home. Keys `[` `]` `T` (physical keys, any layout); `arrows` keeps
  ←/→ where a page always had them; `hotkeys={false}` while an editor owns the keyboard.
- The page owns the date and its URL param (`?date=` / `?day=`). Week screens use a WeekStepper with the same look and
  keys.

### Data display
- **StatGrid / StatCard** — one hairline-divided strip by default; no corner icons; zero values muted and folded into
  «Всё чисто: …» (`allClear`); colour by the Meaning Rule. Where a KPI row adds nothing, use one line of text instead
  (/trades: «−$594 нетто · 177 сделок · винрейт 48 % · PF 0.92 · комиссии $820 — 34 % брутто · 12 не разобрано →»).
- **Tables** — sentence-case 12–13 px headers, numbers right-aligned and tabular, no zebra, 1 px row rules;
  `SortableTh`, `TableScroll` on phones or two-line rows below 640 px.
- **Charts** — straight segments (no smoothing, no glow), axis / label text 12 px (`components/shared/charts/theme`),
  one hue per series.
- **Pill** — 22 px, a pale tint with same-hue text, beside a value or in a row; never above a heading.

### Rows and actions
- **RowActions** — a row's one primary action + «…» for the rest, visible on hover / focus (always on touch). Any row
  or card with three or more inline buttons uses it; a state the user must see («в плане ✓», «Принят») stays outside.
- **Buttons** — primary = the accent fill (or the ink ring with the default ink accent); outline / ghost for the rest;
  disabled buttons say why (title). Header buttons are real actions, not navigation duplicates.

### States
- **EmptyState** — one engraved art, one sentence, one action; `compact` inside panels. On an empty screen hide KPIs and
  filters. Full empty states outside a panel get the panel material over a photo.
- **Loading** — skeletons at the final size (`ChartSkeleton`, `ListSkeleton`, `StatGridSkeleton`…), no spinners in
  content. **Errors** — `ErrorState` / `QueryError` with «Повторить».
- **Freshness** — one rule: `syncStale` (lib/trading-date) — stale once the last synced desk day is before the previous
  weekday; stale data is dimmed with an amber «устарело: обновлено …», never a green «успешно».

### Empty values (one rule)
- No data / not applicable → «—» (em dash, muted). A real zero → «$0», «0», «0 %» in the normal style (money: `fmtUsd`
  prints `$0` for zero and for amounts that round to zero; `—` for null / NaN). Never `?? 0` into a display, never «—»
  for a real zero, never «×0.0» for a ratio below display precision (show «—»).

### Navigation
- Sidebar: group labels in sentence case (`micro-label`, 12 px, 600, muted), the active item a neutral pill, one unique
  icon per page (`components/shell/nav.ts`; PageHeader `icon` and in-app links reuse the page's own icon). Phones: a
  bottom bar of five destinations + «Ещё» sheet; the floating AI orb is phones only.

### Motion
- On by default (the owner's choice; «Вид» → «Движение и анимации» switches it off for a person: `html[data-motion="off"]`,
  the `motion-safe` / `motion-reduce` variants). Durations `--dur-1` 120 ms (hover, press) · `--dur-2` 180 ms (popover, page enter) · `--dur-3` 240 ms (panel,
  dialog) · `--dur-4` 320 ms (sheet); ease `cubic-bezier(.2,.8,.2,1)`. Motion conveys state; numbers may count up once.

## Do's and Don'ts

### Do:
- **Do** start a list or analytics screen with PageHeader → Toolbar → ActiveFilters → the answer.
- **Do** use PeriodPicker, DayStepper, FiltersButton, ActiveFilters, RowActions, EmptyState, StatGrid and SectionTabs
  from the shared folders; put the period (and the date) in the URL.
- **Do** keep every text 12 px or larger and in sentence case; give every icon button an aria-label.
- **Do** print «—» for no data and «$0» for zero; mark stale data with `syncStale`.
- **Do** keep text inside panels on work screens (the Photo Rule) and colour only good / bad / attention.
- **Do** write every string in ru / en / uz dictionaries.

### Don't:
- **Don't** put filters in the PageHeader, add a second search box, or stack a second row of type chips under the toolbar.
- **Don't** invent a new period set («7 дн / 30 дней / 180»), a local day switcher, or a local «Фильтры» popover.
- **Don't** add icon tiles to KPIs, sparklines as decoration, gradient text, glows, or a coloured side stripe on rows.
- **Don't** use uppercase / letter-spaced labels, a third typeface, or the italic serif on a work screen.
- **Don't** turn motion off by default, replace the owner's photos, or reset saved appearance preferences.
