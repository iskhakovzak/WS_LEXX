# WS_LEXX — Prop Trading Desk

WS_LEXX is a pnpm monorepo for a prop trading desk, featuring a React/Vite frontend and an Express 5 API.

## Run & Operate

- `pnpm install` — Install dependencies
- `pnpm --filter @workspace/api-server run dev` — Start API (development)
- `pnpm --filter @workspace/edge-tracker run dev` — Start frontend (development)
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API hooks from OpenAPI spec
- `bash scripts/build-prod.sh` — Production build (frontend + API)

**Required Environment Variables**:
- `PORT` (frontend)
- `JWT_SECRET` (API, stored in Replit Secrets)
- `DATABASE_URL` (API, automatically set by Replit)
- `ADMIN_PASSWORD`
- `PLAYBOOK_PASSWORD`

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **Package Manager**: pnpm
- **TypeScript**: 5.9
- **Frontend**: React 18, Vite, TailwindCSS, Wouter
- **API**: Express 5
- **Database**: PostgreSQL (Replit built-in)
- **ORM**: Drizzle ORM
- **Validation**: Zod (v4), `drizzle-zod`
- **API Codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)

## Where things live

- `/artifacts/edge-tracker`: React/Vite frontend.
- `/artifacts/api-server`: Express 5 API server.
- `/lib/db`: Drizzle ORM schemas and database connection.
- `/lib/api-zod`: Zod schemas for API.
- `/lib/api-spec`: OpenAPI specification (source-of-truth for API contracts).
- `/scripts/build-prod.sh`: Production build script.
- `/scripts/backups`: Local backups (not committed).
- `artifacts/api-server/src/lib/migrate.ts`: DB migrations (source-of-truth for DB schema).

## Architecture decisions

- **Database Management**: Exclusively uses Replit's built-in PostgreSQL. All schema changes are handled via raw SQL scripts in `migrate.ts` with `IF NOT EXISTS` clauses, avoiding `drizzle-kit` or `db:push`.
- **Authentication**: JWT (HS256, 30 days validity) with a `tv` (token version) claim for immediate token revocation via `users.token_version` on logout. `bcrypt` for password hashing with auto-rehash on first login with old plaintext.
- **Security**: Comprehensive hardening including `helmet`, rate limiting on login, input validation, output escaping, MIME-type whitelisting for uploads, and removal of sensitive data from API responses.
- **API Access Control**: All mutations (POST/PATCH/PUT/DELETE) on `/api/*` require authentication via `requireAuthOnMutation` middleware; GET requests are open. Actor identification is strictly from JWT.
- **Data Persistence**: No auto-seeding or `seed/reset` on startup; data persists across restarts and deployments. Dev and production environments use separate databases managed by Replit.

## Product

- **Trading Desk Features**: Comprehensive trading tools including a multi-tab calculator (Position, P&L/R, Options, Commissions, Currency), supporting Black-Scholes options pricing and real-time FX rates.
- **Execution Discipline Layer**: Pre-trade checklists, trade idea management (CRUD, publish, convert, reactions), and watchlist scoring.
- **Closed-Loop Reporting**: Provides per-trader statistics on trade ideas (published, converted, win rate, avg R) and includes linked trade outcomes for converted ideas.
- **Intraday Charting**: Displays intraday charts with multi-fill execution markers (entry, add, trim, exit, stop) and auto-calculated weighted average PnL.
- **AI Trade Review**: Integrates Anthropic Claude for AI-powered trade analysis, utilizing market context snapshots for deeper insights.
- **PropReports Integration**: Supports importing trade data from binary XLS exports of PropReports, with deduping logic and audit logging.
- **Market Monitoring**: Features "Big 7" (core) and "Hot Stocks" lists, with daily resets for hot stocks, and storage for daily bias, notes, and levels.
- **Daily Feed (AI)**: Auto-generated each morning via `generateAutoFeed()` (Claude). Visible on `/dailyfeed` page with "Сегодня" banner, inline AI content display, and manual re-generation button.
- **Earnings Watch**: `/api/earnings/watch` — fetches BMO (today, before open) and AMC (most recent day) earnings from NASDAQ public API. For each ticker, fetches Yahoo Finance price reaction, relative volume, EPS beat/miss. Displayed on `/research` page as a collapsible `EarningsWatch` panel with BMO/AMC tabs.
- **Авторская сводка**: `/author-notes` — end-of-day trader journal with voice recording (Web Speech API, Chrome/Edge), text editor, mood selector, AI text improvement (Claude), history view, and weekly AI analysis with "Цитата недели". Stored in `author_notes` and `author_weekly_summaries` tables. API: `GET/PUT /api/author-notes`, `POST /api/author-notes/improve`, `GET/POST /api/author-notes/weekly-summary`.

## User preferences

- _Populate as you build_

## Gotchas

- **PropReports Parser Duplication**: The PropReports parser logic is duplicated in `scripts/src/lib/parse-propreports.ts` and `artifacts/api-server/src/routes/admin.ts`. Any changes to parsing logic must be synced between both files.
- **Database Migrations**: Only use `migrate.ts` for database schema changes; do not use `drizzle-kit` or `db:push`.
- **Production Backup**: Database backups must always be performed via the production URL, not development or preview environments.
- **JWT Secret**: The `JWT_SECRET` is crucial for server startup and must be stored in Replit Secrets, not in `.replit`.

## Pointers

- **Replit Documentation**: [https://docs.replit.com/](https://docs.replit.com/)
- **Drizzle ORM Docs**: [https://orm.drizzle.team/docs/](https://orm.drizzle.team/docs/)
- **Express 5 Docs**: [https://expressjs.com/](https://expressjs.com/)
- **React Docs**: [https://react.dev/](https://react.dev/)
- **Vite Docs**: [https://vitejs.dev/](https://vitejs.dev/)
- **Orval Docs**: [https://orval.dev/](https://orval.dev/)
- **Zod Docs**: [https://zod.dev/](https://zod.dev/)