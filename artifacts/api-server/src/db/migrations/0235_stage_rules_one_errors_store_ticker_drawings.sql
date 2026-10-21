-- Волна 2, items 2.6, 2.8, 2.12 (cluster R, 2026-10-20). Idempotent, nothing is deleted.
--
-- 2.6 Rules by ladder level out of the box. Desk-wide rules (trading_rules.trader = '*') may now be tagged with a ladder
--     stage: `stage` = junior | trader | senior applies the rule only to traders on that stage (NULL = every trader, as
--     before). lib/rulesTemplates.ts resolves the trader's stage (lib/people/stage.ts) and lib/rulesEngine fetchRulesFor
--     filters by it; a rule counts violations from max(the rule's creation day, the day the stage was assigned). Curators
--     edit / disable these rows in /rules like any desk rule. `template_key` marks the seeded rows (one per key — a
--     template a curator deleted is never seeded again) and lets the API show the seeded name in the reader's language.
ALTER TABLE trading_rules ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE trading_rules ADD COLUMN IF NOT EXISTS template_key text;
CREATE UNIQUE INDEX IF NOT EXISTS trading_rules_template_key_uidx ON trading_rules (template_key) WHERE template_key IS NOT NULL;

-- Keep in sync with STAGE_RULE_TEMPLATES in lib/rulesTemplates.ts (a test compares them).
INSERT INTO trading_rules (trader, name, kind, threshold, enabled, origin, created_by, note, stage, template_key)
SELECT '*', v.name, v.kind, v.threshold::jsonb, true, 'office', 'system', NULL, v.stage, v.key
  FROM (VALUES
    ('junior.daily_stop',        'junior', 'max_daily_loss_usd',      '{}',               'Дневной стоп по лимиту риска'),
    ('junior.max_trades',        'junior', 'max_trades_per_day',      '{"n": 8}',         'Не больше 8 сделок в день'),
    ('junior.no_size_up',        'junior', 'no_size_up_after_loss',   '{"factor": 1.3}',  'Не увеличивать размер после убытка'),
    ('junior.stop_after_losses', 'junior', 'no_trade_after_n_losses', '{"n": 2}',         'После 2 убытков подряд — стоп на день'),
    ('junior.no_overnight',      'junior', 'no_overnight',            '{}',               'Без овернайта'),
    ('trader.daily_stop',        'trader', 'max_daily_loss_usd',      '{}',               'Дневной стоп по лимиту риска'),
    ('trader.max_trades',        'trader', 'max_trades_per_day',      '{"n": 15}',        'Не больше 15 сделок в день'),
    ('trader.no_size_up',        'trader', 'no_size_up_after_loss',   '{"factor": 1.5}',  'Не увеличивать размер после убытка'),
    ('trader.stop_after_losses', 'trader', 'no_trade_after_n_losses', '{"n": 3}',         'После 3 убытков подряд — стоп на день')
  ) AS v(key, stage, kind, threshold, name)
 WHERE NOT EXISTS (SELECT 1 FROM trading_rules r WHERE r.template_key = v.key);

-- 2.8 One errors store: trading_errors is the single source of mistakes. `code` = the vocabulary code (lib/tradingErrors.ts
--     ERROR_VOCAB; NULL = a custom mistake typed by hand), `source` = where the row was made: manual («Ошибки»), tag (key M
--     on /trades) or journal (per-trade review of the day). The M key and the journal now write rows here
--     (lib/tradingErrors.ts); the old tags / eod_trade_reviews.mistakes are backfilled below, one row per trade + code.
ALTER TABLE trading_errors ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE trading_errors ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS trading_errors_trade_code_idx ON trading_errors (trade_id, code);

-- Vocabulary: every stored spelling → code, canonical stored value, default severity. Keep in sync with ERROR_VOCAB in
-- lib/tradingErrors.ts (a test compares them). Matching is lower(x) = lower(spelling) on both sides, so it holds under
-- any database collation (lower() of Cyrillic is a no-op under the C locale — then the exact spelling still matches).
CREATE TEMP TABLE error_vocab_0235 (alias text PRIMARY KEY, code text NOT NULL, canonical text NOT NULL, severity text NOT NULL) ON COMMIT DROP;
INSERT INTO error_vocab_0235 (alias, code, canonical, severity) VALUES
  ('FOMO / погоня',            'fomo',          'FOMO / погоня',            'medium'),
  ('FOMO',                     'fomo',          'FOMO / погоня',            'medium'),
  ('Вход не по плану',         'offPlan',       'Вход не по плану',         'high'),
  ('Без плана',                'offPlan',       'Вход не по плану',         'high'),
  ('Ранний вход',              'earlyEntry',    'Ранний вход',              'medium'),
  ('Сдвинул стоп',             'movedStop',     'Сдвинул стоп',             'high'),
  ('Двигал стоп',              'movedStop',     'Сдвинул стоп',             'high'),
  ('Без стопа',                'noStop',        'Без стопа',                'critical'),
  ('Усреднение убытка',        'averagingDown', 'Усреднение убытка',        'critical'),
  ('Завышенный размер',        'oversize',      'Завышенный размер',        'high'),
  ('Большой размер',           'oversize',      'Завышенный размер',        'high'),
  ('Переторговка',             'overtrading',   'Переторговка',             'medium'),
  ('Овертрейдинг',             'overtrading',   'Переторговка',             'medium'),
  ('Отыгрыш после убытка',     'revenge',       'Отыгрыш после убытка',     'high'),
  ('Реванш',                   'revenge',       'Отыгрыш после убытка',     'high'),
  ('Ранний выход из прибыли',  'earlyExit',     'Ранний выход из прибыли',  'low'),
  ('Ранний выход',             'earlyExit',     'Ранний выход из прибыли',  'low'),
  ('Пересидел убыток',         'heldLoser',     'Пересидел убыток',         'high'),
  ('Проигнорировал новости',   'ignoredNews',   'Проигнорировал новости',   'medium'),
  ('Поздний выход',            'lateExit',      'Поздний выход',            'medium'),
  ('Не по сетапу',             'offSetup',      'Не по сетапу',             'medium');

-- Rows logged by hand get their code (custom text keeps NULL).
UPDATE trading_errors e SET code = v.code
  FROM error_vocab_0235 v
 WHERE e.code IS NULL AND lower(btrim(e.error_type)) = lower(v.alias);

DO $$
DECLARE n_tags integer; n_journal integer;
BEGIN
  -- Key M on /trades: mistake words in trades.tags → one row per trade + code.
  INSERT INTO trading_errors (trader, error_type, description, ticker, trade_id, severity, code, source, created_at)
  SELECT DISTINCT ON (t.id, v.code) t.trader, v.canonical, v.canonical, t.ticker, t.id, v.severity, v.code, 'tag', t.created_at
    FROM trades t
    CROSS JOIN LATERAL unnest(string_to_array(t.tags, ',')) AS tag(raw)
    JOIN error_vocab_0235 v ON lower(v.alias) = lower(btrim(tag.raw))
   WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND NULLIF(btrim(t.tags), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM trading_errors e WHERE e.trade_id = t.id AND e.code = v.code)
   ORDER BY t.id, v.code;
  GET DIAGNOSTICS n_tags = ROW_COUNT;

  -- Journal (per-trade review of the day): eod_trade_reviews.mistakes → one row per trade + code.
  INSERT INTO trading_errors (trader, error_type, description, ticker, trade_id, severity, code, source, created_at)
  SELECT DISTINCT ON (t.id, v.code) r.trader, v.canonical, v.canonical, t.ticker, t.id, v.severity, v.code, 'journal', r.updated_at
    FROM eod_trade_reviews r
    JOIN trades t ON t.id = r.trade_id AND t.deleted_at IS NULL
    CROSS JOIN LATERAL unnest(r.mistakes) AS m(raw)
    JOIN error_vocab_0235 v ON lower(v.alias) = lower(btrim(m.raw))
   WHERE NOT EXISTS (SELECT 1 FROM trading_errors e WHERE e.trade_id = t.id AND e.code = v.code)
   ORDER BY t.id, v.code;
  GET DIAGNOSTICS n_journal = ROW_COUNT;

  RAISE NOTICE '0235: trading_errors backfilled — % from trade tags, % from the journal review', n_tags, n_journal;
END $$;

-- 2.12 Drawings by ticker: a level drawn yesterday on AAPL is on today's AAPL chart too. The ticker-wide set of a user is
--      the row with day = '*' (lib/chartDrawings.ts); the per-day rows stay as they were (read by nobody, never deleted).
--      Backfill: every user's day rows of a ticker merged into one set (a drawing id once — its latest copy; at most 50,
--      the most recently saved first).
INSERT INTO chart_drawings (user_id, ticker, day, drawings, updated_at)
SELECT user_id, ticker, '*', jsonb_agg(item ORDER BY saved_at, ord), max(saved_at)
  FROM (
    SELECT u.*, row_number() OVER (PARTITION BY u.user_id, u.ticker ORDER BY u.saved_at DESC, u.ord) AS rk
      FROM (
        SELECT DISTINCT ON (d.user_id, d.ticker, e.item->>'id') d.user_id, d.ticker, e.item, e.ord, d.updated_at AS saved_at
          FROM chart_drawings d
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.drawings) = 'array' THEN d.drawings ELSE '[]'::jsonb END)
               WITH ORDINALITY AS e(item, ord)
         WHERE d.day <> '*'
         ORDER BY d.user_id, d.ticker, e.item->>'id', d.updated_at DESC
      ) u
  ) r
 WHERE rk <= 50
 GROUP BY user_id, ticker
ON CONFLICT (user_id, ticker, day) DO NOTHING;
