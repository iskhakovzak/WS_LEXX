-- Волна 1 п. 1.21 (owner decision 7, 2026-10-20): «Стажёр» leaves the ladder — Джун → Трейдер → Сеньор, the entry
-- stage is Джун (lib/promotionEngine STAGE_KEYS, lib/people/stage DEFAULT_STAGE). Every stored «trainee» moves to
-- junior; nothing is deleted:
--   academy_trader_stage.stage, academy_enrollments.stage, academy_programs.stage, trader_risk_limits.tier → 'junior'
--   academy_stage_criteria from_stage 'trainee' → archived (the ladder has no step «Стажёр → Джун» any more)
--   academy_promotion_requests pending 'trainee' → 'junior' → withdrawn (the trader already is a junior)
--   scaling_tiers 'trainee' → active = false (no longer a limit template); the academy_stages row stays, unread
--   academy_enrollments.stage default 'trainee' → 'junior'
-- Buying power per trader (junior 25 000 – 800 000 $, above junior no cap — checked by PUT /api/risk/limits):
--   trader_risk_limits.buying_power numeric, NULL = not set yet.
-- Academy / scaling tables are created by their routes on first use, so each step checks that its table exists.

ALTER TABLE trader_risk_limits ADD COLUMN IF NOT EXISTS buying_power numeric CHECK (buying_power IS NULL OR buying_power >= 0);

DO $$
DECLARE n integer;
BEGIN
  UPDATE trader_risk_limits SET tier = 'junior', updated_at = now() WHERE tier = 'trainee';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'trader_risk_limits trainee → junior: % rows', n;

  IF to_regclass('public.academy_trader_stage') IS NOT NULL THEN
    UPDATE academy_trader_stage SET stage = 'junior', updated_by = COALESCE(updated_by, 'system'), updated_at = now() WHERE stage = 'trainee';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_trader_stage trainee → junior: % rows', n;
  END IF;

  IF to_regclass('public.academy_enrollments') IS NOT NULL THEN
    UPDATE academy_enrollments SET stage = 'junior' WHERE stage = 'trainee';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_enrollments trainee → junior: % rows', n;
    ALTER TABLE academy_enrollments ALTER COLUMN stage SET DEFAULT 'junior';
  END IF;

  IF to_regclass('public.academy_programs') IS NOT NULL THEN
    UPDATE academy_programs SET stage = 'junior' WHERE stage = 'trainee';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_programs trainee → junior: % rows', n;
  END IF;

  IF to_regclass('public.academy_stage_criteria') IS NOT NULL THEN
    UPDATE academy_stage_criteria SET archived_at = now(), updated_by = 'system', updated_at = now()
     WHERE from_stage = 'trainee' AND archived_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_stage_criteria trainee archived: % rows', n;
  END IF;

  IF to_regclass('public.academy_promotion_requests') IS NOT NULL THEN
    UPDATE academy_promotion_requests SET status = 'withdrawn', decided_by = 'system', decided_at = now()
     WHERE status = 'pending' AND from_stage = 'trainee';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_promotion_requests trainee pending withdrawn: % rows', n;
  END IF;

  IF to_regclass('public.scaling_tiers') IS NOT NULL THEN
    UPDATE scaling_tiers SET active = false, updated_at = now() WHERE key = 'trainee' AND active;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'scaling_tiers trainee deactivated: % rows', n;
  END IF;
END $$;
