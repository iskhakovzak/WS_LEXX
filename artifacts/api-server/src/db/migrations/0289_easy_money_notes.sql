-- «Лёгкие деньги дня» (lib/deskPulse/easyStore.ts, routes/easy-money.ts): the moves themselves are never stored — they
-- are read from the candle archive and PropReports trades every time. What a senior or a curator writes about a move
-- of the day is a note in their OWN plan (plans are where manual input belongs): one note per author, day and ticker.
CREATE TABLE IF NOT EXISTS easy_money_notes (
  author     text        NOT NULL CHECK (char_length(author) BETWEEN 1 AND 200),
  day        text        NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  ticker     text        NOT NULL CHECK (ticker ~ '^[A-Z0-9][-A-Z0-9.]{0,11}$'),
  note       text        NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (author, day, ticker)
);
CREATE INDEX IF NOT EXISTS easy_money_notes_day_idx ON easy_money_notes (day);
