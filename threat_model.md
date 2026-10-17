# Threat Model

## Project Overview

WS_LEXX is a prop trading desk application with a React/Vite frontend and an Express 5 API backed by PostgreSQL. It stores trader accounts, trades, playbooks, internal discussions, AI-generated reviews, voice notes, notifications, research data, and operational admin data. Production traffic reaches the Express API in `artifacts/api-server/src`, with shared persistence and schema code in `lib/db/src`.

Production assumptions for this scan:
- `NODE_ENV=production` in deployed environments.
- Replit terminates TLS for deployed traffic.
- Only code reachable through the production frontend, API, background jobs, object storage access paths, or configured third-party integrations is in scope.
- Local scripts, backups, and mockup/sandbox-only flows are out of scope unless a production route invokes them.

## Assets

- **User accounts and bearer tokens** — JWTs, password hashes, token version state, and role assignments. Compromise allows impersonation and privileged access.
- **Trading and journal data** — trades, trade ideas, research, author notes, psychology notes, ratings, watchlists, and voice-note transcripts. This is sensitive business and personal performance data.
- **Private media and object storage references** — uploaded voice recordings and backup artifacts stored in object storage. Unauthorized access exposes sensitive recordings or full database contents.
- **Administrative controls** — user management, moderation, audit logs, database exports, and backup download paths. Abuse can expose or destroy broad application data.
- **Application secrets and third-party credentials** — `JWT_SECRET`, database credentials, Telegram bot token, Anthropic/OpenAI keys, backup signing access, and Resend credentials.
- **Background automation outputs** — daily feed generation, digests, AI reviews, and weekly psychology reports. These can leak sensitive summaries if access control is weak.

## Trust Boundaries

- **Browser to API** — all frontend input is untrusted. The API must authenticate and authorize requests server-side, especially because the client stores and forwards bearer tokens.
- **Public to authenticated boundary** — the app intentionally exposes many GET endpoints, while mutations are gated centrally. This boundary is high risk because read access can still leak sensitive data.
- **Authenticated user to privileged user boundary** — `trader`, `curator`, and `admin` roles have different capabilities. Role enforcement must come only from JWT-backed server checks, never caller-supplied names or request bodies.
- **API to PostgreSQL** — the API has broad database access. Query scoping errors or injection vulnerabilities can expose all trading and user data.
- **API to object storage** — the API writes private media and signs download URLs. Ownership checks must happen before issuing object access.
- **API to third-party services** — the server calls Telegram, Resend, Anthropic/OpenAI, NASDAQ, Yahoo, and other data sources. User-controlled inputs must not let attackers pivot those calls into SSRF, data exfiltration, or cost-amplification attacks.
- **API to host process utilities** — backup code invokes `pg_dump`. Inputs reaching process execution or backup artifact selection must be tightly constrained.

## Scan Anchors

- **Production entry points**: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/index.ts`.
- **Highest-risk code areas**: `src/lib/auth.ts`, `src/routes/auth.ts`, `src/routes/users.ts`, `src/routes/admin.ts`, `src/routes/voicenotes.ts`, `src/routes/telegram.ts`, `src/lib/objectStorage.ts`, AI and digest modules under `src/lib/`.
- **Public vs authenticated vs admin surfaces**: all `/api/*` GET routes are publicly reachable unless a route adds its own check; POST/PATCH/PUT/DELETE are centrally gated by `requireAuthOnMutation` except `/auth/login`, `/auth/init-passwords`, and `/telegram/webhook`.
- **Usually dev-only / lower-priority areas**: `scripts/src/**`, local backup artifacts in `db-backup/` and SQL dumps in the repo root, generated `dist/**` output unless needed to confirm production behavior.

## Threat Categories

### Spoofing

The application authenticates with long-lived HS256 JWT bearer tokens and derives the acting user from those tokens. The API must reject any attempt to choose identity through query parameters, request bodies, or route parameters when returning or mutating user-scoped data. Bootstrap or recovery flows must not rely on default shared passwords or weak fallback secrets.

### Tampering

Traders can submit trade records, journal entries, voice notes, reactions, and moderation inputs. The server must validate all user-controlled fields and bind sensitive mutations to the authenticated actor and that actor’s permissions. Administrative or cross-user mutations must require server-side role checks based on trusted JWT identity.

### Information Disclosure

This project stores sensitive internal trading data, behavioral notes, transcripts, and admin artifacts. Public GET endpoints must not expose private or role-restricted records, and object-storage download endpoints must verify ownership before issuing signed URLs. Error handling and logging must avoid leaking secrets, stack traces, raw tokens, or sensitive third-party responses.

### Denial of Service

Several endpoints perform expensive work: login, file upload/transcription, AI review generation, digest/report generation, market-data fetches, and backup creation. These paths require bounded request sizes, reasonable rate limits or auth gates, and timeouts around external calls so unauthenticated or low-privilege users cannot force excessive compute, storage, or third-party API usage.

### Elevation of Privilege

The main privilege boundary is between public users, authenticated traders, curators, and admins. Every admin action, user-management operation, database export, backup flow, and cross-user data read must be enforced server-side from JWT-derived role and ownership checks. Caller-supplied usernames, actor fields, or route IDs must never be enough to gain access to another user’s data or privileged functions.