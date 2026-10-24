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
| `CONFLICT` | 409 | Duplicate or conflicting write. pg `23505` (unique) and `23503` (foreign key) map here automatically. | sometimes `{ field }` |
| `TOO_LARGE` | 413 | The body is over the JSON limit, or a file is over the multer limit. | — |
| `RATE_LIMITED` | 429 | Too many requests. | — |
| `INTERNAL` | 500 | Any unexpected error. There is no message, and the stack is in the log. | `requestId` in the body |
| `AI_UNAVAILABLE` | 502 | The AI provider call failed (old handlers). | — |
| `TIMEOUT` | 503 | pg `57014` (statement timeout or cancel). | `requestId` in the body |
| `NAME_REQUIRED` | 400 | A required name/title is empty (rules). | — |
| `NAME_TOO_LONG` | 400 | A name is over the length limit (params `max`). | — |
| `DAY_IN_FUTURE` | 400 | A trading day in the future where only past/today is allowed (self-checks). | — |
| `RULE_NOT_FOUND` | 404 | Discipline rule (also a self-check rule). | — |
| `RULE_KIND_INVALID` | 400 | `kind` is not in GET /rules/kinds. | `{ kinds }` on create |
| `RULE_THRESHOLD_INVALID` | 400 | Threshold is not an object / not JSON. | — |
| `RULE_TICKERS_REQUIRED` | 400 | Rule threshold: empty ticker list (params `field` = field label in the request language). | — |
| `RULE_TICKERS_INVALID` | 400 | Rule threshold: malformed ticker list. | — |
| `RULE_TIME_INVALID` | 400 | Rule threshold: bad time. | — |
| `RULE_NUMBER_INVALID` | 400 | Rule threshold: not a positive number. | — |
| `RULE_WINDOW_ORDER` | 400 | trading_window: end ≤ start. | — |
| `RULE_FACTOR_MIN` | 400 | no_size_up_after_loss: factor < 1. | — |
| `RULES_OWN_ONLY` | 403 | A trader asked for another trader's rules/violations. | — |
| `RULE_DESK_STAFF_ONLY` | 403 | Creating/changing a desk-wide rule without an unrestricted rules.manage.team scope. | — |
| `RULE_EDIT_OWN_ONLY` | 403 | A trader edits someone else's rule. | — |
| `RULE_OFFICE_LOCKED` | 403 | A trader edits an office rule set for them. | — |
| `VIOLATION_UNACK_STAFF_ONLY` | 403 | A trader un-acknowledges a violation. | — |
| `VIOLATION_DECISION_STAFF_ONLY` | 403 | A trader sets resolution/consequence. | — |
| `VIOLATION_DISMISS_STAFF_ONLY` | 403 | DELETE /rule-violations/:id without rules.violations.delete. | `{ capability }` |
| `SETUP_SUGGESTION_MISSING` | 409 | setups-auto accept/reject before a suggestion was computed. | — |
| `DATE_RANGE_INVALID` | 400 | `from` > `to` (or weekEnd before weekStart). | — |
| `TRIGGER_NOT_FOUND` | 404 | Personal behaviour trigger (/behavior/triggers). | — |
| `TRIGGER_KIND_INVALID` | 400 | `kind` is not one of GET /behavior/triggers → kinds. | — |
| `TRIGGER_PARAM_RANGE` | 400 | Trigger parameter out of range (params `field` in the request language, `min`, `max`). | — |
| `TRIGGER_TEXT_REQUIRED` | 400 | Custom (reminder) trigger without name and note. | — |
| `TRIGGERS_OWN_ONLY` | 403 | Trigger of another trader without rules.manage.team. | — |
| `WEEKLY_REPORT_OWN_ONLY` | 403 | Weekly psychology report recalculation of someone else's report. | — |
| `WEEKLY_REPORT_WEEK_LOCKED` | 400 | Weekly psychology report recalculation for an older week. | `{ allowed: [current, last] }` |
| `PROMOTION_SELF_ONLY` | 403 | A trader requests a promotion for someone else. | — |
| `STAGE_NOT_ASSIGNED` | 400 | Promotion request for a user without a stage. | — |
| `STAGE_TOP` | 400 | Promotion request from the top stage. | — |
| `STAGE_ALREADY` | 409 | Direct stage assignment to the current stage. | — |
| `PROMOTION_PENDING_EXISTS` | 409 | Second pending promotion request. | — |
| `PROMOTION_REQUEST_NOT_FOUND` | 404 | Promotion request. | — |
| `PROMOTION_REQUEST_DECIDED` | 409 | Approve / reject of a request that is no longer pending. | — |
| `PROMOTION_SELF_APPROVE` | 403 | A mentor approves their own request. | — |
| `PROMOTION_OWN_REQUEST` | 403 | A curator approves a promotion request they filed themselves (four eyes; settings.manage may). | — |
| `PROMOTION_COMMENT_REQUIRED` | 400 | Approving a not-ready report without a comment (params `passed`, `total`). | — |
| `PROMOTION_STAGE_CHANGED` | 409 | Approving a request whose from-stage is outdated. | — |
| `PROMOTION_REJECT_REASON` | 400 | Rejecting a promotion request without a comment. | — |
| `CHALLENGE_NOT_FOUND` | 404 | Academy exam (challenge). | — |
| `CHALLENGE_TEMPLATE_NOT_FOUND` | 400 | Unknown `templateKey`. | — |
| `CHALLENGE_RULES_INVALID` | 400 | Rules overrides can't be normalised. | — |
| `COHORT_NAME_TAKEN` | 409 | Create / rename a cohort to a taken name. | — |
| `COHORT_NAME_TAKEN_ACTIVE` | 409 | Restoring an archived cohort whose name is taken. | — |
| `ALREADY_ENROLLED` | 409 | Enrolling a member twice (params `user`). | — |
| `SESSION_ROOM_REQUIRED` | 400 | Session mode office without a room. | — |
| `SESSION_URL_REQUIRED` | 400 | Session mode online without a link. | — |
| `SESSION_ROOM_URL_REQUIRED` | 400 | Session mode hybrid without a room or link. | — |
| `RANGE_TOO_LONG` | 400 | Date range over the limit (params `max`). | — |
| `NOT_SESSION_DAY` | 400 | Attendance for a date the session does not occur on (params `date`). | — |
| `SESSION_NOT_STARTED` | 400 | Marking attendance before the start. | — |
| `OFFICE_ONLY` | 400 | Self check-in on an office session. | — |
| `NOT_ENROLLED` | 403 | Self check-in by a non-member of the cohort. | — |
| `NO_OCCURRENCE` | 400 | Self check-in on a day without the session. | — |
| `TOO_EARLY` | 409 | Self check-in before the window (params `min`). | `{ opensAt, closesAt, serverNow }` |
| `TOO_LATE` | 409 | Self check-in after the window (params `min`). | `{ opensAt, closesAt, serverNow }` |
| `MEETING_NOT_FOUND` | 404 | 1:1 meeting. | — |
| `ACTION_NOT_FOUND` | 404 | 1:1 agreement (action item). | — |
| `GOAL_NOT_FOUND` | 404 | IDP goal. | — |
| `ACTION_STUDENT_DONE_ONLY` | 403 | A student edits an agreement beyond open/done. | — |
| `GOAL_STUDENT_MANUAL_ONLY` | 403 | A student edits a goal beyond manual progress. | — |
| `GOAL_STATUS_MANUAL` | 400 | Setting achieved/missed by hand. | — |
| `PROGRAM_NOT_FOUND` | 404 | Academy program (course). | — |
| `MODULE_NOT_FOUND` | 404 | Academy course module. | — |
| `SUBMISSION_NOT_FOUND` | 404 | Assignment submission. | — |
| `QUIZ_ANSWERS_REQUIRED` | 400 | Quiz attempt without answers. | — |
| `QUIZ_EMPTY` | 400 | Attempt on a quiz without questions. | — |
| `QUIZ_NO_ATTEMPTS` | 400 | Quiz attempt limit reached. | — |
| `CONTENT_INVALID` | 400 | ("Check the content: …") Quiz questions / rubric failed validation; `reason` = the problems in the request language. | `{ errors: string[] }` |
| `TRADES_NOT_YOURS` | 400 | Submission links foreign trades (params `ids`). | — |
| `INVALID_URL` | 400 | A URL field fails the http(s) check. | — |
| `VIDEO_URL_UNSUPPORTED` | 400 | Lesson video URL outside the allow-list. | — |
| `SUBMISSION_EMPTY` | 400 | Empty assignment submission. | — |
| `SUBMISSION_MIN_TRADES` | 400 | The assignment needs N linked trades (params `count`). | — |
| `SUBMISSION_GRADED_EDIT` | 409 | Editing a graded submission. | — |
| `SUBMISSION_GRADED` | 409 | Grading / editing an already graded submission. | — |
| `SUBMISSION_GRADED_WITHDRAW` | 409 | Withdrawing a graded submission. | — |
| `ASSIGNMENT_NO_RUBRIC` | 400 | Grading an assignment without a rubric. | — |
| `RUBRIC_INCOMPLETE` | 400 | Grading with missing criterion scores (params `missing`). | — |
| `RETURN_COMMENT_REQUIRED` | 400 | Returning a submission without a comment. | — |

