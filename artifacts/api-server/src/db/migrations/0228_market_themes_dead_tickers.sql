-- Drop tickers that no longer quote (Finviz and Yahoo both return nothing): ZK (Zeekr, delisted), SATS, BITF.
-- Only removes them from the seeded shared themes; anything an admin added stays.
UPDATE market_themes SET tickers = array_remove(tickers, 'ZK'), updated_at = NOW() WHERE lower(name) = 'china ev' AND 'ZK' = ANY(tickers);
UPDATE market_themes SET tickers = array_remove(tickers, 'SATS'), updated_at = NOW() WHERE lower(name) = 'space' AND 'SATS' = ANY(tickers);
UPDATE market_themes SET tickers = array_remove(tickers, 'BITF'), updated_at = NOW() WHERE lower(name) = 'bitcoin miners' AND 'BITF' = ANY(tickers);
