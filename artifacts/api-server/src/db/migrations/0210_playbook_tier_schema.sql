-- Playbook «Сегодня» (owner 2026-10-18: morning-first playbook, tier locks, cheat-sheet pictures; lib/playbookToday/*).
--
--   min_tier    the lowest academy / scaling stage a setup is meant for: trainee | junior | trader | senior | lead.
--               Guidance only — a lock never blocks trading; it shows the unlock condition (a quest hook: graded-A
--               trades on the gateway setup, or reaching the tier). NULL = open for everyone. Curators / admins change
--               it in the setup editor (PATCH /api/playbook/:id { minTier }).
--   schema_key  the schematic picture of the cheat sheet (web component per key: orb, gap_go, vwap_hold, flag …);
--               NULL = no picture.
--
-- Defaults for the 16 office setups of the new playbook (0.1 … 5.2, rebuilt 2026-10-18), matched by the number at the
-- start of the name; only rows still unset are filled (a re-run or an edited value is left alone). Стажёр: 0.1, 1.3,
-- 1.5, 2.1, 2.2; Трейдер+: 3.3, 5.2; Джун: the rest.
ALTER TABLE playbook ADD COLUMN IF NOT EXISTS min_tier text;
ALTER TABLE playbook ADD COLUMN IF NOT EXISTS schema_key text;

UPDATE playbook p
   SET min_tier = COALESCE(p.min_tier, v.tier),
       schema_key = COALESCE(p.schema_key, v.schema)
  FROM (VALUES
    ('0.1', 'routine', 'trainee'),
    ('1.1', 'gap_go', 'junior'),
    ('1.2', 'opening_drive', 'junior'),
    ('1.3', 'orb', 'trainee'),
    ('1.4', 'red_to_green', 'junior'),
    ('1.5', 'first_pullback', 'trainee'),
    ('2.1', 'vwap_hold', 'trainee'),
    ('2.2', 'flag', 'trainee'),
    ('2.3', 'hod_break', 'junior'),
    ('3.1', 'vwap_fade', 'junior'),
    ('3.2', 'failed_breakout', 'junior'),
    ('3.3', 'parabolic', 'trader'),
    ('4.1', 'day2', 'junior'),
    ('4.2', 'gap_fill', 'junior'),
    ('5.1', 'power_hour', 'junior'),
    ('5.2', 'moc', 'trader')
  ) AS v(code, schema, tier)
 WHERE p.deleted_at IS NULL
   AND COALESCE(p.space, CASE WHEN p.trader IS NULL THEN 'office' ELSE 'personal' END) = 'office'
   AND split_part(p.name, ' ', 1) = v.code
   AND (p.min_tier IS NULL OR p.schema_key IS NULL);
