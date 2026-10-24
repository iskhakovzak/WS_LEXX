-- Roadmap R1 «readiness realism» (owner 2026-10-24: «не заменять, просто ещё добавить»): two more Джун → Трейдер
-- criteria NEXT TO win rate ≥ 48 (which stays as it is) — lib/promotionEngine DEFAULT_CRITERIA, lib/academy/readinessRealism:
--   edge_margin_pp ≥ 2   over 40 trading days  — win rate above the breakeven win rate of the trader's own payoff, pp
--   expectancy_lb  ≥ 0   over 120 trading days — 20th percentile of the per-trade net mean (day bootstrap, seeded)
-- A desk that has not seeded its criteria yet gets them from DEFAULT_CRITERIA on first use; a seeded desk gets the two rows
-- here (staff edit / disable them like the others). Labels are the Russian seed texts (academyPath.seedCriteria), so
-- readers in EN / UZ see them translated. Idempotent: a live row of the metric is never duplicated.

INSERT INTO academy_stage_criteria (from_stage, metric, op, value, window_days, label, enabled, sort_order, updated_by)
SELECT 'junior', 'edge_margin_pp', '>=', 2, 40, 'Запас над безубыточным винрейтом ≥ 2 п.п.', TRUE,
       COALESCE((SELECT MAX(sort_order) FROM academy_stage_criteria WHERE archived_at IS NULL), 0) + 1, 'system'
 WHERE EXISTS (SELECT 1 FROM academy_stage_criteria WHERE archived_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM academy_stage_criteria WHERE from_stage = 'junior' AND metric = 'edge_margin_pp' AND archived_at IS NULL);

INSERT INTO academy_stage_criteria (from_stage, metric, op, value, window_days, label, enabled, sort_order, updated_by)
SELECT 'junior', 'expectancy_lb', '>=', 0, 120, 'Нижняя граница ожидания ≥ $0 за 120 дней', TRUE,
       COALESCE((SELECT MAX(sort_order) FROM academy_stage_criteria WHERE archived_at IS NULL), 0) + 1, 'system'
 WHERE EXISTS (SELECT 1 FROM academy_stage_criteria WHERE archived_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM academy_stage_criteria WHERE from_stage = 'junior' AND metric = 'expectancy_lb' AND archived_at IS NULL);
