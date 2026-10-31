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
| `PUBLIC_SHOW_PLACEHOLDERS=1` | local preview: show unfilled numbers and empty screenshot frames |

## Before launch

Everything the owner fills in lives in **`src/site.config.ts`**. The build prints what is still open.

- `NUMBERS`: `{{SAVED_USD}}`, `{{ALERTS_FIRED}}`, `{{TRADERS_ON_DESK}}`, `{{SESSIONS_TRACKED}}`, `{{NUMBERS_PERIOD}}`.
  Desk-wide aggregates only, formatted as they should read ("$48,200", "since June 2026"). The numbers band stays
  hidden until all four figures are filled. Never put trader names or individual results in the repo.
- `LEGAL`: `{{LEGAL_ENTITY}}`, `{{LEGAL_ADDRESS}}`, `{{JURISDICTION}}`, `{{CONTACT_EMAIL}}`, `{{EFFECTIVE_DATE}}`.
  The legal texts (`src/legal/content.ts`) are SaaS-template drafts; have them reviewed before indexing the site.
- Screenshots (below).

The hero's live risk feed uses clearly labelled sample data (`src/i18n/*.ts`, "Trader 07" etc.), not desk data.

## Screenshots

Four slots, shown only when the file exists in `public/screens/` (WebP, 1600x1000, 16:10):

| File | What to capture |
|---|---|
| `live-risk.webp` | Risk page during a session: live signals feed with stop 70/90 %, loss streak and revenge alerts, and the "desk saved" counter |
| `trader-day.webp` | A trader's day: morning plan, the day's trades and the evening review |
| `academy.webp` | Academy path with the Junior / Trader / Senior ladder and today's daily loop |
| `analytics.webp` | Desk analytics: edge by setup and time of day, the desk report |

Capture them from the **seed-demo desk only**, on your own PC (localhost), never from the live desk:

```bash
pnpm --filter @workspace/scripts run local-db        # local Postgres (keep open)
pnpm --filter @workspace/scripts run seed-demo       # fictional demo desk; remove later with unseed-demo
# start the API and the web app as in the root README (localhost only), sign in as a demo user,
# set the browser window to 1600x1000, dark theme, and capture each screen
```

Check every capture before committing: demo names only, no real trader, account or PropReports data, no browser
chrome or personal bookmarks. Convert to WebP (for example `cwebp -q 82 in.png -o live-risk.webp`).
