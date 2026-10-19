-- Rewards: a stale «eligible» grant is revoked instead of offered (persona walkthrough 2026-10-18: ILYA-17, DENIS-05,
-- MAKSIM-05, OLGA-16). From now on lib/gamification/rewardsService revokes an open eligibility when its item is
-- deactivated or the trader no longer meets the (edited) condition; a revoked row becomes «eligible» again (and is
-- notified again) only when the trader qualifies later. This file adds the status and cleans the rows already stored:
--   • eligible grants of an inactive item;
--   • eligible grants of a mastery / achievement / season_rank item whose condition the stored data no longer meets
--     (setup_mastery, trader_achievements, gamification_seasons); level items are re-checked on the next read.
-- The trader's «Доступна награда» notification of a revoked grant and the staff «просит награду» notification of an
-- already decided grant are marked read. Nothing is deleted.
ALTER TABLE reward_grants DROP CONSTRAINT IF EXISTS reward_grants_status_check;
ALTER TABLE reward_grants ADD CONSTRAINT reward_grants_status_check
  CHECK (status IN ('eligible', 'requested', 'granted', 'declined', 'revoked'));

DO $$
DECLARE n integer; m integer;
BEGIN
  UPDATE reward_grants g
     SET status = 'revoked', decided_at = now(), note = 'stale', updated_at = now()
    FROM reward_items i
   WHERE i.id = g.item_id AND g.status = 'eligible'
     AND (
       NOT i.active
       OR (i.condition_kind = 'mastery' AND NOT EXISTS (
             SELECT 1 FROM setup_mastery sm LEFT JOIN playbook p ON p.id = sm.setup_id
              WHERE sm.trader = g.trader
                AND sm.level >= GREATEST(1, LEAST(4, COALESCE(NULLIF(i.condition_tier, '')::int, 4)))
                AND (i.condition_ref = '' OR sm.setup_id::text = i.condition_ref
                     OR substring(COALESCE(p.name, '') FROM '^\s*(\d{1,2}\.\d{1,2})(?=\s|$)') = i.condition_ref)))
       OR (i.condition_kind = 'achievement' AND NOT EXISTS (
             SELECT 1 FROM trader_achievements a
              WHERE a.trader = g.trader AND a.line = i.condition_ref
                AND COALESCE(array_position(ARRAY['bronze', 'silver', 'gold', 'platinum'], a.tier), 0)
                    >= COALESCE(array_position(ARRAY['bronze', 'silver', 'gold', 'platinum'], i.condition_tier), 1)))
       OR (i.condition_kind = 'season_rank' AND NOT EXISTS (
             SELECT 1 FROM gamification_seasons s, jsonb_array_elements(s.ranking) r
              WHERE s.season = g.ref AND r ->> 'trader' = g.trader
                AND (r ->> 'rank')::int BETWEEN 1 AND COALESCE(i.condition_rank, 0)))
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'reward_grants: % stale eligible grants revoked', n;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    UPDATE notifications nt SET is_read = true, read_at = COALESCE(nt.read_at, now())
      FROM reward_grants g
     WHERE nt.is_read = false AND nt.entity_type = 'reward_grant' AND nt.entity_id = g.id::text
       AND ((nt.type = 'reward_eligible' AND g.status = 'revoked')
         OR (nt.type = 'reward_requested' AND g.status IN ('granted', 'declined')));
    GET DIAGNOSTICS m = ROW_COUNT;
    RAISE NOTICE 'notifications: % reward notifications of revoked / decided grants marked read', m;
  END IF;
END $$;
