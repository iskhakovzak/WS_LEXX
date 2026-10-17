# API error codes

Body: `{ error, code, details?, requestId? }`. `error` is already translated (RU/EN/UZ by `X-Lang`).
Frontend: branch on `code` and show `error`. Don't map English texts.

Source of truth: `ERROR_CODES` in `errors.ts` (status) and `src/i18n/ru/errors.ts` (text). A test checks that every code has text in all three languages.

## Registry (`ERROR_CODES`)

| Code | Status | When | `details` |
|---|---|---|---|
| `BAD_REQUEST` | 400 | Malformed input with no specific code. Also pg `22P02` (bad literal, e.g. `"abc"::int`) and 4xx framework errors (status kept, e.g. 405). | sometimes zod `flatten()` (old handlers) |
| `VALIDATION` | 400 | The zod schema of `route()` failed, or a `ZodError` was thrown. | `[{ path: "body.label", message }]` |
| `INVALID_JSON` | 400 | The request body is not valid JSON (body-parser). | — |
| `INVALID_ID` | 400 | A path or body id is not a positive integer. | — |
| `INVALID_DATE` | 400 | A date is not `YYYY-MM-DD` or not a real date. | — |
| `INVALID_TICKER` | 400 | The ticker or symbol fails the format check. | — |
| `TICKER_REQUIRED` | 400 | The ticker is missing. | — |
| `INVALID_TRADER` | 400 | The trader name is malformed (too long, bad characters). | — |
| `TRADER_REQUIRED` | 400 | The trader parameter is missing. | — |
| `NO_FIELDS` | 400 | A PATCH has nothing to update. | — |
| `UPLOAD_ERROR` | 400 | A multer error other than size (unexpected field, too many files…). | `{ reason: "LIMIT_…", field? }` |
| `AUTH_REQUIRED` | 401 | Not signed in, the token is invalid or revoked, or the user is inactive or banned. | — |
| `FORBIDDEN` | 403 | The caller lacks the capability or the target is outside their scope. | `{ capability }` when known |
| `GUEST_READ_ONLY` | 403 | A guest tried a mutation or a member-only action. | — |
| `STAFF_ONLY` | 403 | Only curators and admins. | — |
| `TRADE_FORBIDDEN` | 403 | The trade exists but the caller may not access it. | — |
| `CORS_REJECTED` | 403 | The request origin is not allowed (production CORS). | — |
| `NOT_FOUND` | 404 | Generic: the record does not exist or was deleted. | — |
| `TRADE_NOT_FOUND` | 404 | Trade. Sometimes 400 when the trade id came in a body. | — |
| `TRADER_NOT_FOUND` | 404 | Trader. 400 in two body-validation places. | — |
| `USER_NOT_FOUND` | 404 | User account. | — |
| `RESEARCH_NOT_FOUND` | 404 | Research entry. | — |
| `EVENT_NOT_FOUND` | 404 | Calendar event. | — |
| `FEED_ENTRY_NOT_FOUND` | 404 | Daily feed entry. | — |
| `DISCUSSION_NOT_FOUND` | 404 | Discussion. | — |
| `COMMENT_NOT_FOUND` | 404 | Comment. | — |
| `IDEA_NOT_FOUND` | 404 | Trade idea. | — |
| `COHORT_NOT_FOUND` | 404 | Academy cohort. | — |
| `SESSION_NOT_FOUND` | 404 | Academy session (class). | — |
| `CHECKLIST_ITEM_NOT_FOUND` | 404 | Pre-trade checklist template item. | — |
| `CONFLICT` | 409 | Duplicate or conflicting write. pg `23505` (unique) and `23503` (foreign key) map here automatically. | sometimes `{ field }` |
| `TOO_LARGE` | 413 | The body is over the JSON limit, or a file is over the multer limit. | — |
| `RATE_LIMITED` | 429 | Too many requests. | — |
| `INTERNAL` | 500 | Any unexpected error. There is no message, and the stack is in the log. | `requestId` in the body |
| `AI_UNAVAILABLE` | 502 | The AI provider call failed (old handlers). | — |
| `TIMEOUT` | 503 | pg `57014` (statement timeout or cancel). | `requestId` in the body |

A status can differ from the default when an old handler used another one. The codemod kept every original status, so branch on `code` first and `status` second.

## Codes outside the registry (not translated through `errors` yet)

These are hand-written in route files, auth or the security module. They have stable codes, but their text is still a literal or comes from another namespace. The translation wave moves them into the registry.

| Code | Status | Where / when |
|---|---|---|
| `INVALID_CREDENTIALS` 401, `BANNED` 403, `GUEST_DISABLED` 403, `PASSWORD_CHANGE_REQUIRED` 403, `LOGIN_LOCKED` 429, `WEAK_PASSWORD` / `WRONG_PASSWORD` / `SAME_PASSWORD` 400 | see code | auth / `lib/security/respond.ts` (owned by the security agent). Some carry extra top-level fields (`retryAfterSec`, `policy`). |
| `CHECKLIST_REQUIRED`, `CHECKLIST_NOT_PASSED`, `CHECKLIST_MISMATCH` | 422 | trades: create without a valid pre-trade checklist |
| `CHECKLIST_INVALID_ID`, `CHECKLIST_ALREADY_LINKED` | 400/409 | checklist responses |
| `FOLDER_EXISTS` | 409 | playbook folder rename |
| `JOURNAL_CONFLICT` | 409 | journal: edited in another tab (`current` attached) |
| `SYNC_RUNNING`, `SYNC_PENDING` | 409 | PropReports sync in progress or not yet run for the date |
| `UPSTREAM_UNAVAILABLE` | 503 | external data source down (`retryAfterSec`) |
| `DUPLICATE` | 409 | events: same ticker + date + type (`existingId`) |
| `NOT_OWNER`, `MEMBERS_ONLY`, `NOT_ENROLLED`, `OFFICE_ONLY`, `NO_OCCURRENCE` | 403/400 | ownership and academy attendance |
| `IDEA_CONVERT_RETIRED` | 410 | old idea→trade conversion endpoint |
| `EOD_INCOMPLETE` | 409 | end-of-day close |
| `ai_not_configured` | 503 | AI env missing (lower-case, legacy) |
| `RATE_LIMITED` | 429 | IP limiters in app.ts / `lib/security/http.ts` (same code as the registry) |
