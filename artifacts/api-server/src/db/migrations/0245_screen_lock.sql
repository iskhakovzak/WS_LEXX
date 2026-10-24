-- Screen lock «Заблокировать» (lib/security/screenLock.ts, routes/screen-lock.ts).
-- (1) users.quick_code_hash: the quick-unlock code («код быстрого входа», 4–8 digits or a short passphrase), bcrypt like
--     password_hash; NULL = not set (the lock then accepts the account password). quick_code_kind = 'digits' | 'phrase'
--     (the lock screen picks the keyboard by it; the code itself is never readable back).
-- (2) auth_session_locks: one row per locked session (JWT `sid`, lib/security/sessions sessionKey). While a row exists the
--     API answers 423 SESSION_LOCKED to that token on every route except unlock / lock / logout / permissions-me.
--     `failures` = wrong codes since the lock; the 5th signs the session out (auth_revoked_sessions) and drops the row.
--     A row past expires_at is inert (the token has expired by then).

ALTER TABLE users ADD COLUMN IF NOT EXISTS quick_code_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quick_code_kind text CHECK (quick_code_kind IN ('digits', 'phrase'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS quick_code_set_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_session_locks (
  sid text PRIMARY KEY CHECK (char_length(sid) BETWEEN 1 AND 64),
  user_id integer NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  failures integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_session_locks_user_idx ON auth_session_locks (user_id);