### Added in the translation wave (server-b)

| Code | Status | When | `details` |
|---|---|---|---|
| `INVALID_FIELD` | 400 | A specific body/query field is malformed (`params.field` names it). | — |
| `IDS_REQUIRED` | 400 | Bulk endpoints: `ids` is missing or not a list of positive integers. | — |
| `MUTE_TOO_LONG` | 400 | Notification prefs: `muteAllUntil` more than a year ahead. | — |
| `NOTIFICATION_NOT_FOUND` | 404 | Notification (not yours or does not exist). | — |
| `CANNOT_CHANGE_OWN_ROLE` | 400 | Admin: role change of yourself. | — |
| `CANNOT_BAN_ADMIN` | 403 | Admin: ban of an admin. | — |
| `CANNOT_BAN_SELF` | 400 | Admin: ban of yourself. | — |
| `ADMIN_ONLY_BAN_CURATOR` | 403 | Admin: a curator tried to ban a curator. | — |
| `REPORTER_BANNED` | 403 | POST /reports by a banned member. | — |
| `REPORT_NOT_FOUND` | 404 | Moderation report. | — |
| `REPORT_AUTHOR_NOT_FOUND` | 409 | Ban-author from a report whose author can't be resolved. | — |
| `FILE_REQUIRED` | 400 | Upload endpoints without the file part. | — |
| `XLS_PARSE_FAILED` | 400 | PropReports XLS import: the file can't be parsed. | parser message (string) |
| `XLS_NO_TRADES` | 400 | PropReports XLS import: no trade rows. | — |
| `ACCOUNT_LINKED_TO_OTHER` | 400 | PropReports import: the account belongs to another trader. | — |
| `INVALID_LOCALE` | 400 | PATCH /users/me/locale with an unsupported locale. | — |
| `ADMIN_ONLY` | 403 | Creating / changing / deactivating admins, granting the admin role. | — |
| `USER_NAME_TAKEN` | 409 | Create / rename a user to an existing name (rename: also another user's Latin name, compared like the sign-in). | — |
| `RENAME_DATA_CONFLICT` | 409 | Rename: rows already carry the new name (orphans, an import under that name); nothing was renamed. | `{ rows: { "table.column": n } }` |
| `CANNOT_DEACTIVATE_SELF` | 400 | Users: deactivate your own account. | — |
| `PASSWORD_CHANGE_REQUIRED` | 403 | The account must change its password before using the API (token flag `pwc`). The login screen branches on it. | — |
| `GUEST_NO_PERSONAL` | 403 | A guest asked for a trader's personal data (check-ins, psychology report…). | — |
| `PERSONAL_DATA_FORBIDDEN` | 403 | Personal data of another trader outside the caller's scope. | — |
| `GUEST_DISABLED` | 403 | POST /auth/guest while guest mode is off. The login screen branches on it. | — |
| `INIT_PASSWORDS_DISABLED` | 503 | POST /auth/init-passwords without ADMIN_PASSWORD configured. | — |
| `ADMIN_PASSWORD_REQUIRED` | 403 | POST /auth/init-passwords with a wrong admin password. | — |
| `INIT_PASSWORDS_MISSING` | 400 | POST /auth/init-passwords without passwords. | — |
| `NOT_OWNER` | 403 | Shared desk rows with `created_by` (Big 7, watchlist): not the author and not staff. | sometimes `{ denied }` (ids) |
| `ai_not_configured` | 503 | AI env missing (lower-case, legacy spelling the frontend branches on). | — |
| `MISTAKES_OWN_ONLY` | 403 | Mistake log: another trader's entries without errors.manage.team. | — |
| `MISTAKE_EDIT_OWN_ONLY` | 403 | Mistake log: edit of someone else's entry. | — |
| `MISTAKE_DELETE_OWN_ONLY` | 403 | Mistake log: delete of someone else's entry. | — |
| `TEXT_TOO_LONG` | 400 | A text field is over its length limit. | — |
| `DESCRIPTION_REQUIRED` | 400 | Mistake log / similar: empty description. | — |
| `TRADE_NOT_OWNED` | 400 | A trade id in the body that is not the trader's (or deleted). | — |
| `TRADE_IDS_REQUIRED` | 400 | Bulk endpoints: empty `tradeIds`. | — |
| `CANNOT_APPLY_TO_SELF` | 400 | Admin console people actions on your own account. | — |
| `CANNOT_FREEZE_ADMIN` | 403 | Admin console: freeze an admin. | — |
| `ADMIN_ONLY_FREEZE_CURATOR` | 403 | Admin console: a curator tried to freeze a curator. | — |
| `ALREADY_FROZEN` | 409 | Admin console: freeze of a frozen account. | — |
| `NOT_FROZEN` | 409 | Admin console: unfreeze of an active account. | — |
| `ALREADY_ARCHIVED` | 409 | Admin console: archive of an archived account. | — |
| `ADMIN_ONLY_ARCHIVE_CURATOR` | 403 | Admin console: a curator tried to archive a curator. | — |
| `ALREADY_ACTIVE` | 409 | Admin console: restore of an active account. | — |
| `CURATOR_NOT_ACTIVE` | 400 | Assigning a curator who is not an active curator/admin. | — |
| `CANNOT_SELF_CURATOR` | 400 | Assigning a member as their own curator. | — |
| `CURATOR_ALREADY_ASSIGNED` | 409 | Assigning the same curator again. | — |
| `UNKNOWN_ROLE` | 400 | Role change with an unknown role. | — |
| `ROLE_UNCHANGED` | 409 | Role change to the current role. | — |
| `UNKNOWN_USER` | 400 | A body names a user that is not active. | — |
| `REASON_REQUIRED` | 400 | Admin console actions without a reason. | validation issues |
| `USER_NAME_REQUIRED` | 400 | Creating a user without a name. | validation issues |
| `PASSWORD_TOO_SHORT` | 400 | Creating a user with a too short password (schema minimum). | validation issues |
| `NAME_LATIN_CHARS` | 400 | Latin name alias with other characters. | — |
| `NAME_LATIN_INVALID_FOR` | 400 | Bulk Latin names (POST /admin/console/people/name-latin/bulk): one item fails cleanNameLatin; nothing is saved. | `{ id, code }` of the item |
| `BREACH_NOT_FOUND` | 404 | Risk breach (risk_alert_log row). | — |
| `BREACH_REVIEW_NOT_FOUND` | 404 | Breach review (risk_breach_reviews). | — |
| `AGREEMENT_NOT_FOUND` | 404 | An agreed action of a breach review. | — |
| `NOTE_EMPTY` | 400 | Curator / other notes: empty body. | validation issues |
| `NOTE_NOT_FOUND` | 404 | A note (curator notes and similar). | — |
| `NOTE_AUTHOR_ONLY` | 403 | Editing someone else's note text. | — |
| `TIER_KEY_DUPLICATE` | 400 | Scaling tiers save with a repeated key. | — |
| `TIER_NOT_FOUND` | 400 | A tier key that is not in the ladder. | — |
| `SCALING_OWN_ONLY` | 403 | A trader asked for another trader's scaling plan / history. | — |
| `TRADER_NO_DATA` | 404 | Scaling proposal for a trader the engine has no data for. | — |
| `PROPOSAL_PENDING` | 409 | Scaling: a second pending proposal. | `{ proposal }` when known |
| `PROPOSAL_TARGET_REQUIRED` | 400 | Manual proposal without action/tier while the recommendation is hold. | — |
| `ALREADY_ON_TIER` | 400 | Proposal / assignment to the current tier. | — |
| `PROPOSAL_NOT_FOUND` | 404 | Scaling proposal. | — |
| `PROPOSAL_DECIDED` | 409 | Approve / reject of a decided proposal. | `{ proposal }` |
| `PROPOSAL_TIER_GONE` | 400 | Approving a proposal whose target tier was removed. | — |
| `AUDIENCE_INVALID` | 400 | Discussions: the audience value is not a list / string. | — |
| `AUDIENCE_UNKNOWN` | 400 | Discussions: an unknown audience token. | — |
| `AUDIENCE_TOO_MANY` | 400 | Discussions: more than 12 audience tokens. | — |
| `AUDIENCE_FILTER_INVALID` | 400 | GET /discussions?audience= with not exactly one token. | — |
| `COHORT_OWN_ONLY` | 400 | Discussions: a member addressed a cohort they don't study in. | — |
| `TOPIC_REQUIRED` | 400 | New discussion without a topic. | — |
| `BANNED_ACTION` | 403 | A banned member tried to post, comment or vote. | — |
| `TRADE_NOT_YOURS` | 403 | Linking another member's trade (discussion, idea…). | — |
| `DISCUSSION_AUTHOR_ONLY` | 403 | Edit / delete / restore of someone else's discussion. | — |
| `PIN_STAFF_ONLY` | 403 | Pin / unpin by a non-moderator. | — |
| `COMMENT_NOT_IN_THREAD` | 404 | Accepting a comment of another thread. | — |
| `COMMENT_EMPTY` | 400 | Empty comment text. | — |
| `COMMENT_OWN_ONLY` | 403 | Edit / delete of someone else's comment. | — |
| `EOD_OWN_ONLY` | 403 | End of day: another trader's day without journal.read.team. | — |
| `INVALID_RANGE` | 400 | A from/to range that is malformed, reversed or too long. | — |
| `TRADE_REVIEW_OWN_ONLY` | 403 | End of day: reviewing someone else's trade. | — |
| `EOD_DAY_CLOSED` | 409 | Editing a trade review / day summary of a closed day. | `{ date }` |
| `EOD_ALREADY_CLOSED` | 409 | Closing a closed day. | `{ day }` |
| `EOD_FUTURE_DAY` | 422 | Closing a day after today (NY). | — |
| `EOD_TOO_EARLY` | 422 | Closing today before the market close (NY); `opensAt` = HH:MM. | `opensAt` |
| `EOD_INCOMPLETE` | 422 | Closing a day with trades that lack setup / grade. | `{ missing: [{ tradeId, ticker, fields }] }` |
| `EOD_DAY_NOT_FOUND` | 404 | End-of-day record. | — |
| `EOD_NOT_CLOSED` | 409 | Curator review of an open day. | — |
| `INVALID_WEEK` | 400 | A week parameter that can't be parsed. | — |
| `FUTURE_WEEK` | 400 | Rating a week after the current one. | — |
| `SCORE_RANGE` | 400 | Rating scores out of range. | — |
| `RATING_NOT_FOUND` | 404 | Curator rating. | — |
| `RATING_OWN_ONLY` | 403 | Edit / delete of another curator's rating. | — |
| `RATING_ACK_TRADER_ONLY` | 403 | Acknowledging someone else's rating. | — |
| `WEEKLY_OWN_ONLY` | 403 | Weekly review of another trader without journal.read.team. | — |
| `SELF_REVIEW_TRADER_ONLY` | 403 | Weekly self-review by someone else. | — |
| `GOALS_OWN_ONLY` | 403 | Marking another trader's weekly goals. | — |
| `WEEKLY_NOT_FOUND` | 404 | Weekly review document. | — |
| `ASSIGNEE_NOT_STAFF` | 400 | Assigning a curator / risk manager / mentor who is not active staff. | — |
| `IDEA_COMMENT_DELETE_FORBIDDEN` | 403 | Deleting an idea comment. | — |
| `FIELD_REQUIRED` | 400 | A required field is missing (`params.field` names it). | — |
| `TOO_MANY` | 400 | A list over its size limit. | — |
| `AUTHOR_OR_STAFF_ONLY` | 403 | Edit / delete / restore of someone else's entry (events, ideas, notes, research…). | — |
| `OWN_TRADES_ONLY` | 403 | A trade (or its fills / quality / review) of another trader. | — |
| `OWN_DATA_ONLY` | 403 | Personal data of another trader. | — |
| `MEMBERS_ONLY` | 403 | Guests: member-only features (training on desk trades, tasks…). | — |
| `GUEST_UNAVAILABLE` | 403 | Guests: office stats, digest, benchmark. | — |
| `UPSTREAM_FAILED` | 502 | A market-data / SEC / report source failed. | — |
| `NO_DATA` | 404 | No candles / fundamentals / options data for the request. | — |
| `ALREADY_IN_WATCHLIST` | 409 | Adding a ticker that is already on the list. | sometimes `{ existing }` |
| `SETUP_NOT_FOUND` | 404 | Playbook setup. | — |
| `EXAMPLE_NOT_FOUND` | 404 | Playbook example (a trade attached to a setup). | — |
| `PLAN_NOT_FOUND` | 404 | Game plan. | — |
| `VOICE_NOTE_NOT_FOUND` | 404 | Voice note (or its audio file). | — |
| `DOC_NOT_FOUND` | 404 | A report document (weekly psychology, research report…). | — |
| `TEMPLATE_NOT_FOUND` | 404 | Game plan / other template. | — |
| `SCENARIO_NOT_FOUND` | 404 | What-if / plan scenario. | — |
| `ACCOUNT_NOT_FOUND` | 404 | Broker account. | — |
| `AI_COOLDOWN` | 429 | AI endpoints with a per-item cooldown. | — |
| `MEDIA_DAILY_LIMIT` | 429 | Screenshot uploads over the daily limit. | — |
| `IMAGE_TYPE` | 400 | Image uploads of another type. | — |
| `AUDIO_REQUIRED` | 400 | Voice note upload without the file. | — |
| `DUPLICATE` | 409 | Events: same ticker + date + type; other duplicates. | `{ existingId }` |
| `SYNC_RUNNING` | 409 | PropReports: another sync / recompute is in progress. | — |
| `NOT_AVAILABLE_YET` | 503 | A feature whose tables / migrations are not in place yet. | — |
| `STORAGE_FAILED` | 502 | Object storage upload / read failed. | — |
| `WRONG_PASSWORD` | 403 | Password-protected actions (playbook). | — |
| `NOT_CONFIGURED` | 503 | A required environment setting is missing. | — |
| `EDITED_ELSEWHERE` | 409 | Optimistic-lock conflict (journal / notes). | `{ current }` |
| `SELECT_AT_LEAST_ONE` | 400 | Bulk actions with an empty selection. | — |
| `RANGE_TOO_LONG` | 400 | A from/to range over its limit. | — |
| `NAME_REQUIRED_GENERIC` | 400 | A title / name field is empty. | — |
| `GENERATION_FAILED` | 502 | AI generation returned nothing usable. | — |
| `COMPUTE_FAILED` | 500 | An aggregation query failed (analyst stats…). | — |
| `STAFF_COMPARE_ONLY` | 403 | Benchmark against named traders by a non-curator. | — |
| `INVALID_SYMBOL` | 400 | A symbol that fails the format check. | — |
| `NO_TASKS` | 404 | Training: no task matches the filters. | — |
| `NON_TRADING_DAY` | 400 | A date that is a weekend / holiday. | — |
| `ACCOUNT_NOT_YOURS` | 403 | PropReports import of an account mapped to someone else. | — |
| `OWN_ENTRY` | 400 | Reacting to / acknowledging your own entry. | — |
| `SETUP_EDITOR_ONLY` | 403 | Playbook: examples, screenshots, AI tools of a setup you can't edit. | — |
| `OFFICE_SETUP_NO_AUTHOR` | 400 | Playbook: author actions on an office setup. | — |
| `TICKER_NOT_IN_SEC` | 404 | SEC filings lookup for an unknown ticker. | — |
| `SETUP_TEXT_REQUIRED` | 400 | Playbook AI tools on an empty setup. | — |
| `SETUP_ALREADY_OFFICE` | 409 | Proposing / moving an office setup to the Office. | — |
| `NOTES_ACCESS` | 403 | Author / junior notes of another trader. | — |
| `SETUP_OWN_ONLY` | 403 | Proposing someone else's setup to the Office. | — |
| `REPORT_PARSE_FAILED` | 400 | PropReports report file can't be parsed. | — |
| `REPORT_PERIOD_UNKNOWN` | 400 | PropReports performance import without a period. | — |
| `REPORT_ACCOUNT_UNKNOWN` | 400 | PropReports import without a detectable account. | — |
| `OWN_JUNIORS_ONLY` | 403 | Junior notes of someone else's juniors. | — |
| `IDEA_ALREADY_TRADED` | 409 | Linking a trade to an idea that already has one. | — |
| `EXAMPLE_SETUP_FORBIDDEN` | 403 | Adding an example to a setup you can't edit. | — |
| `OFFICE_PLAYBOOK_STAFF_ONLY` | 403 | A trader creating an office setup. | — |
| `SHARE_SENIOR_ONLY` | 403 | Sharing a setup below the senior stage. | — |
| `FILLS_CSV_REQUIRED` | 400 | PropReports fills upload of another format. | — |
| `REVIEW_DELETE_OWN_ONLY` | 403 | Deleting another curator's trade review. | — |
| `UPSTREAM_UNAVAILABLE` | 503 | External data source down; body carries top-level `retryAfterSec`. | — |
| `SYNC_PENDING` | 409 | Daily feed generation before the day's sync. | `{ date, lastSyncedAt, scheduler }` |
| `JOURNAL_CONFLICT` | 409 | Journal day saved over a newer version; body carries top-level `current`. | — |
| `REVIEWER_ONLY` | 403 | Junior notes reviewer endpoints. | — |
| `RATE_REVIEWER_ONLY` | 403 | Rating junior notes without the reviewer role. | — |
| `EXPIRATION_NOT_FOUND` | 404 | Options chain for an unknown expiration. | `{ available }` |
| `IMAGE_TOO_LARGE` | 413 | Screenshot uploads over the size limit. | — |
| `IMAGE_UNREADABLE` | 400 | Screenshot upload body can't be read. | — |
| `OFFICE_ALREADY_PUBLIC` | 403 | Sharing an office setup. | — |
| `OFFICE_PLAYBOOK_STAFF_EDIT` | 403 | A trader editing an office setup. | — |
| `FOLDER_EXISTS` | 409 | Playbook folder rename onto an existing folder; body carries top-level `targetCount`. | — |
| `IDEA_CONVERT_RETIRED` | 410 | The retired idea → trade conversion endpoint. | — |
| `AUDIO_TYPE` | 415 | Voice note upload of a non-audio file. | — |
| `PENDING_NOT_FOUND` | 404 | PropReports reconcile: pending broker row. | — |
| `TRADE_ALREADY_LINKED` | 409 | Reconcile merge into a broker-linked trade. | — |
| `TRADE_OTHER_TRADER` | 409 | Reconcile merge across traders. | — |
| `BROKER_TRADE_EXISTS` | 409 | Reconcile keep-separate of an already imported trade. | — |
| `PROPREPORTS_NOT_CONFIGURED` | 503 | PropReports API endpoints without credentials. | — |
| `CRON_NOT_CONFIGURED` | 503 | `/api/cron/tick` called while CRON_SECRET is unset. | — |
| `FINVIZ_BUSY` | 503 | The Finviz export queue is full for interactive callers (scheduled jobs always get in). | — |
| `FINVIZ_NOT_CONFIGURED` | 503 | `POST /api/finviz/refresh` without FINVIZ_AUTH or with the desk switch finviz.enabled off. | — |
| `NEWS_CHANNEL_NOT_CONFIGURED` | 503 | `POST /api/news-channel/send-now` without NEWS_CHANNEL_BOT_TOKEN + NEWS_CHANNEL_CHAT_ID or with the desk switch newsChannel.enabled off. | — |
| `BACKFILL_RUNNING` | 409 | A PropReports history backfill is already running. | `{ active }` |
| `PROPREPORTS_FILE_TOO_LARGE` | 413 | PropReports import file over the 4 MB upload limit (Vercel body limit). | — |
| `PROPREPORTS_REQUEST_INVALID` | 400 | PropReports v2 request parameter refused before sending (fills filter, report mode / baseCurrency, upload options). | — |
| `PROPREPORTS_SUPERUSER_REQUIRED` | 403 | PropReports superuser-only action (instruments, profiles, upload*) with a token without the right (vendor 403). | — |
| `PROPREPORTS_TOKEN_REJECTED` | 502 | PropReports answered 401 to the configured token. | — |
| `PROPREPORTS_REJECTED` | 502 | PropReports answered 400 / 404 / 405 to a staff request. | — |
| `PROPREPORTS_BUSY` | 503 | PropReports answered 429 / 503 after the client retries. | — |
| `FILE_TYPE` | 400 | Upload of an unsupported file type. | — |
| `TRADES_REPORT_EMPTY` | 400 | PropReports Trades file without recognizable rows. | — |
| `PROMOTE_STAFF_ONLY` | 403 | POST /playbook/:id/promote without playbook.review. | — |
| `DESK_TEMPLATES_STAFF_ONLY` | 403 | Game plan template create/edit of a shared or desk template without gameplan.publish. | — |
| `DESK_PLAN_MEDIA_UPLOAD_STAFF_ONLY` | 403 | Plan media upload with context=desk without gameplan.publish. | — |
| `DESK_PLAN_MEDIA_DELETE_STAFF_ONLY` | 403 | Plan media delete of a desk screenshot without gameplan.publish. | — |
| `FEED_GENERATE_STAFF_ONLY` | 403 | POST /market-brief/generate-feed without dailyfeed.manage. | — |
| `DAILY_NOTHING_TO_DISPUTE` | 409 | POST /daily/review with `dispute: true` for a day whose focus was not broken (kept, no trades, no focus). | — |
| `PERMISSIONS_CELLS_REJECTED` | 400 | PUT /permissions/matrix with cells for an unknown capability, a locked role (admin/guest) or an admin-only capability. | `details.problems: [{ kind: "unknown_capability" \| "locked_role" \| "admin_only", role, capability }]` |
| `SETTINGS_INVALID` | 400 | PUT /admin/settings with an unknown key, a key twice, or a value that does not fit its registry definition (lib/settings/validate.ts); nothing is written. | `details.problems: [{ key, kind: "unknown" \| "duplicate" \| "type" \| "range" \| "integer" \| "time" \| "option" \| "order" \| "length", min?, max?, options?, after? }]` |
| `QUESTS_DISABLED` | 409 | POST /quests/assign while `quests.enabled` or `quests.curatorEnabled` is off. | — |
| `QUEST_TEMPLATE_UNKNOWN` | 400 | POST /quests/assign with a template that is not curator-assignable (GET /quests/templates lists them). | — |
| `QUEST_TARGET_RANGE` | 400 | POST /quests/assign: target outside the template's bounds. | `{ min, max }` params |
| `QUEST_DEADLINE_INVALID` | 400 | POST /quests/assign: endsOn before today or more than 92 days ahead. | `{ max }` param |
| `QUEST_POINTS_RANGE` | 400 | POST /quests/assign: rewardPoints above `quests.curatorMaxPoints`. | `{ max }` param |
| `QUEST_LIMIT` | 409 | POST /quests/assign when the trader has `quests.curatorMaxActive` active curator quests. | `{ max }` param |
| `QUEST_TRADER_ONLY` | 400 | POST /quests/assign for a user who is not an active trader. | — |
| `QUEST_NOT_FOUND` | 404 | POST /quests/:id/cancel or /complete: no such quest, or not a curator quest. | — |
| `QUEST_NOT_ACTIVE` | 409 | POST /quests/:id/cancel or /complete for a quest that is no longer active. | — |
| `QUEST_NOT_MANUAL` | 409 | POST /quests/:id/complete for a quest other than the manual `curator_task`. | — |
| `QUEST_NOT_YOURS` | 403 | POST /quests/:id/cancel by someone other than the assigner (admins may). | — |
| `PLAYBOOK_SETUP_LOCKED` | 409 | PUT /playbook/today/picks with a setup above the trader's tier (`params.name`); locks never block trading. Sent as 403 by every `/playbook/:id/*` route (and `POST /playbook-media`) when the setup is above the viewer's tier (`lib/playbookLock.ts`). | — |
| `GAMIFICATION_DISABLED` | 409 | PUT /gamification/title or a reward request while `gamification.enabled` is off. | — |
| `TITLE_NOT_EARNED` | 400 | PUT /gamification/title with a key the trader has not earned (GET /gamification/me lists `titles`). | — |
| `REWARD_ITEM_NOT_FOUND` | 404 | Rewards catalog item (PUT /gamification/rewards/items/:id, POST …/:id/request; inactive items cannot be requested). | — |
| `REWARD_ITEM_INVALID` | 400 | POST/PUT /gamification/rewards/items with an empty title, a bad stock or a condition that does not fit its kind. | `{ field }` param: title \| stock \| kind \| ref \| tier \| rank |
| `REWARD_NOT_ELIGIBLE` | 409 | POST /gamification/rewards/items/:id/request without an «eligible» grant of that item. | — |
| `REWARD_GRANT_NOT_FOUND` | 404 | POST /gamification/rewards/grants/:id/grant or /decline: no such grant. | — |
| `REWARD_GRANT_DECIDED` | 409 | Grant / decline of a grant that is already granted or declined. | — |
| `REWARD_OUT_OF_STOCK` | 409 | Grant of an item whose stock is 0. | — |
| `REWARD_NOT_YOUR_TRADER` | 403 | Grant / decline by a curator who is not the trader's assigned curator (admins may). | — |
| `THEME_NOT_FOUND` | 404 | PUT /api/themes/:id or /api/themes/mine/:id (another user's or no such theme) (themes are archived, never deleted). | — |
| `THEME_LIMIT` | 409 | POST /api/themes/mine (or a restore) over the 10 active personal themes per user. | `params.max` |
| `BOARD_NOT_FOUND` | 404 | /api/themes/boards/:id (or POST /api/themes/mine boardId): not the caller's board, archived, or the wrong kind. | — |
| `BOARD_LIMIT` | 409 | POST /api/themes/boards over the 8 active boards per user. | `params.max` |
| `BROKER_TRADE_READ_ONLY` | 403 | Broker-sourced trade (PropReports): a non-admin (no `settings.manage`) changed a broker-owned field (pnl, fees, qty, entry/exit, dates, result…), deleted it (single / bulk), added or removed its fills, or created a trade marked as broker-sourced. Review fields (setup, tags, grade, notes) stay editable. | `{ capability, fields? }` |
| `BUYING_POWER_RANGE` | 400 | PUT /api/risk/limits/:trader: `buyingPower` of a junior (the trader's stage, or `tier` in the body) outside 25 000 – 800 000 $. | `params.min`, `params.max` |
| `BUYING_POWER_MIN` | 400 | PUT /api/risk/limits/:trader: `buyingPower` below 25 000 $ (Трейдер / Сеньор: no upper cap). | `params.min` |
| `CURATOR_REQUEST_OPEN` | 409 | POST /api/curator-requests: the trader already has an open request of this kind (one open request per kind). | `details.id` |
| `CURATOR_REQUEST_NOT_FOUND` | 404 | PATCH /api/curator-requests/:id: no such request, or it belongs to a trader outside the curator's scope. | — |
| `CURATOR_REQUEST_CLOSED` | 409 | PATCH /api/curator-requests/:id on a request that is already done or dismissed. | — |
| `DESK_GROUP_NOT_FOUND` | 404 | PUT /api/desk-groups (group id that does not exist or is archived when a trader is moved into it). | — |
| `DESK_GROUP_NAME_TAKEN` | 409 | PUT /api/desk-groups: another active group has this name (case-insensitive). | `params.name` |
| `DESK_GROUP_CURATOR_INVALID` | 400 | PUT /api/desk-groups: `curatorId` is not an active curator / admin. | — |
| `SESSION_LOCKED` | 423 | The caller's session is screen-locked («Заблокировать», `lib/security/screenLock.ts`). Answered by the global gate (`lib/auth.ts` apiAuthGate) on every route except `POST /auth/unlock`, `POST\|GET /auth/lock`, `POST /auth/logout`, `GET /permissions/me` (and the public routes). The client shows its lock screen. | — |
| `UNLOCK_CODE_INVALID` | 403 | `POST /auth/unlock`: wrong quick code (or account password when no code is set). | `{ attemptsLeft }` |
| `UNLOCK_SIGNED_OUT` | 401 | `POST /auth/unlock`: the 5th wrong answer since the lock — this session is signed out (revoked). | — |
| `QUICK_CODE_INVALID` | 400 | `PUT /auth/quick-code`: not 4–8 digits and not a 6–32 character phrase. | — |
| `SECTION_BLOCKED` | 403 | The section is closed for the caller's ladder stage (desk setting `access.sections`, admin → «Роли и права» → «Доступ по ступеням»). Answered by one middleware (`lib/access/sections.ts`, table `SECTION_API`) on the section's data endpoints: top of the day, leaderboard, discussions, daily feed (not `/dailyfeed/stream`), desk-day, office stats, benchmark, trade ideas (+ stats), activity. Staff are never blocked. | `{ section, stage }` |
| `AI_NOT_CONFIGURED` | 503 | «Ассистент WS» (`/api/ai/assistant/*`): no `AI_INTEGRATIONS_ANTHROPIC_API_KEY` on the server (docs/AI_ASSISTANT.md). The panel shows how the admin enables it. The older AI helpers keep the lower-case `ai_not_configured`. | — |
| `AI_ASSISTANT_OFF` | 403 | The assistant is switched off (desk setting `assistant.enabled`). | — |
| `AI_ASSISTANT_STAGE` | 403 | The assistant is closed for juniors (desk setting `assistant.juniorsEnabled`). | — |
| `AI_BUDGET_EXCEEDED` | 429 | The caller's daily token budget of the default model is used up (desk setting `assistant.dailyTokensDefault`; the escalation model has its own budget and falls back to the default model when it runs out). | `{ model, used, limit }` |
| `JUNIOR_NOTES_RETIRED` | 410 | Any non-GET /api/junior-notes/*: the juniors' summary is read-only history now (the evening form in the journal replaced it). | — |

A status can differ from the default when an old handler used another one. The codemod kept every original status, so branch on `code` first and `status` second.

## Codes outside the registry (not translated through `errors` yet)

These are hand-written in route files, auth or the security module. They have stable codes, but their text is still a literal or comes from another namespace. The translation wave moves them into the registry.

| Code | Status | Where / when |
|---|---|---|
| `INVALID_CREDENTIALS` 401, `BANNED` 403, `GUEST_DISABLED` 403, `PASSWORD_CHANGE_REQUIRED` 403, `LOGIN_LOCKED` 429, `WEAK_PASSWORD` / `WRONG_PASSWORD` / `SAME_PASSWORD` 400 | see code | auth / `lib/security/respond.ts` (owned by the security agent). Some carry extra top-level fields (`retryAfterSec`, `policy`). |
| `FOLDER_EXISTS` | 409 | playbook folder rename |
| `JOURNAL_CONFLICT` | 409 | journal: edited in another tab (`current` attached) |
| `SYNC_RUNNING`, `SYNC_PENDING` | 409 | PropReports sync in progress or not yet run for the date |
| `UPSTREAM_UNAVAILABLE` | 503 | external data source down (`retryAfterSec`) |
| `DUPLICATE` | 409 | events: same ticker + date + type (`existingId`) |
| `MEMBERS_ONLY` | 403 | ownership (`NOT_OWNER`, `NOT_ENROLLED`, `OFFICE_ONLY`, `NO_OCCURRENCE` are in the registry) |
| `IDEA_CONVERT_RETIRED` | 410 | old idea→trade conversion endpoint |
| `EOD_INCOMPLETE` | 409 | end-of-day close |
| `ai_not_configured` | 503 | AI env missing (lower-case, legacy) |
| `RATE_LIMITED` | 429 | IP limiters in app.ts / `lib/security/http.ts` (same code as the registry) |
