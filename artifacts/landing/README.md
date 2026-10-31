# WS_DeskOS landing (`@workspace/landing`)

Static marketing site built with Astro. English at `/`, Spanish at `/es/`, plus Terms, Privacy and Refund (drafts).
Deploy: `docs/DEPLOY.md`, section 15.

```bash
pnpm --filter @workspace/landing run dev        # http://localhost:4321
pnpm --filter @workspace/landing run build      # dist/ + smoke check (scripts/smoke.mjs)
pnpm --filter @workspace/landing run typecheck  # astro check
```

Build-time switches (none are secrets):

| Variable | Effect |
|---|---|
| `LANDING_INDEXABLE=1` | removes `<meta name="robots" content="noindex">` and opens `robots.txt`. Leave unset until the domain is live. |
| `LANDING_SITE_URL` | absolute site URL for canonical and hreflang links |
| `PUBLIC_LEADS_API_BASE` | where the form posts (`<base>/api/leads`); empty = same origin |
| `PUBLIC_UMAMI_URL` + `PUBLIC_UMAMI_ID` | both set = Umami script tag; otherwise no analytics |
| `PUBLIC_SHOW_PLACEHOLDERS=1` | local preview: show unfilled numbers and empty frames for missing screenshots |

## Before launch

Everything the owner fills in lives in **`src/site.config.ts`**. The build prints what is still open.

- `NUMBERS`: `{{SAVED_USD}}`, `{{ALERTS_FIRED}}`, `{{TRADERS_ON_DESK}}`, `{{SESSIONS_TRACKED}}`, `{{NUMBERS_PERIOD}}`.
  Desk-wide aggregates only, formatted as they should read ("$48,200", "since June 2026"). The numbers band stays
  hidden until all four figures are filled. Never put trader names or individual results in the repo.
- `LEGAL`: `{{LEGAL_ENTITY}}`, `{{LEGAL_ADDRESS}}`, `{{JURISDICTION}}`, `{{CONTACT_EMAIL}}`, `{{EFFECTIVE_DATE}}`.
  The legal texts (`src/legal/content.ts`) are SaaS-template drafts; have them reviewed before indexing the site.
- Screenshots (below).

The hero's live risk feed uses clearly labelled sample data (`src/i18n/*.ts`, "Trader 07" etc.), not desk data.

## Look and moving parts

- **Hero background**: a GPU particle cloud shaped like the WS mark, stirred by the cursor through a fluid simulation
  (`src/scripts/hero/`: `shape.ts` SDF of the mark, `cloud.ts` particle sim, `fluid.ts` cursor fluid, `index.ts` lifecycle).
  three.js `0.150.1` is bundled and loaded lazily after first paint, in its own chunk. 262k points on desktop, 16k on
  phones. It pauses when the tab is hidden or the hero is off screen, and dims as the page scrolls. The mark sits in a
  stage box (`--stage-*` in `Home.astro`, measured from `[data-stage]`) kept clear of the card and text columns at every
  width, and its brightness falls with its on-screen size so a small mark never saturates into a solid shape.
- **Fallbacks**: no WebGL2 or no float render targets: three is never downloaded and a static dotted mark stays in
  place (this mark also shows before the cloud starts and when script is off). `prefers-reduced-motion`: the cloud is
  pre-settled and drifts very slowly, with no cursor fluid; illustrations and reveals stop moving.
- **Feature explorer** ("Everything inside", `src/components/Explorer.astro`): copy in `src/content/features.ts` (EN + ES,
  checked against the app's code). Keep every claim true to the product; features that are off by default stay out
  or are marked optional.


## Screenshots

Twelve slots in `public/screens/` (list in `src/site.config.ts` `SCREENS`): `<name>.webp` at 1600x1000 plus
`<name>-800.webp` at 800x500, served as a 1x/2x `srcset`. A slot shows only when its file exists. `hero` slots fill the
hero's card column (below the first screen from 1100 px down), `inside` slots the "Inside WS_DeskOS" section, and every
explorer group points at one slot (`screen` in `src/content/features.ts`), falling back to its CSS illustration when the
file is missing. Each screenshot sits in a window frame with a soft glow (`src/components/Shot.astro`; the hero cards
lean slightly in 3D, straight with reduced motion) and opens enlarged on click (`src/components/Lightbox.astro`; without
script the link opens the file). Alt text and captions: `screens.alt` / `screens.items` in `src/i18n/*.ts`.

| File | Screen (demo user) |
|---|---|
| `live-risk` | Risk desk in the session: alerts, desk saved +$3,111 for the month (admin) |
| `trader-day` | Dashboard ten minutes before the close: +$3,371 day (senior trader) |
| `academy` | Trader path: readiness 13 of 14 (junior trader) |
| `analytics` | Office stats: +48% for the year, target reached (admin) |
| `journal` | Journal after the close: the +$3,371 day, +$8,817 month (senior trader) |
| `plan` | Desk game plan before the open (junior trader) |
| `chart` | Chart lab: a +$2,326 trade with entry and exit (senior trader) |
| `what-if` | What-if on the quarter: +$3,377 better without one ticker (senior trader) |
| `themes` | Market themes (admin) |
| `ideas` | Trade ideas board (admin) |
| `curator` | Curator cabinet (curator) |
| `everywhere` | Three phone screens at 390 px: dashboard, notifications, risk desk |

Capture them from the **synthetic seed-demo desk only**, never from the live desk or the local copy of it
(`edge_tracker`): a scratch database on the local server, migrated by the API on start and filled with
`scripts/src/seed-demo.ts` (`DATABASE_URL` pointing at the scratch DB for that command only), a second API and web dev
server on free ports, sessions minted for demo users (no sign-in), the English UI with the Porsche photo background
(`porsche-gt3rs`), a 1600 px wide viewport at 2x, cropped to the interesting part at 16:10. The seed writes Russian names
and notes; give the demo users Latin names (`pnpm --filter @workspace/api-server run rename-user`) and English text in the
scratch DB before capturing. The featured numbers come from shaping that fictional data (larger sizes for the featured
senior trader, smaller sizes after alerts, a passed exam for the featured junior). Drop the scratch DB afterwards.

Check every capture before committing: demo names only, no real trader, account or PropReports data, no browser
chrome or personal bookmarks.
