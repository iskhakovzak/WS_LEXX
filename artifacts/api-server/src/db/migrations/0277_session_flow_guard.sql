-- Session flow (lib/sessionFlow/*) and the leak guard's desk rule patterns (lib/leakGuard/rules.ts). 0277 is the next
-- free number on main (0276 = catalyst_marks_strategy_formula). Nothing here is typed in by a trader: re-entries,
-- the green-to-red cross, the opening window and the idea limits are all derived from PropReports fills.
--
-- leak_guard_events.pattern gains the four rule patterns:
--   reentry       the second re-entry in the same ticker and side → a soft stop on that ticker / side for the day
--   green_to_red  size or pace went up after the day crossed from green to red → a pause
--   open_window   the 09:30–10:00 loss reached the opening-window limit → no entries until 10:00
--   idea_limit    an authored / tier-3 idea of the plan hit its loss cap or was re-entered → stop that ticker
-- Ticker-scoped events keep { ticker, side } in stats (a document; never filtered in SQL).
ALTER TABLE leak_guard_events DROP CONSTRAINT IF EXISTS leak_guard_events_pattern_check;
ALTER TABLE leak_guard_events ADD CONSTRAINT leak_guard_events_pattern_check CHECK (pattern IN (
  'after_loss', 'first_trade', 'rule_violation', 'near_stop', 'reentry', 'green_to_red', 'open_window', 'idea_limit'
));
