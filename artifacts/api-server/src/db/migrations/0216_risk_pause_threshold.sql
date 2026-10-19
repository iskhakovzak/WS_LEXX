-- Risk data fixes from the persona walkthrough (2026-10-19, TRIAGE area RISK). Nothing is deleted.
--
-- 1. MAKSIM-01. The seeded «пауза после убытка» rules stored {"minutes": N}, but the catalog field is `min` (default 10),
--    so the engine checked a 10-minute pause and wrote every 5–10 minute gap as a violation (1 088 for one trader).
--    The threshold key is renamed (lib/rulesCatalog thresholdRaw still reads a leftover `minutes`). Violations whose gap
--    meets the rule's real pause are archived as `stale`; the ones that stay get the real pause in their text.
-- 2. DENIS-06. A «Разбор нарушения» notification opens the trader's breach row: /risk?tab=breaches&alert=<id>.
-- 3. UMID-21. Four early «Тир «Стажёр»: лимиты обновлены» notices were stored as RU text only (params NULL, raw tier key
--    in the text). They get the params the renderer needs (variant template, tier key, the tier's limits), so every
--    reader sees them in their own language. Only notices whose text says the tier and every limit were empty before.
DO $$
DECLARE n integer := 0;
BEGIN
  UPDATE trading_rules
     SET threshold = (threshold - 'minutes') || jsonb_build_object('min', threshold -> 'minutes')
   WHERE kind = 'min_pause_after_loss' AND threshold ? 'minutes' AND NOT threshold ? 'min';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'pause rules: threshold minutes -> min: % rows', n;

  UPDATE rule_violations v
     SET archived_at = now(), archived_reason = 'stale'
    FROM trading_rules r
   WHERE r.id = v.rule_id AND r.kind = 'min_pause_after_loss' AND v.archived_at IS NULL
     AND v.details ? 'gapMin'
     AND (v.details ->> 'gapMin')::numeric >= COALESCE((r.threshold ->> 'min')::numeric, 10);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'pause violations archived as stale: % rows', n;

  UPDATE rule_violations v
     SET details = jsonb_set(jsonb_set(v.details, '{limitMin}', to_jsonb(m.pause)), '{msg,params,min}', to_jsonb(m.pause)),
         message = regexp_replace(v.message, '\(пауза \d+ мин\)', '(пауза ' || m.pause || ' мин)')
    FROM (SELECT id, COALESCE((threshold ->> 'min')::numeric, 10) AS pause FROM trading_rules WHERE kind = 'min_pause_after_loss') m
   WHERE m.id = v.rule_id AND v.archived_at IS NULL AND v.details ? 'limitMin'
     AND (v.details ->> 'limitMin')::numeric <> m.pause;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'pause violations re-labelled: % rows', n;

  UPDATE notifications
     SET link = '/risk?tab=breaches&alert=' || entity_id
   WHERE type = 'risk_breach_review' AND entity_type = 'risk_breach' AND entity_id ~ '^[0-9]+$'
     AND COALESCE(link, '') NOT LIKE '/risk?tab=breaches%';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'breach review notification links: % rows', n;

  IF to_regclass('public.scaling_tiers') IS NOT NULL THEN
    UPDATE notifications n2
       SET params = jsonb_strip_nulls(jsonb_build_object(
             'variant', 'template', 'actor', n2.actor, 'tier', t.name, 'tierKey', t.key, 'resync', 0,
             'a_dailyLossLimit', t.daily_loss_limit::float8, 'a_weeklyLossLimit', t.weekly_loss_limit::float8,
             'a_maxDrawdown', t.max_drawdown::float8, 'a_maxRiskPerTrade', t.max_risk_per_trade::float8,
             'a_maxPositionUsd', t.max_position_usd::float8, 'a_maxOpenPositions', t.max_open_positions, 'a_tier', t.key))
      FROM scaling_tiers t
     WHERE n2.type = 'limit_change' AND n2.params IS NULL AND n2.actor IS NOT NULL
       AND n2.message !~ '\$[0-9,.]+ →'
       AND t.key = substring(n2.message FROM 'тир нет → ([a-z0-9_-]+)$');
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RAISE NOTICE 'legacy tier template notices given params: % rows', n;
END $$;
