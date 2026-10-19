-- 2025 market calendar (holiday_calendar), same shape as the 2026 / 2027 seeds (0016 / 0017), so the trader
-- analysis that spans 2025 (/events «Как я торгую») sees 2025 macro days instead of counting them as ordinary days.
--   • NYSE holidays 2025: Jan 1, Jan 9 (National Day of Mourning for President Carter), Jan 20, Feb 17, Apr 18
--     (Good Friday), May 26, Jun 19, Jul 4, Sep 1, Nov 27, Dec 25; early close 1:00 pm ET on Jul 3, Nov 28, Dec 24.
--   • FOMC 2025: Jan 28-29, Mar 18-19*, May 6-7, Jun 17-18*, Jul 29-30, Sep 16-17*, Oct 28-29, Dec 9-10*
--     (* = Summary of Economic Projections).
--   • CPI / PPI / Employment Situation (NFP), 8:30 am ET, as actually released. The Oct 1 - Nov 12 2025 federal
--     shutdown moved them: September CPI came out Oct 24, October CPI was never published, November CPI Dec 18;
--     September PPI Nov 25; September NFP Nov 20, October + November NFP together Dec 16.
--   • OPEX = third Friday (quarterly = quad witching); Apr 18 2025 was Good Friday, so April expired Thu Apr 17.
--   • Month-end = last NYSE business day of the month.
-- Also fixes 2026-07-03: July 4 2026 is a Saturday, so NYSE is CLOSED on Fri Jul 3 (0016 stored it as an early close).
-- Updated in place (no delete). ON CONFLICT keeps the inserts idempotent; a later correction is a new migration.
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO holiday_calendar (date, type, name, description, importance) VALUES
    ('2025-01-01', 'holiday', 'New Year''s Day', 'Market closed', 'high'),
    ('2025-01-09', 'holiday', 'National Day of Mourning (President Carter)', 'Market closed', 'high'),
    ('2025-01-20', 'holiday', 'MLK Day', 'Market closed', 'high'),
    ('2025-02-17', 'holiday', 'Presidents Day', 'Market closed', 'high'),
    ('2025-04-18', 'holiday', 'Good Friday', 'Market closed', 'high'),
    ('2025-05-26', 'holiday', 'Memorial Day', 'Market closed', 'high'),
    ('2025-06-19', 'holiday', 'Juneteenth', 'Market closed', 'high'),
    ('2025-07-03', 'holiday', 'Day before Independence Day', 'Early close 1pm ET', 'high'),
    ('2025-07-04', 'holiday', 'Independence Day', 'Market closed', 'high'),
    ('2025-09-01', 'holiday', 'Labor Day', 'Market closed', 'high'),
    ('2025-11-27', 'holiday', 'Thanksgiving', 'Market closed', 'high'),
    ('2025-11-28', 'holiday', 'Day after Thanksgiving', 'Early close 1pm ET', 'high'),
    ('2025-12-24', 'holiday', 'Christmas Eve', 'Early close 1pm ET', 'high'),
    ('2025-12-25', 'holiday', 'Christmas Day', 'Market closed', 'high'),
    ('2025-01-28', 'fomc', 'FOMC Meeting', 'FOMC begins', 'medium'),
    ('2025-01-29', 'fomc', 'FOMC Meeting (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-03-18', 'fomc', 'FOMC Meeting + SEP', 'FOMC begins', 'medium'),
    ('2025-03-19', 'fomc', 'FOMC Meeting + SEP (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-05-06', 'fomc', 'FOMC Meeting', 'FOMC begins', 'medium'),
    ('2025-05-07', 'fomc', 'FOMC Meeting (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-06-17', 'fomc', 'FOMC Meeting + SEP', 'FOMC begins', 'medium'),
    ('2025-06-18', 'fomc', 'FOMC Meeting + SEP (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-07-29', 'fomc', 'FOMC Meeting', 'FOMC begins', 'medium'),
    ('2025-07-30', 'fomc', 'FOMC Meeting (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-09-16', 'fomc', 'FOMC Meeting + SEP', 'FOMC begins', 'medium'),
    ('2025-09-17', 'fomc', 'FOMC Meeting + SEP (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-10-28', 'fomc', 'FOMC Meeting', 'FOMC begins', 'medium'),
    ('2025-10-29', 'fomc', 'FOMC Meeting (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-12-09', 'fomc', 'FOMC Meeting + SEP', 'FOMC begins', 'medium'),
    ('2025-12-10', 'fomc', 'FOMC Meeting + SEP (Decision Day)', 'Statement 2pm ET, Powell presser 2:30pm ET', 'high'),
    ('2025-01-15', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-02-12', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-03-12', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-04-10', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-05-13', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-06-11', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-07-15', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-08-12', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-09-11', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-10-24', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-12-18', 'cpi', 'CPI Release', '8:30am ET — Consumer Price Index', 'high'),
    ('2025-01-14', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-02-13', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-03-13', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-04-11', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-05-15', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-06-12', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-07-16', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-08-14', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-09-10', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-11-25', 'ppi', 'PPI Release', '8:30am ET — Producer Price Index', 'medium'),
    ('2025-01-10', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-02-07', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-03-07', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-04-04', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-05-02', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-06-06', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-07-03', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-08-01', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-09-05', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-11-20', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-12-16', 'nfp', 'NFP Jobs Report', '8:30am ET — Non-Farm Payrolls', 'high'),
    ('2025-01-17', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-02-21', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-03-21', 'quad_witching', 'Quadruple Witching', 'Index futures, index options, stock futures, stock options all expire', 'high'),
    ('2025-04-17', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-05-16', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-06-20', 'quad_witching', 'Quadruple Witching', 'Index futures, index options, stock futures, stock options all expire', 'high'),
    ('2025-07-18', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-08-15', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-09-19', 'quad_witching', 'Quadruple Witching', 'Index futures, index options, stock futures, stock options all expire', 'high'),
    ('2025-10-17', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-11-21', 'opex', 'Monthly OPEX', 'Monthly options expiration — elevated volume into close', 'medium'),
    ('2025-12-19', 'quad_witching', 'Quadruple Witching', 'Index futures, index options, stock futures, stock options all expire', 'high'),
    ('2025-01-31', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-02-28', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-03-31', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-04-30', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-05-30', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-06-30', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-07-31', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-08-29', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-09-30', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-10-31', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-11-28', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low'),
    ('2025-12-31', 'month_end', 'Month-End Rebalance', 'Institutional rebalancing flows', 'low')
  ON CONFLICT (date, type, name) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'holiday_calendar 2025: % rows inserted (86 in the seed)', n;

  UPDATE holiday_calendar SET description = 'Market closed'
   WHERE date = '2026-07-03' AND type = 'holiday' AND name = 'Independence Day (observed)' AND description <> 'Market closed';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'holiday_calendar 2026-07-03 -> full close: % row(s) updated', n;
END $$;
