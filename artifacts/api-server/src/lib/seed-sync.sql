DELETE FROM "comments";
DELETE FROM "trade_reactions";
DELETE FROM "trade_reviews";
DELETE FROM "activity_log";
DELETE FROM "trading_errors";
DELETE FROM "big7_levels";
DELETE FROM "trades";
DELETE FROM "market_events";
DELETE FROM "research";
DELETE FROM "daily_feed";
DELETE FROM "discussions";
DELETE FROM "watchlist";
DELETE FROM "playbook";

INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (92, 'SPIR', '2026-04-09', NULL, 'Long', 'other', '17.6000', '19.2000', '17.3000', 'win', NULL, '5.00', NULL, '6.00', '652 M ', '26.88 M', '1.80', 'regular', 'https://www.tradingview.com/x/EtvtGAhA/', '[""]', 'SPIR Pricing
Spire Global объявила о частном размещении (private placement) на $70 млн, продав 5,0 млн акций класса A по цене $14.00 за акцию.

Привлечённые средства будут направлены на:
оборотный капитал (working capital)
инициативы роста, включая:
космическую разведку (space reconnaissance)
решения в области погодных данных', 'Pricing > 14 ', NULL, 'Был хороший мув первые пол часа. Зашел по цене 17.60. Далее акция опустилась до уровня своего опена, ретестнула и пошла дальше вверх и вышел по 19.20
', 'Максат', 'Pricing, Offering', NULL, NULL, NULL, '2026-04-09T17:32:03.359Z', NULL);
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (91, 'INTC', '2026-04-09', NULL, 'Short', 'news', '60.5800', NULL, '61.1200', 'win', NULL, '2.00', NULL, NULL, '302B', '4.22B', NULL, 'regular', NULL, '[""]', NULL, NULL, NULL, NULL, 'Артур', 'Reddog, Reversal', NULL, NULL, NULL, '2026-04-09T17:30:49.639Z', NULL);
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (90, 'CRWV', '2026-04-09', NULL, 'Short', 'news', '91.7700', '87.3800', '93.0400', 'win', NULL, '4.00', '2часа', '5.00', '45,43B', '320.04M', '3.87', 'regular', 'https://www.tradingview.com/x/IQj1LJmB/
https://www.tradingview.com/x/W2EYFU7A/', '["",""]', 'Сначала вышло новость связанное что " Акции Meta и CoreWeave подскочили на фоне масштабной сделки по приобретению ИИ на сумму 21 миллиард долларов " на фоне этого акция выросла . Потом она объявила offering " Компания CoreWeave предлагает конвертируемые облигации на сумму 3 млрд долларов со сроком погашения в 2032 году " после этого цена начала падать.

РАССМАТРИВАЛ В ШОРТ ПОСМОТРЕЛ ФУНДОМЕНТАЛЬНО, КОМПАНИЯ В ДАННОЕ ВРЕМЯ УБЯТОЧНАЯ ДОЛГОВ МНОГО И ТЕХНИЧЕСКИ ГРАФИК У НЕЕ МЕДВЕЖЫЙ И НА ПРЕМАРКЕТЕ ОНА ВЕРНУЛА ПОЛОВИНУ РОСТА
', 'ИДЕЯ СРАБОТАЛА РАССМАТРИВАЛ ЕЕ НА ИНТРОДЭЙ ПОТОМУ ЧТО С ОТКРЫТИЕ ОНА МОГЛА СНАЧАЛА НА ВВЕРХ ПОЙТИ И ПОТОМ УЖЕ ВНИЗ. ЦЕНА ОТКРЫЛАСЬ НАЧАЛА РАСТИ И УЖЕ 09:41 МИНУТЕ НАЧАЛА ПАДАТЬ ПРОБИЛА СВОЙ ОПЕН И ПАДАЛА. ЧЕРЕЗ ВРЕМЯ ЦЕНА НАЧАЛА РАСТИ И ВЫШЛА НОВОСТЬ " ТРАМП ПОПРОСИЛ НЕТАНЯХУ НЕ БИТЬ ПО ЛИВАНУ ДЛЯ ПЕРЕГОВОРОВ " НА ФОНЕ ЭТОЙ НОВОСТИ РЫНОК НАЧАЛ РАСТИ И АКЦИЯ ТОЖЕ НАЧАЛА РАСТИ ПРОБИЛА СВОЙ ОПЕН СДЕЛАЛА HIGHER HIGH ', NULL, NULL, 'Умид', 'Gap Up, Offering, Yesterday Low, Yesterday Close, SMA50, Open Price', NULL, NULL, NULL, '2026-04-09T17:22:55.138Z', NULL);
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (89, 'SPIR', '2026-04-09', NULL, 'Long', 'other', '18.2400', '17.8800', '17.8800', 'loss', NULL, '2.00', '47m', NULL, '632m', '27m', NULL, 'regular', 'https://www.tradingview.com/x/fifjfsd1/', '[""]', 'Прайсинг по 14$, акция еще на премаркете торговалась выше цены прайсинга. Входил в сделку на дей выше опена со стопом за лоу дня. Добирался по 18,18, стоп поставил по 17,88 - выбило ', 'Акция отработала по стратегии торговли прайсингов.', NULL, 'Добрал объем по плохим ценам, стоп выставил на весь объем (желательно выставлять короткий стоп хотябы на набранную часть). ', 'Артур', 'Pricing', NULL, NULL, NULL, '2026-04-09T17:21:34.198Z', NULL);
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (88, 'AEHR', '2026-04-08', NULL, 'Long', 'earnings', '57.9000', '62.7100', '57.7500', 'win', NULL, '2.00', '5m', '0.50', '2B', '28.5', '5.50', 'regular', 'https://www.tradingview.com/x/tAr6QuJQ/
https://www.tradingview.com/x/rFpi5qSy/', '["",""]', 'с открытия упала и импульсом вернула этой же свечей зашел после пробитиия опена сто пза лоу дня вышел на нее UPG PT 68 ', NULL, NULL, 'можно было еще дозаработать ', 'Рахматулло', 'Earnings Gap Up, Gap Up, Breakout, Earnings, All Time High, Market Weak', NULL, NULL, 16, '2026-04-09T16:08:02.759Z', NULL);
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (87, 'PLTR', '2026-04-09', NULL, 'Short', 'other', '140.4000', '135.4000', '140.4000', 'win', NULL, '4.00', '4m', '0.30', '312B', '2.19B', '2.75', 'premarket', 'https://www.tradingview.com/x/0BVXZ0qL/', '["PLTR"]', '2 day short, пробил локальную недельную поддержку, под вчерашнем закрытием рядом с лоем вчерашнего дня, буду брать опг to day', 'Перед открытием уже началось падение.
Стопы не выбивало, Идеальная твх за 30-15 мин перед открытием, не реагировала на рынок', NULL, 'Можно было закладывать больший риск, и покрывать частями и ждать, так же в процессе давала шансы добрать
', 'Закир', 'Gap Down, Breakout, Liquidity Sweep, Sector Move, Yesterday Low, Yesterday Close, Open Price, Daily Support, Market Weak, High Volatility', NULL, NULL, NULL, '2026-04-09T15:12:00.468Z', NULL);
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (80, 'AVGO', '2026-03-24', 'Earnings Drift', 'Long', 'earnings', '148.2000', '152.0000', '146.0000', 'win', '380.00', '1.73', '240min', '0.12', 'Mega Cap', 'High', '1.60', 'regular', NULL, NULL, 'Post-earnings drift continuation', 'Bought the pullback after gap', 'Exited before close', 'Earnings drift is real on quality names', 'Тимур', 'earnings, drift', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:40:29.658Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (79, 'SMCI', '2026-03-25', 'Parabolic Short', 'Short', 'momentum', '890.0000', '865.0000', '910.0000', 'win', '2500.00', '1.25', '45min', '1.50', 'Large Cap', 'Low', '4.20', 'regular', NULL, NULL, 'Parabolic move into resistance, shorted the crack', 'Waited for the turn confirmation', 'High slippage on entry', 'Parabolic shorts need patience', 'Максат', 'parabolic, short', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:39:59.008Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (78, 'SPY', '2026-03-26', 'Gap Fill Long', 'Long', 'macro', '512.3000', '514.8000', '511.0000', 'win', '250.00', '1.92', '60min', '0.05', 'Index', 'High', '1.10', 'regular', NULL, NULL, 'Gap fill setup on SPY after overnight weakness', 'Patient fill level entry', 'Small size', 'Gap fills on indices are high probability', 'Умид', 'gap-fill, index', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:39:48.592Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (77, 'RIOT', '2026-03-27', 'Breakout Failure', 'Short', 'momentum', '17.8000', '18.5000', '18.2000', 'loss', '-350.00', '-1.75', '15min', '0.10', 'Small Cap', 'Low', '3.50', 'regular', NULL, NULL, 'Tried to short failed breakout but it reclaimed', 'Spotted the pattern', 'BTC spike caused squeeze', 'Dont short crypto names against BTC trend', 'Рахматулло', 'breakout-fail, crypto', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:39:38.678Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (76, 'COIN', '2026-03-28', 'Second Day Play', 'Long', 'momentum', '132.4000', '138.9000', '130.0000', 'win', '650.00', '2.71', '180min', '0.15', 'Large Cap', 'Medium', '2.50', 'regular', NULL, NULL, 'Follow through from day 1 runner', 'Waited for pullback entry', 'Nothing major', 'Second day plays can be powerful', 'Артур', 'second-day, runner', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:39:25.178Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (75, 'META', '2026-03-29', 'Earnings Gap Down Short', 'Short', 'earnings', '520.0000', '512.5000', '525.0000', 'win', '750.00', '1.50', '20min', '0.25', 'Mega Cap', 'High', '2.10', 'premarket', NULL, NULL, 'Weak guidance drove gap down', 'Short into first bounce', 'Covered too early', 'Earnings gaps down are reliable shorts', 'Антон', 'earnings, gap-down, short', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:39:12.266Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (85, 'NFLX', '2026-03-19', 'VWAP Rejection Short', 'Short', 'momentum', '625.0000', '619.5000', '628.0000', 'win', '550.00', '1.83', '50min', '0.30', 'Mega Cap', 'High', '1.70', 'regular', NULL, NULL, 'Failed VWAP reclaim led to sharp selloff', 'Shorted the rejection candle', 'Could have held for full move', 'VWAP rejections are strong short signals', 'Умид', 'vwap, short', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:09:30.176Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (67, 'NVDA', '2026-04-06', 'Earnings Gap and Go', 'Long', 'earnings', '142.5000', '145.2000', '140.0000', 'win', '270.00', '2.70', '45min', '0.10', 'Mega Cap', 'High', '1.20', 'premarket', NULL, NULL, 'Strong momentum after earnings beat', 'Entry near support, managed risk', 'Took profit too early', 'Good risk management', 'Закир', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:03:55.222Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (68, 'TSLA', '2026-04-05', 'VWAP Reclaim', 'Long', 'momentum', '180.3000', '182.8000', '178.5000', 'win', '250.00', '2.50', '90min', '0.15', 'Mega Cap', 'Medium', '1.80', 'regular', NULL, NULL, 'VWAP bounce played well', 'Patient entry at VWAP', 'Exited on breakeven', 'Smooth trade', 'Антон', 'vwap, momentum', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:38:23.988Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (74, 'AAPL', '2026-03-30', 'Opening Range Breakout', 'Long', 'momentum', '178.5000', '181.2000', '177.0000', 'win', '270.00', '1.80', '35min', '0.08', 'Mega Cap', 'High', '1.40', 'regular', NULL, NULL, 'Clean breakout above opening range', 'Waited for confirmation', 'Could have held longer', 'ORB works on mega caps', 'Закир', 'orb, breakout', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:39:01.844Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (73, 'XLF', '2026-03-31', 'Trading Low RVOL Set', 'Long', 'macro', '42.2000', '42.9500', '41.5000', 'win', '75.00', '1.50', '120min', '0.10', 'Sector', 'Low', '0.60', 'regular', NULL, NULL, 'Low volume but clean setup', 'Patient on low volume', 'Limited liquidity', 'Good discipline', 'Тимур', 'low-rvol, macro', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:38:55.184Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (72, 'PLTR', '2026-04-01', 'Chasing Entry', 'Long', 'momentum', '32.1000', '31.0000', '33.5000', 'loss', '-140.00', '-1.40', '25min', '0.30', 'Large Cap', 'Low', '0.80', 'regular', NULL, NULL, 'Chased after momentum', 'Recognized mistake quickly', 'Over-aggressive entry', 'Avoid chasing', 'Максат', 'chase, mistake', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:38:48.427Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (71, 'SOFI', '2026-04-02', 'Scalping', 'Long', 'momentum', '7.8500', '7.9200', '7.8000', 'win', '70.00', '2.33', '5min', '0.05', 'Micro Cap', 'High', '3.00', 'regular', NULL, NULL, 'Quick scalp on support bounce', 'Fast entries and exits', 'Size too small', 'Need more size', 'Умид', 'scalp, quick', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:38:42.553Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (69, 'AMD', '2026-04-04', 'Intraday Fade', 'Short', 'momentum', '145.5000', '143.2000', '147.0000', 'win', '230.00', '2.30', '60min', '0.20', 'Large Cap', 'Medium', '1.50', 'regular', NULL, NULL, 'Sold into strength', 'Recognized overbought', 'Chased exit', 'Nice fade trade', 'Артур', 'fade, short', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:38:29.978Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (70, 'MSTR', '2026-04-03', 'HOD Failure', 'Short', 'momentum', '385.0000', '381.5000', '388.0000', 'loss', '-250.00', '-2.50', '30min', '0.50', 'Small Cap', 'Medium', '2.20', 'regular', NULL, NULL, 'HOD rejection setup', 'Good setup identification', 'Slippage on exit', 'Learn from slippage', 'Рахматулло', 'hod-failure, short', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:38:35.569Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (86, 'GME', '2026-03-18', 'Low Float Runner', 'Long', 'short_squeeze', '28.5000', '24.0000', '26.0000', 'loss', '-450.00', '-1.80', '10min', '0.50', 'Mid Cap', 'Low', '5.00', 'regular', NULL, NULL, 'Tried to catch squeeze but halted and dumped', 'Spotted the setup early', 'Halt risk not managed', 'Low float runners carry halt risk', 'Максат', 'squeeze, halt-risk', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:41:48.536Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (84, 'DIS', '2026-03-20', 'Earnings Gap and Go', 'Long', 'earnings', '118.4000', '121.0000', '117.0000', 'win', '260.00', '1.86', '30min', '0.10', 'Large Cap', 'High', '2.20', 'premarket', NULL, NULL, 'Strong earnings beat with Disney+ subscriber growth', 'Pre-market entry, held through open', 'Took partial too soon', 'Earnings gap and go reliable on large caps', 'Рахматулло', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:41:39.822Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (83, 'ROKU', '2026-03-21', 'Intraday Momentum', 'Long', 'momentum', '72.3000', '75.8000', '71.0000', 'win', '350.00', '2.69', '90min', '0.08', 'Mid Cap', 'Medium', '2.80', 'regular', NULL, NULL, 'Strong intraday momentum with sector rotation', 'Added on pullback, good R:R', 'Initial entry was late', 'Momentum with sector support is powerful', 'Артур', 'momentum, sector', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:41:04.256Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (82, 'BABA', '2026-03-22', 'Reversal Long', 'Long', 'news', '88.5000', '85.2000', '86.0000', 'loss', '-330.00', '-1.32', '40min', '0.20', 'Large Cap', 'High', '2.00', 'regular', NULL, NULL, 'Tried reversal on China news but follow through failed', 'Good level identification', 'News flow turned negative', 'Avoid reversal trades on ongoing news', 'Антон', 'reversal, china', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:40:49.538Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (81, 'MSFT', '2026-03-23', 'Range Breakout', 'Long', 'momentum', '415.0000', '418.5000', '413.0000', 'win', '350.00', '1.75', '55min', '0.10', 'Mega Cap', 'High', '1.30', 'regular', NULL, NULL, 'Multi-day range breakout with volume', 'Clean level, good volume', 'Should have added on confirmation', 'Range breakouts on mega caps are clean', 'Закир', 'range, breakout', NULL, NULL, NULL, '2026-04-09T10:30:06.523Z', '2026-04-09T11:40:39.673Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (55, 'META', '2026-03-29', 'Earnings Gap Down Short', 'Short', 'earnings', '520.0000', '512.5000', '525.0000', 'win', '750.00', '1.50', '20min', '0.25', 'Mega Cap', 'High', '2.10', 'premarket', NULL, NULL, 'Weak guidance drove gap down', 'Short into first bounce', 'Covered too early', 'Earnings gaps down are reliable shorts', 'Антон', 'earnings, gap-down, short', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:39:14.297Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (66, 'GME', '2026-03-18', 'Low Float Runner', 'Long', 'short_squeeze', '28.5000', '24.0000', '26.0000', 'loss', '-450.00', '-1.80', '10min', '0.50', 'Mid Cap', 'Low', '5.00', 'regular', NULL, NULL, 'Tried to catch squeeze but halted and dumped', 'Spotted the setup early', 'Halt risk not managed', 'Low float runners carry halt risk', 'Максат', 'squeeze, halt-risk', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:08:53.358Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (65, 'NFLX', '2026-03-19', 'VWAP Rejection Short', 'Short', 'momentum', '625.0000', '619.5000', '628.0000', 'win', '550.00', '1.83', '50min', '0.30', 'Mega Cap', 'High', '1.70', 'regular', NULL, NULL, 'Failed VWAP reclaim led to sharp selloff', 'Shorted the rejection candle', 'Could have held for full move', 'VWAP rejections are strong short signals', 'Умид', 'vwap, short', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:09:36.188Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (54, 'AAPL', '2026-03-30', 'Opening Range Breakout', 'Long', 'momentum', '178.5000', '181.2000', '177.0000', 'win', '270.00', '1.80', '35min', '0.08', 'Mega Cap', 'High', '1.40', 'regular', NULL, NULL, 'Clean breakout above opening range', 'Waited for confirmation', 'Could have held longer', 'ORB works on mega caps', 'Закир', 'orb, breakout', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:39:03.737Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (56, 'COIN', '2026-03-28', 'Second Day Play', 'Long', 'momentum', '132.4000', '138.9000', '130.0000', 'win', '650.00', '2.71', '180min', '0.15', 'Large Cap', 'Medium', '2.50', 'regular', NULL, NULL, 'Follow through from day 1 runner', 'Waited for pullback entry', 'Nothing major', 'Second day plays can be powerful', 'Артур', 'second-day, runner', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:39:27.194Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (57, 'RIOT', '2026-03-27', 'Breakout Failure', 'Short', 'momentum', '17.8000', '18.5000', '18.2000', 'loss', '-350.00', '-1.75', '15min', '0.10', 'Small Cap', 'Low', '3.50', 'regular', NULL, NULL, 'Tried to short failed breakout but it reclaimed', 'Spotted the pattern', 'BTC spike caused squeeze', 'Dont short crypto names against BTC trend', 'Рахматулло', 'breakout-fail, crypto', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:39:40.664Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (58, 'SPY', '2026-03-26', 'Gap Fill Long', 'Long', 'macro', '512.3000', '514.8000', '511.0000', 'win', '250.00', '1.92', '60min', '0.05', 'Index', 'High', '1.10', 'regular', NULL, NULL, 'Gap fill setup on SPY after overnight weakness', 'Patient fill level entry', 'Small size', 'Gap fills on indices are high probability', 'Умид', 'gap-fill, index', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:39:50.472Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (59, 'SMCI', '2026-03-25', 'Parabolic Short', 'Short', 'momentum', '890.0000', '865.0000', '910.0000', 'win', '2500.00', '1.25', '45min', '1.50', 'Large Cap', 'Low', '4.20', 'regular', NULL, NULL, 'Parabolic move into resistance, shorted the crack', 'Waited for the turn confirmation', 'High slippage on entry', 'Parabolic shorts need patience', 'Максат', 'parabolic, short', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:40:21.665Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (60, 'AVGO', '2026-03-24', 'Earnings Drift', 'Long', 'earnings', '148.2000', '152.0000', '146.0000', 'win', '380.00', '1.73', '240min', '0.12', 'Mega Cap', 'High', '1.60', 'regular', NULL, NULL, 'Post-earnings drift continuation', 'Bought the pullback after gap', 'Exited before close', 'Earnings drift is real on quality names', 'Тимур', 'earnings, drift', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:40:31.681Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (61, 'MSFT', '2026-03-23', 'Range Breakout', 'Long', 'momentum', '415.0000', '418.5000', '413.0000', 'win', '350.00', '1.75', '55min', '0.10', 'Mega Cap', 'High', '1.30', 'regular', NULL, NULL, 'Multi-day range breakout with volume', 'Clean level, good volume', 'Should have added on confirmation', 'Range breakouts on mega caps are clean', 'Закир', 'range, breakout', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:40:41.561Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (62, 'BABA', '2026-03-22', 'Reversal Long', 'Long', 'news', '88.5000', '85.2000', '86.0000', 'loss', '-330.00', '-1.32', '40min', '0.20', 'Large Cap', 'High', '2.00', 'regular', NULL, NULL, 'Tried reversal on China news but follow through failed', 'Good level identification', 'News flow turned negative', 'Avoid reversal trades on ongoing news', 'Антон', 'reversal, china', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:40:51.322Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (63, 'ROKU', '2026-03-21', 'Intraday Momentum', 'Long', 'momentum', '72.3000', '75.8000', '71.0000', 'win', '350.00', '2.69', '90min', '0.08', 'Mid Cap', 'Medium', '2.80', 'regular', NULL, NULL, 'Strong intraday momentum with sector rotation', 'Added on pullback, good R:R', 'Initial entry was late', 'Momentum with sector support is powerful', 'Артур', 'momentum, sector', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:41:06.160Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (64, 'DIS', '2026-03-20', 'Earnings Gap and Go', 'Long', 'earnings', '118.4000', '121.0000', '117.0000', 'win', '260.00', '1.86', '30min', '0.10', 'Large Cap', 'High', '2.20', 'premarket', NULL, NULL, 'Strong earnings beat with Disney+ subscriber growth', 'Pre-market entry, held through open', 'Took partial too soon', 'Earnings gap and go reliable on large caps', 'Рахматулло', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:24:28.582Z', '2026-04-09T11:41:41.737Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (50, 'ROKU', '2026-03-21', 'Intraday Momentum', 'Long', 'momentum', '72.3000', '75.8000', '71.0000', 'win', '350.00', '2.69', '90min', '0.08', 'Mid Cap', 'Medium', '2.80', 'regular', NULL, NULL, 'Strong intraday momentum with sector rotation', 'Added on pullback, good R:R', 'Initial entry was late', 'Momentum with sector support is powerful', 'Артур', 'momentum, sector', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:41:34.743Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (45, 'SPY', '2026-03-26', 'Gap Fill Long', 'Long', 'macro', '512.3000', '514.8000', '511.0000', 'win', '250.00', '1.92', '60min', '0.05', 'Index', 'High', '1.10', 'regular', NULL, NULL, 'Gap fill setup on SPY after overnight weakness', 'Patient fill level entry', 'Small size', 'Gap fills on indices are high probability', 'Умид', 'gap-fill, index', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:39:52.339Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (44, 'RIOT', '2026-03-27', 'Breakout Failure', 'Short', 'momentum', '17.8000', '18.5000', '18.2000', 'loss', '-350.00', '-1.75', '15min', '0.10', 'Small Cap', 'Low', '3.50', 'regular', NULL, NULL, 'Tried to short failed breakout but it reclaimed', 'Spotted the pattern', 'BTC spike caused squeeze', 'Dont short crypto names against BTC trend', 'Рахматулло', 'breakout-fail, crypto', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:39:42.641Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (43, 'COIN', '2026-03-28', 'Second Day Play', 'Long', 'momentum', '132.4000', '138.9000', '130.0000', 'win', '650.00', '2.71', '180min', '0.15', 'Large Cap', 'Medium', '2.50', 'regular', NULL, NULL, 'Follow through from day 1 runner', 'Waited for pullback entry', 'Nothing major', 'Second day plays can be powerful', 'Артур', 'second-day, runner', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:39:29.315Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (49, 'BABA', '2026-03-22', 'Reversal Long', 'Long', 'news', '88.5000', '85.2000', '86.0000', 'loss', '-330.00', '-1.32', '40min', '0.20', 'Large Cap', 'High', '2.00', 'regular', NULL, NULL, 'Tried reversal on China news but follow through failed', 'Good level identification', 'News flow turned negative', 'Avoid reversal trades on ongoing news', 'Антон', 'reversal, china', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:40:55.915Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (42, 'META', '2026-03-29', 'Earnings Gap Down Short', 'Short', 'earnings', '520.0000', '512.5000', '525.0000', 'win', '750.00', '1.50', '20min', '0.25', 'Mega Cap', 'High', '2.10', 'premarket', NULL, NULL, 'Weak guidance drove gap down', 'Short into first bounce', 'Covered too early', 'Earnings gaps down are reliable shorts', 'Антон', 'earnings, gap-down, short', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:39:16.763Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (53, 'GME', '2026-03-18', 'Low Float Runner', 'Long', 'short_squeeze', '28.5000', '24.0000', '26.0000', 'loss', '-450.00', '-1.80', '10min', '0.50', 'Mid Cap', 'Low', '5.00', 'regular', NULL, NULL, 'Tried to catch squeeze but halted and dumped', 'Spotted the setup early', 'Halt risk not managed', 'Low float runners carry halt risk', 'Максат', 'squeeze, halt-risk', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:08:51.048Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (41, 'AAPL', '2026-03-30', 'Opening Range Breakout', 'Long', 'momentum', '178.5000', '181.2000', '177.0000', 'win', '270.00', '1.80', '35min', '0.08', 'Mega Cap', 'High', '1.40', 'regular', NULL, NULL, 'Clean breakout above opening range', 'Waited for confirmation', 'Could have held longer', 'ORB works on mega caps', 'Закир', 'orb, breakout', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:39:05.938Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (48, 'MSFT', '2026-03-23', 'Range Breakout', 'Long', 'momentum', '415.0000', '418.5000', '413.0000', 'win', '350.00', '1.75', '55min', '0.10', 'Mega Cap', 'High', '1.30', 'regular', NULL, NULL, 'Multi-day range breakout with volume', 'Clean level, good volume', 'Should have added on confirmation', 'Range breakouts on mega caps are clean', 'Закир', 'range, breakout', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:40:44.200Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (51, 'DIS', '2026-03-20', 'Earnings Gap and Go', 'Long', 'earnings', '118.4000', '121.0000', '117.0000', 'win', '260.00', '1.86', '30min', '0.10', 'Large Cap', 'High', '2.20', 'premarket', NULL, NULL, 'Strong earnings beat with Disney+ subscriber growth', 'Pre-market entry, held through open', 'Took partial too soon', 'Earnings gap and go reliable on large caps', 'Рахматулло', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:41:43.929Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (52, 'NFLX', '2026-03-19', 'VWAP Rejection Short', 'Short', 'momentum', '625.0000', '619.5000', '628.0000', 'win', '550.00', '1.83', '50min', '0.30', 'Mega Cap', 'High', '1.70', 'regular', NULL, NULL, 'Failed VWAP reclaim led to sharp selloff', 'Shorted the rejection candle', 'Could have held for full move', 'VWAP rejections are strong short signals', 'Умид', 'vwap, short', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:08:59.535Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (46, 'SMCI', '2026-03-25', 'Parabolic Short', 'Short', 'momentum', '890.0000', '865.0000', '910.0000', 'win', '2500.00', '1.25', '45min', '1.50', 'Large Cap', 'Low', '4.20', 'regular', NULL, NULL, 'Parabolic move into resistance, shorted the crack', 'Waited for the turn confirmation', 'High slippage on entry', 'Parabolic shorts need patience', 'Максат', 'parabolic, short', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:40:23.689Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (47, 'AVGO', '2026-03-24', 'Earnings Drift', 'Long', 'earnings', '148.2000', '152.0000', '146.0000', 'win', '380.00', '1.73', '240min', '0.12', 'Mega Cap', 'High', '1.60', 'regular', NULL, NULL, 'Post-earnings drift continuation', 'Bought the pullback after gap', 'Exited before close', 'Earnings drift is real on quality names', 'Тимур', 'earnings, drift', NULL, NULL, NULL, '2026-04-09T10:22:04.194Z', '2026-04-09T11:40:33.753Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (39, 'NFLX', '2026-03-19', 'VWAP Rejection Short', 'Short', 'momentum', '625.0000', '619.5000', '628.0000', 'win', '550.00', '1.83', '50min', '0.30', 'Mega Cap', 'High', '1.70', 'regular', NULL, NULL, 'Failed VWAP reclaim led to sharp selloff', 'Shorted the rejection candle', 'Could have held for full move', 'VWAP rejections are strong short signals', 'Умид', 'vwap, short', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:08:57.807Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (34, 'AVGO', '2026-03-24', 'Earnings Drift', 'Long', 'earnings', '148.2000', '152.0000', '146.0000', 'win', '380.00', '1.73', '240min', '0.12', 'Mega Cap', 'High', '1.60', 'regular', NULL, NULL, 'Post-earnings drift continuation', 'Bought the pullback after gap', 'Exited before close', 'Earnings drift is real on quality names', 'Тимур', 'earnings, drift', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:40:36.034Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (35, 'MSFT', '2026-03-23', 'Range Breakout', 'Long', 'momentum', '415.0000', '418.5000', '413.0000', 'win', '350.00', '1.75', '55min', '0.10', 'Mega Cap', 'High', '1.30', 'regular', NULL, NULL, 'Multi-day range breakout with volume', 'Clean level, good volume', 'Should have added on confirmation', 'Range breakouts on mega caps are clean', 'Закир', 'range, breakout', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:40:46.224Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (36, 'BABA', '2026-03-22', 'Reversal Long', 'Long', 'news', '88.5000', '85.2000', '86.0000', 'loss', '-330.00', '-1.32', '40min', '0.20', 'Large Cap', 'High', '2.00', 'regular', NULL, NULL, 'Tried reversal on China news but follow through failed', 'Good level identification', 'News flow turned negative', 'Avoid reversal trades on ongoing news', 'Антон', 'reversal, china', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:40:58.449Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (37, 'ROKU', '2026-03-21', 'Intraday Momentum', 'Long', 'momentum', '72.3000', '75.8000', '71.0000', 'win', '350.00', '2.69', '90min', '0.08', 'Mid Cap', 'Medium', '2.80', 'regular', NULL, NULL, 'Strong intraday momentum with sector rotation', 'Added on pullback, good R:R', 'Initial entry was late', 'Momentum with sector support is powerful', 'Артур', 'momentum, sector', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:41:36.520Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (27, 'XLF', '2026-03-31', 'Trading Low RVOL Set', 'Long', 'macro', '42.2000', '42.9500', '41.5000', 'win', '75.00', '1.50', '120min', '0.10', 'Sector', 'Low', '0.60', 'regular', NULL, NULL, 'Low volume but clean setup', 'Patient on low volume', 'Limited liquidity', 'Good discipline', 'Тимур', 'low-rvol, macro', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:38:57.777Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (26, 'PLTR', '2026-04-01', 'Chasing Entry', 'Long', 'momentum', '32.1000', '31.0000', '33.5000', 'loss', '-140.00', '-1.40', '25min', '0.30', 'Large Cap', 'Low', '0.80', 'regular', NULL, NULL, 'Chased after momentum', 'Recognized mistake quickly', 'Over-aggressive entry', 'Avoid chasing', 'Максат', 'chase, mistake', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:38:50.346Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (38, 'DIS', '2026-03-20', 'Earnings Gap and Go', 'Long', 'earnings', '118.4000', '121.0000', '117.0000', 'win', '260.00', '1.86', '30min', '0.10', 'Large Cap', 'High', '2.20', 'premarket', NULL, NULL, 'Strong earnings beat with Disney+ subscriber growth', 'Pre-market entry, held through open', 'Took partial too soon', 'Earnings gap and go reliable on large caps', 'Рахматулло', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:09:20.693Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (25, 'SOFI', '2026-04-02', 'Scalping', 'Long', 'momentum', '7.8500', '7.9200', '7.8000', 'win', '70.00', '2.33', '5min', '0.05', 'Micro Cap', 'High', '3.00', 'regular', NULL, NULL, 'Quick scalp on support bounce', 'Fast entries and exits', 'Size too small', 'Need more size', 'Умид', 'scalp, quick', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:38:44.583Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (24, 'MSTR', '2026-04-03', 'HOD Failure', 'Short', 'momentum', '385.0000', '381.5000', '388.0000', 'loss', '-250.00', '-2.50', '30min', '0.50', 'Small Cap', 'Medium', '2.20', 'regular', NULL, NULL, 'HOD rejection setup', 'Good setup identification', 'Slippage on exit', 'Learn from slippage', 'Рахматулло', 'hod-failure, short', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:38:37.651Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (23, 'AMD', '2026-04-04', 'Intraday Fade', 'Short', 'momentum', '145.5000', '143.2000', '147.0000', 'win', '230.00', '2.30', '60min', '0.20', 'Large Cap', 'Medium', '1.50', 'regular', NULL, NULL, 'Sold into strength', 'Recognized overbought', 'Chased exit', 'Nice fade trade', 'Артур', 'fade, short', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:38:31.867Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (22, 'TSLA', '2026-04-05', 'VWAP Reclaim', 'Long', 'momentum', '180.3000', '182.8000', '178.5000', 'win', '250.00', '2.50', '90min', '0.15', 'Mega Cap', 'Medium', '1.80', 'regular', NULL, NULL, 'VWAP bounce played well', 'Patient entry at VWAP', 'Exited on breakeven', 'Smooth trade', 'Антон', 'vwap, momentum', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:38:26.134Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (21, 'NVDA', '2026-04-06', 'Earnings Gap and Go', 'Long', 'earnings', '142.5000', '145.2000', '140.0000', 'win', '270.00', '2.70', '45min', '0.10', 'Mega Cap', 'High', '1.20', 'premarket', NULL, NULL, 'Strong momentum after earnings beat', 'Entry near support, managed risk', 'Took profit too early', 'Good risk management', 'Закир', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:03:57.370Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (40, 'GME', '2026-03-18', 'Low Float Runner', 'Long', 'short_squeeze', '28.5000', '24.0000', '26.0000', 'loss', '-450.00', '-1.80', '10min', '0.50', 'Mid Cap', 'Low', '5.00', 'regular', NULL, NULL, 'Tried to catch squeeze but halted and dumped', 'Spotted the setup early', 'Halt risk not managed', 'Low float runners carry halt risk', 'Максат', 'squeeze, halt-risk', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:08:48.117Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (28, 'AAPL', '2026-03-30', 'Opening Range Breakout', 'Long', 'momentum', '178.5000', '181.2000', '177.0000', 'win', '270.00', '1.80', '35min', '0.08', 'Mega Cap', 'High', '1.40', 'regular', NULL, NULL, 'Clean breakout above opening range', 'Waited for confirmation', 'Could have held longer', 'ORB works on mega caps', 'Закир', 'orb, breakout', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:39:07.932Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (29, 'META', '2026-03-29', 'Earnings Gap Down Short', 'Short', 'earnings', '520.0000', '512.5000', '525.0000', 'win', '750.00', '1.50', '20min', '0.25', 'Mega Cap', 'High', '2.10', 'premarket', NULL, NULL, 'Weak guidance drove gap down', 'Short into first bounce', 'Covered too early', 'Earnings gaps down are reliable shorts', 'Антон', 'earnings, gap-down, short', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:39:20.083Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (30, 'COIN', '2026-03-28', 'Second Day Play', 'Long', 'momentum', '132.4000', '138.9000', '130.0000', 'win', '650.00', '2.71', '180min', '0.15', 'Large Cap', 'Medium', '2.50', 'regular', NULL, NULL, 'Follow through from day 1 runner', 'Waited for pullback entry', 'Nothing major', 'Second day plays can be powerful', 'Артур', 'second-day, runner', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:39:31.026Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (31, 'RIOT', '2026-03-27', 'Breakout Failure', 'Short', 'momentum', '17.8000', '18.5000', '18.2000', 'loss', '-350.00', '-1.75', '15min', '0.10', 'Small Cap', 'Low', '3.50', 'regular', NULL, NULL, 'Tried to short failed breakout but it reclaimed', 'Spotted the pattern', 'BTC spike caused squeeze', 'Dont short crypto names against BTC trend', 'Рахматулло', 'breakout-fail, crypto', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:39:44.602Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (32, 'SPY', '2026-03-26', 'Gap Fill Long', 'Long', 'macro', '512.3000', '514.8000', '511.0000', 'win', '250.00', '1.92', '60min', '0.05', 'Index', 'High', '1.10', 'regular', NULL, NULL, 'Gap fill setup on SPY after overnight weakness', 'Patient fill level entry', 'Small size', 'Gap fills on indices are high probability', 'Умид', 'gap-fill, index', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:39:54.443Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (33, 'SMCI', '2026-03-25', 'Parabolic Short', 'Short', 'momentum', '890.0000', '865.0000', '910.0000', 'win', '2500.00', '1.25', '45min', '1.50', 'Large Cap', 'Low', '4.20', 'regular', NULL, NULL, 'Parabolic move into resistance, shorted the crack', 'Waited for the turn confirmation', 'High slippage on entry', 'Parabolic shorts need patience', 'Максат', 'parabolic, short', NULL, NULL, NULL, '2026-04-09T10:19:46.352Z', '2026-04-09T11:40:25.698Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (13, 'SMCI', '2026-03-25', 'Parabolic Short', 'Short', 'momentum', '890.0000', '865.0000', '910.0000', 'win', '2500.00', '1.25', '45min', '1.50', 'Large Cap', 'Low', '4.20', 'regular', NULL, NULL, 'Parabolic move into resistance, shorted the crack', 'Waited for the turn confirmation', 'High slippage on entry', 'Parabolic shorts need patience', 'Максат', 'parabolic, short', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:40:27.607Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (8, 'AAPL', '2026-03-30', 'Opening Range Breakout', 'Long', 'momentum', '178.5000', '181.2000', '177.0000', 'win', '270.00', '1.80', '35min', '0.08', 'Mega Cap', 'High', '1.40', 'regular', NULL, NULL, 'Clean breakout above opening range', 'Waited for confirmation', 'Could have held longer', 'ORB works on mega caps', 'Закир', 'orb, breakout', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:39:10.289Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (12, 'SPY', '2026-03-26', 'Gap Fill Long', 'Long', 'macro', '512.3000', '514.8000', '511.0000', 'win', '250.00', '1.92', '60min', '0.05', 'Index', 'High', '1.10', 'regular', NULL, NULL, 'Gap fill setup on SPY after overnight weakness', 'Patient fill level entry', 'Small size', 'Gap fills on indices are high probability', 'Умид', 'gap-fill, index', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:39:56.682Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (11, 'RIOT', '2026-03-27', 'Breakout Failure', 'Short', 'momentum', '17.8000', '18.5000', '18.2000', 'loss', '-350.00', '-1.75', '15min', '0.10', 'Small Cap', 'Low', '3.50', 'regular', NULL, NULL, 'Tried to short failed breakout but it reclaimed', 'Spotted the pattern', 'BTC spike caused squeeze', 'Dont short crypto names against BTC trend', 'Рахматулло', 'breakout-fail, crypto', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:39:46.577Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (10, 'COIN', '2026-03-28', 'Second Day Play', 'Long', 'momentum', '132.4000', '138.9000', '130.0000', 'win', '650.00', '2.71', '180min', '0.15', 'Large Cap', 'Medium', '2.50', 'regular', NULL, NULL, 'Follow through from day 1 runner', 'Waited for pullback entry', 'Nothing major', 'Second day plays can be powerful', 'Артур', 'second-day, runner', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:39:33.140Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (9, 'META', '2026-03-29', 'Earnings Gap Down Short', 'Short', 'earnings', '520.0000', '512.5000', '525.0000', 'win', '750.00', '1.50', '20min', '0.25', 'Mega Cap', 'High', '2.10', 'premarket', NULL, NULL, 'Weak guidance drove gap down', 'Short into first bounce', 'Covered too early', 'Earnings gaps down are reliable shorts', 'Антон', 'earnings, gap-down, short', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:39:22.842Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (7, 'XLF', '2026-03-31', 'Trading Low RVOL Set', 'Long', 'macro', '42.2000', '42.9500', '41.5000', 'win', '75.00', '1.50', '120min', '0.10', 'Sector', 'Low', '0.60', 'regular', NULL, NULL, 'Low volume but clean setup', 'Patient on low volume', 'Limited liquidity', 'Good discipline', 'Тимур', 'low-rvol, macro', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:38:59.947Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (6, 'PLTR', '2026-04-01', 'Chasing Entry', 'Long', 'momentum', '32.1000', '31.0000', '33.5000', 'loss', '-140.00', '-1.40', '25min', '0.30', 'Large Cap', 'Low', '0.80', 'regular', NULL, NULL, 'Chased after momentum', 'Recognized mistake quickly', 'Over-aggressive entry', 'Avoid chasing', 'Максат', 'chase, mistake', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:38:52.492Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (4, 'MSTR', '2026-04-03', 'HOD Failure', 'Short', 'momentum', '385.0000', '381.5000', '388.0000', 'loss', '-250.00', '-2.50', '30min', '0.50', 'Small Cap', 'Medium', '2.20', 'regular', NULL, NULL, 'HOD rejection setup', 'Good setup identification', 'Slippage on exit', 'Learn from slippage', 'Рахматулло', 'hod-failure, short', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:38:40.481Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (17, 'ROKU', '2026-03-21', 'Intraday Momentum', 'Long', 'momentum', '72.3000', '75.8000', '71.0000', 'win', '350.00', '2.69', '90min', '0.08', 'Mid Cap', 'Medium', '2.80', 'regular', NULL, NULL, 'Strong intraday momentum with sector rotation', 'Added on pullback, good R:R', 'Initial entry was late', 'Momentum with sector support is powerful', 'Артур', 'momentum, sector', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:41:38.162Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (20, 'GME', '2026-03-18', 'Low Float Runner', 'Long', 'short_squeeze', '28.5000', '24.0000', '26.0000', 'loss', '-450.00', '-1.80', '10min', '0.50', 'Mid Cap', 'Low', '5.00', 'regular', NULL, NULL, 'Tried to catch squeeze but halted and dumped', 'Spotted the setup early', 'Halt risk not managed', 'Low float runners carry halt risk', 'Максат', 'squeeze, halt-risk', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:08:45.531Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (2, 'TSLA', '2026-04-05', 'VWAP Reclaim', 'Long', 'momentum', '180.3000', '182.8000', '178.5000', 'win', '250.00', '2.50', '90min', '0.15', 'Mega Cap', 'Medium', '1.80', 'regular', NULL, NULL, 'VWAP bounce played well', 'Patient entry at VWAP', 'Exited on breakeven', 'Smooth trade', 'Антон', 'vwap, momentum', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:38:28.171Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (5, 'SOFI', '2026-04-02', 'Scalping', 'Long', 'momentum', '7.8500', '7.9200', '7.8000', 'win', '70.00', '2.33', '5min', '0.05', 'Micro Cap', 'High', '3.00', 'regular', NULL, NULL, 'Quick scalp on support bounce', 'Fast entries and exits', 'Size too small', 'Need more size', 'Умид', 'scalp, quick', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:38:46.498Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (1, 'NVDA', '2026-04-06', 'Earnings Gap and Go', 'Long', 'earnings', '142.5000', '145.2000', '140.0000', 'win', '270.00', '2.70', '45min', '0.10', 'Mega Cap', 'High', '1.20', 'premarket', NULL, NULL, 'Strong momentum after earnings beat', 'Entry near support, managed risk', 'Took profit too early', 'Good risk management', 'Закир', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:38:20.698Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (18, 'DIS', '2026-03-20', 'Earnings Gap and Go', 'Long', 'earnings', '118.4000', '121.0000', '117.0000', 'win', '260.00', '1.86', '30min', '0.10', 'Large Cap', 'High', '2.20', 'premarket', NULL, NULL, 'Strong earnings beat with Disney+ subscriber growth', 'Pre-market entry, held through open', 'Took partial too soon', 'Earnings gap and go reliable on large caps', 'Рахматулло', 'earnings, gap-up', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:09:32.610Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (3, 'AMD', '2026-04-04', 'Intraday Fade', 'Short', 'momentum', '145.5000', '143.2000', '147.0000', 'win', '230.00', '2.30', '60min', '0.20', 'Large Cap', 'Medium', '1.50', 'regular', NULL, NULL, 'Sold into strength', 'Recognized overbought', 'Chased exit', 'Nice fade trade', 'Артур', 'fade, short', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:38:33.810Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (15, 'MSFT', '2026-03-23', 'Range Breakout', 'Long', 'momentum', '415.0000', '418.5000', '413.0000', 'win', '350.00', '1.75', '55min', '0.10', 'Mega Cap', 'High', '1.30', 'regular', NULL, NULL, 'Multi-day range breakout with volume', 'Clean level, good volume', 'Should have added on confirmation', 'Range breakouts on mega caps are clean', 'Закир', 'range, breakout', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:40:47.990Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (14, 'AVGO', '2026-03-24', 'Earnings Drift', 'Long', 'earnings', '148.2000', '152.0000', '146.0000', 'win', '380.00', '1.73', '240min', '0.12', 'Mega Cap', 'High', '1.60', 'regular', NULL, NULL, 'Post-earnings drift continuation', 'Bought the pullback after gap', 'Exited before close', 'Earnings drift is real on quality names', 'Тимур', 'earnings, drift', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:40:38.001Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (16, 'BABA', '2026-03-22', 'Reversal Long', 'Long', 'news', '88.5000', '85.2000', '86.0000', 'loss', '-330.00', '-1.32', '40min', '0.20', 'Large Cap', 'High', '2.00', 'regular', NULL, NULL, 'Tried reversal on China news but follow through failed', 'Good level identification', 'News flow turned negative', 'Avoid reversal trades on ongoing news', 'Антон', 'reversal, china', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:41:02.098Z');
INSERT INTO "trades" ("id", "ticker", "date", "setup", "side", "event_type", "entry", "exit", "stop", "result", "pnl", "r_multiple", "hold_time", "slippage", "market_cap", "float", "relative_volume", "session", "screenshot_url", "screenshot_notes", "notes", "what_worked", "what_failed", "conclusion", "trader", "tags", "event_id", "pattern_id", "playbook_id", "created_at", "deleted_at") VALUES (19, 'NFLX', '2026-03-19', 'VWAP Rejection Short', 'Short', 'momentum', '625.0000', '619.5000', '628.0000', 'win', '550.00', '1.83', '50min', '0.30', 'Mega Cap', 'High', '1.70', 'regular', NULL, NULL, 'Failed VWAP reclaim led to sharp selloff', 'Shorted the rejection candle', 'Could have held for full move', 'VWAP rejections are strong short signals', 'Умид', 'vwap, short', NULL, NULL, NULL, '2026-04-09T10:17:25.946Z', '2026-04-09T11:41:46.480Z');
SELECT setval(pg_get_serial_sequence('"trades"', 'id'), COALESCE((SELECT MAX(id) FROM "trades"), 1));

INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (10, 'SNDK', '2026-04-09', 'upg', 'UPG, all time high', 'gap_up', NULL, NULL, 'Вышел upg, от Bluesky from 1300 to 3000, sndk на хаях, и пошла на дей дальше', 'https://www.tradingview.com/x/3apmCsim/', '[""]', 'Gap Up, Trend Continuation, Breakout, Liquidity Sweep, Analyst Action, Yesterday Close, Premarket High, All Time High, Relative Strength, Sector Leading', '2026-04-09T19:51:10.865Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (9, 'XOM, CVX, CNQ, BP, SHEL, EQNR, COP', '2026-04-08', 'macro', 'Новость о перемирие США и Иран на две недели', 'gap_down', '-3.00', NULL, NULL, 'https://www.tradingview.com/x/TZQz4RJK/
https://www.tradingview.com/x/S6QMUxHa/
https://www.tradingview.com/x/UfXA2Yeu/
https://www.tradingview.com/x/UfXA2Yeu/
https://www.tradingview.com/x/qDYXXLky/
https://www.tradingview.com/x/4coYBSFp/
https://www.tradingview.com/x/jl3X9X2v/', '["","","","","","",""]', 'Gap Down, News, Sector Move', '2026-04-09T15:48:28.332Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (8, 'AVGO', '2026-04-08', 'dwg', 'Downgrade AVGO', 'gap_up', NULL, '22 M', 'Аналитик Seaport Global Джей Голдберг понизил рейтинг Broadcom (NASDAQ:AVGO) с Buy до Neutral.', 'https://www.tradingview.com/x/zLz25no0/', '[""]', 'Gap Up', '2026-04-09T11:21:35.533Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (4, 'TSLA', '2026-04-05', 'News', 'Tesla Announces New Gigafactory Location', 'Mixed', '1.20', '42M', 'Market uncertain about capital spend', NULL, NULL, NULL, '2026-04-09T10:30:06.618Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (5, 'NVDA', '2026-04-06', 'Earnings', 'NVIDIA Q4 Earnings Beat Expectations', 'Bullish', '3.50', '85M', 'Strong guidance pushes stock higher', NULL, NULL, NULL, '2026-04-09T10:30:06.618Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (1, 'TMHC', '2026-04-07', 'dwg', 'Downgrade TMHC от Seaport Global', 'gap_down', '-2.30', '1.5 M', 'Аналитик
Seaport Global
Кеннет Зенер понизил рейтинг
Taylor Morrison Home (NYSE: TMHC) с Buy (покупать) до Sell (продавать) и снизил целевую цену с $85 до $49.', NULL, NULL, NULL, '2026-04-09T10:30:06.618Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (7, 'SOFI', '2026-04-02', 'Economic', 'Prime Broker Increases Margin Requirements', 'Bearish', '-1.80', '65M', 'Retail traders forced to reduce positions', NULL, NULL, NULL, '2026-04-09T10:30:06.618Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (6, 'AMD', '2026-04-04', 'Economic', 'Fed Signals Possible Rate Cuts', 'Bullish', '2.10', '120M', 'Tech sector rallies on softer rates outlook', NULL, NULL, NULL, '2026-04-09T10:30:06.618Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (2, 'KBH', '2026-04-07', 'dwg', 'Downgrade KBH от Seaport Global', 'gap_down', '-2.30', '1 M', 'Аналитик
Seaport Global
Кеннет Зенер понизил рейтинг
KB Home (NYSE: KBH) с Buy (покупать) до Sell (продавать) и снизил целевую цену с $65 до $43.', NULL, NULL, NULL, '2026-04-09T10:30:06.618Z', NULL);
INSERT INTO "market_events" ("id", "ticker", "date", "event_type", "headline", "reaction", "percent_move", "volume", "summary", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (3, 'AVGO', '2026-04-07', 'news', 'Партнерство с GOOGLE.', 'gap_up', '4.00', '32.3', 'Broadcom заключила долгосрочное соглашение с
Google по разработке и поставке AI-чипов до 2031 года.

Соглашение предусматривает создание и поставку будущих поколений кастомных чипов для искусственного интеллекта.

Также заключено отдельное соглашение с
Anthropic:

Broadcom будет обеспечивать около 3.5 гигаватт вычислительной мощности, начиная с 2027 года.

Компания раскрыла информацию об этих сделках в отчёте, поданном в
SEC, где описаны расширенные долгосрочные партнёрства в сфере ИИ.

Комментарий: На премаркете было ложное пробитие хая премаркета. Потом вернулась в канал проторговки афтермаркета. Не показывала силу либо слабость на премаркете. В конце премаркета она вышла из канала проторговки афтермаркета , ретест и отросла. До 200 ma она не дошла на премаркете и афтемаркете. Цена открылась, спайк наверх, пробила 200 ma и вернулась. Несколько раз тестила 200 ma. В итоге начала падать и торговаться ниже опена. В 11:10 начала ходить за рынком росла. В итоге пробила 200 ma и вернулась. Кружится вокруг своей 200 ma.', NULL, NULL, NULL, '2026-04-09T10:30:06.618Z', NULL);
SELECT setval(pg_get_serial_sequence('"market_events"', 'id'), COALESCE((SELECT MAX(id) FROM "market_events"), 1));

INSERT INTO "research" ("id", "pattern_name", "ticker", "context", "market_condition", "what_worked", "what_failed", "repeat_count", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (1, 'Earnings Gap and Go - NVDA', 'NVDA', 'Post earnings gap continuation with strong volume', 'Bullish trend', 'Large gap above open, sustained momentum', 'Took profits too early', 5, 8, NULL, NULL, NULL, '2026-04-09T10:30:06.665Z', NULL);
INSERT INTO "research" ("id", "pattern_name", "ticker", "context", "market_condition", "what_worked", "what_failed", "repeat_count", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (2, 'VWAP Reclaim - TSLA', 'TSLA', 'Stock bounces from VWAP support', 'Consolidation', 'Patient entry at VWAP, good risk reward', 'False bounces', 3, 7, NULL, NULL, NULL, '2026-04-09T10:30:06.665Z', NULL);
INSERT INTO "research" ("id", "pattern_name", "ticker", "context", "market_condition", "what_worked", "what_failed", "repeat_count", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (3, 'Fade into Resistance - AMD', 'AMD', 'Shorting into overbought conditions', 'Bearish trend', 'Recognized resistance rejection', 'Lack of follow-through', 2, 6, NULL, NULL, NULL, '2026-04-09T10:30:06.665Z', NULL);
INSERT INTO "research" ("id", "pattern_name", "ticker", "context", "market_condition", "what_worked", "what_failed", "repeat_count", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "created_at", "deleted_at") VALUES (4, 'Scalping Low Float - SOFI', 'SOFI', 'Quick micro moves on sub-5M float stocks', 'Volatile', 'Fast entries and exits, tight stops', 'Spread risk on scalps', 8, 6, NULL, NULL, NULL, '2026-04-09T10:30:06.665Z', NULL);
SELECT setval(pg_get_serial_sequence('"research"', 'id'), COALESCE((SELECT MAX(id) FROM "research"), 1));

INSERT INTO "daily_feed" ("id", "date", "what_works_now", "what_doesnt_work", "best_tickers", "market_theme", "notes", "tags", "screenshot_url", "screenshot_notes", "created_at", "deleted_at") VALUES (1, '2026-04-07', NULL, NULL, 'UNH, CVS, HUM, CNC, MOH', 'Healthcare', 'Акции крупных медицинских страховщиков — UnitedHealth, Humana и CVS Health — выросли на 6–10% в ходе предпродовой сессии после того, как CMS объявила о повышении выплат по программе Medicare Advantage на 2,48% в 2027 году. Это показатель оказался лучше ожиданий рынка, особенно на фоне того, что в начале года предложенная надбавка в 0,99% уже обвалила акции UnitedHealth почти на 20% за один день.', 'Reversal, Gap Up, Breakout, News, Sector Move, Relative Strength, Wide Spread, High Volatility, News Risk, Market Weak', 'https://www.tradingview.com/x/Kx08uyL8/
https://www.tradingview.com/x/RoAZqVUP/
https://www.tradingview.com/x/YlaCWNQE/
https://www.tradingview.com/x/83k2rYJq/
https://www.tradingview.com/x/aq07OYla/', '["UNH, Принт по гепу, рисовки в маркет превратились","CVS, Принт против гепа.","HUM, Принт против гепа.","CNC, Принт flat.","MOH, Принт против гепа."]', '2026-04-09T10:30:06.712Z', NULL);
INSERT INTO "daily_feed" ("id", "date", "what_works_now", "what_doesnt_work", "best_tickers", "market_theme", "notes", "tags", "screenshot_url", "screenshot_notes", "created_at", "deleted_at") VALUES (2, '2026-04-06', 'Gap and go setups, earnings movers, long bias', 'Shorting mega caps, fading weakness', 'NVDA, TSLA, AMD, MSTR', 'Post-earnings strength, momentum continuation', 'Earnings season in full swing, strong leadership sector stocks', NULL, NULL, NULL, '2026-04-09T10:30:06.712Z', NULL);
INSERT INTO "daily_feed" ("id", "date", "what_works_now", "what_doesnt_work", "best_tickers", "market_theme", "notes", "tags", "screenshot_url", "screenshot_notes", "created_at", "deleted_at") VALUES (3, '2026-04-05', 'VWAP reclaims, support bounces', 'Breaking support, new lows', 'TSLA, PLTR, XLF', 'Mixed but leaning bullish', 'Fed speakers tomorrow, avoid surprises', NULL, NULL, NULL, '2026-04-09T10:30:06.712Z', NULL);
INSERT INTO "daily_feed" ("id", "date", "what_works_now", "what_doesnt_work", "best_tickers", "market_theme", "notes", "tags", "screenshot_url", "screenshot_notes", "created_at", "deleted_at") VALUES (4, '2026-04-04', 'Short bias on gaps, fade resistance', 'Chasing green candles', 'AMD, COIN, RIOT', 'Bearish turn, CPI concerns', 'Macro headwinds affecting tech sector', NULL, NULL, NULL, '2026-04-09T10:30:06.712Z', NULL);
INSERT INTO "daily_feed" ("id", "date", "what_works_now", "what_doesnt_work", "best_tickers", "market_theme", "notes", "tags", "screenshot_url", "screenshot_notes", "created_at", "deleted_at") VALUES (5, '2026-04-03', 'Range trading, support/resistance plays', 'Large breakouts, gap strategy', 'SPY, QQQ, DXY', 'Consolidation after losses', 'Market absorbed yesterday moves, tight ranges', NULL, NULL, NULL, '2026-04-09T10:30:06.712Z', NULL);
SELECT setval(pg_get_serial_sequence('"daily_feed"', 'id'), COALESCE((SELECT MAX(id) FROM "daily_feed"), 1));

INSERT INTO "discussions" ("id", "topic", "type", "trader", "notes", "tags", "created_at", "deleted_at") VALUES (7, 'partnership', 'general', 'Закир', 'avgo, mrvl, crwv, ', NULL, '2026-04-09T18:56:04.788Z', NULL);
INSERT INTO "discussions" ("id", "topic", "type", "trader", "notes", "tags", "created_at", "deleted_at") VALUES (6, 'Кто что добавит сегодня', 'general', 'Закир', NULL, NULL, '2026-04-09T12:43:52.392Z', NULL);
INSERT INTO "discussions" ("id", "topic", "type", "trader", "notes", "tags", "created_at", "deleted_at") VALUES (3, 'VWAP Trading Techniques', 'analysis', 'Артур', 'Let''s break down different VWAP approaches. I use VWAP as support/resistance but curious about other traders'' methods. Anyone use VWAP crosses?', 'vwap, technical', '2026-04-09T10:30:06.758Z', NULL);
INSERT INTO "discussions" ("id", "topic", "type", "trader", "notes", "tags", "created_at", "deleted_at") VALUES (1, 'Best Scalping Setups for Low Float Stocks', 'strategy', 'Закир', 'What are your go-to scalp setups? Been working on sub-minute entries on 1-5M floats with high RVOL. Thinking about risk management - do you scale in or all-in?', 'scalping, low-float', '2026-04-09T10:30:06.758Z', NULL);
INSERT INTO "discussions" ("id", "topic", "type", "trader", "notes", "tags", "created_at", "deleted_at") VALUES (5, 'Risk Management in Day Trading', 'risk', 'Умид', 'Most important rule - always know your exit before entry. Position sizing formula: 2% per trade max. Fixed dollar stops beat percent stops always.', 'risk-management', '2026-04-09T10:30:06.758Z', NULL);
INSERT INTO "discussions" ("id", "topic", "type", "trader", "notes", "tags", "created_at", "deleted_at") VALUES (4, 'Fade Trading and HOD Failures', 'strategy', 'Рахматулло', 'How do you identify which fades work? I see a lot of HOD failures that turn into runners. Any specific criteria you use to filter?', 'fade, short', '2026-04-09T10:30:06.758Z', NULL);
INSERT INTO "discussions" ("id", "topic", "type", "trader", "notes", "tags", "created_at", "deleted_at") VALUES (2, 'Earnings Gap and Go Strategy', 'setup', 'Антон', 'Discussing the classic gap and go setup. Looking at historical data, what time frame do these usually consolidate in? Pre-market moves vs open moves?', 'earnings, gap-up', '2026-04-09T10:30:06.758Z', NULL);
SELECT setval(pg_get_serial_sequence('"discussions"', 'id'), COALESCE((SELECT MAX(id) FROM "discussions"), 1));

INSERT INTO "comments" ("id", "discussion_id", "trader", "text", "created_at") VALUES (7, 7, 'Закир', '[Observing] artur', '2026-04-09T18:56:14.938Z');
INSERT INTO "comments" ("id", "discussion_id", "trader", "text", "created_at") VALUES (6, 6, 'Максат', '[Observing] AEHR я уже добавил', '2026-04-09T12:56:02.375Z');
INSERT INTO "comments" ("id", "discussion_id", "trader", "text", "created_at") VALUES (5, 6, 'Умид', '[Observing] CRWV 
APLD', '2026-04-09T12:52:42.519Z');
INSERT INTO "comments" ("id", "discussion_id", "trader", "text", "created_at") VALUES (4, 6, 'Рахматулло', '[Observing] AEHR', '2026-04-09T12:49:22.921Z');
INSERT INTO "comments" ("id", "discussion_id", "trader", "text", "created_at") VALUES (3, 6, 'Закир', '[Observing] я поищу моментумы для плейбука и потом еще что то', '2026-04-09T12:47:54.875Z');
INSERT INTO "comments" ("id", "discussion_id", "trader", "text", "created_at") VALUES (2, 6, 'Артур', '[Observing] Я возьму вчерашние движения Software секрора', '2026-04-09T12:45:34.939Z');
INSERT INTO "comments" ("id", "discussion_id", "trader", "text", "created_at") VALUES (1, 6, 'Максат', '[Observing] TSLA и DAL вчерашний', '2026-04-09T12:44:46.046Z');
SELECT setval(pg_get_serial_sequence('"comments"', 'id'), COALESCE((SELECT MAX(id) FROM "comments"), 1));

INSERT INTO "watchlist" ("id", "ticker", "catalyst", "target_price", "stop_price", "status", "notes", "sector", "screenshot_url", "tags", "created_at", "deleted_at") VALUES (1, 'MSTR', 'Bitcoin movement, May earnings', '450.0000', '370.0000', 'Active', 'Watch for BTC correlation and capitulation dips for entries', NULL, NULL, NULL, '2026-04-09T10:30:06.804Z', '2026-04-09T15:30:29.354Z');
INSERT INTO "watchlist" ("id", "ticker", "catalyst", "target_price", "stop_price", "status", "notes", "sector", "screenshot_url", "tags", "created_at", "deleted_at") VALUES (2, 'COIN', 'Crypto adoption news, macro developments', '145.0000', '120.0000', 'Active', 'Strong earnings surprise potential, SEC clarity', NULL, NULL, NULL, '2026-04-09T10:30:06.804Z', '2026-04-09T15:30:36.923Z');
INSERT INTO "watchlist" ("id", "ticker", "catalyst", "target_price", "stop_price", "status", "notes", "sector", "screenshot_url", "tags", "created_at", "deleted_at") VALUES (3, 'RIOT', 'Bitcoin miner performance, hash rate growth', '18.5000', '15.0000', 'Active', 'Setup for scalping on BTC moves, high RVOL', NULL, NULL, NULL, '2026-04-09T10:30:06.804Z', '2026-04-09T15:30:38.384Z');
INSERT INTO "watchlist" ("id", "ticker", "catalyst", "target_price", "stop_price", "status", "notes", "sector", "screenshot_url", "tags", "created_at", "deleted_at") VALUES (4, 'AVGO', 'AI server demand, earnings next month', '155.0000', '130.0000', 'Active', 'Semiconductor strength indicator, supply chain check', NULL, NULL, NULL, '2026-04-09T10:30:06.804Z', '2026-04-09T15:30:39.902Z');
SELECT setval(pg_get_serial_sequence('"watchlist"', 'id'), COALESCE((SELECT MAX(id) FROM "watchlist"), 1));

INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (127, 'Max Loss Day Rule — Circuit Breaker', 'Position Management', 'Другой', 'Hard daily loss limit. When reached, STOP TRADING. No exceptions. This is the most important risk management rule.', '- Set max daily loss (e.g., $500 or 2% of account)
- Track P&L in real-time
- At 50% of max loss: reduce size by half
- At 75% of max loss: only A+ setups
- At 100% of max loss: STOP. Walk away.
- Review losing trades end of day
- NO revenge trading
- Reset next day fresh', 'The max loss day rule is NON-NEGOTIABLE. Every prop firm enforces this. Without it, one bad day can destroy a month of profits. SMB Capital says: ''Live to trade another day.'' The market will be there tomorrow.', 95, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:50.017Z', '2026-04-10T00:26:56.136Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (126, 'Scaling Out — Tiered Profit Taking', 'Position Management', 'Другой', 'Instead of all-or-nothing exits, scale out in tiers. Take 1/3 at first target, 1/3 at second, trail the rest.', '- Before entry: define 3 target levels
- Target 1 (1R): take 1/3 off, move stop to breakeven
- Target 2 (2R): take 1/3 off, trail stop
- Target 3 (3R+): trail remaining 1/3 with tight stop
- If stop hits before T1: full loss (acceptable)
- Result: winners are bigger, losers are controlled
- Track average R-multiple', 'Scaling out is a risk management technique that ensures you capture profits while keeping upside potential. The psychology: taking partial profits reduces the urge to close the entire position too early.', 85, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.974Z', '2026-04-10T00:26:56.136Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (125, 'Dollar Cost Into Winner — Pyramiding', 'Position Management', 'Другой', 'When trade is working, add to the position (pyramid) at predetermined levels. Maximize winners, don''t just take profit.', '- Initial entry at planned level (full or partial)
- First add: after breakout confirms (price + volume)
- Second add: on first pullback that holds
- Each add is smaller than the previous
- Move stop to breakeven after first add
- Trail stop to lock in profits on adds
- Never add to losers
- Max position: 3 tiers', 'Pyramiding into winners is how prop traders maximize their best trades. SMB calls this ''pressing your winners.'' The key: each add must be smaller, and the stop must move up. Never average down — that''s the opposite of this strategy.', 80, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.931Z', '2026-04-10T00:26:56.136Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (124, 'CPI / Jobs Report — Morning Gap Framework', 'Macro & Sector Plays', 'Другой', 'Major economic data (CPI, NFP, PPI) released at 8:30 AM ET. Creates significant gaps. Trade the gap framework after open.', '- Note data release at 8:30 AM (pre-market)
- Calculate gap vs expectations
- If data better than expected = bullish gap (usually)
- If data worse = bearish gap
- Wait for market open, don''t pre-market trade
- Apply Gap and Go or Gap Fill framework
- Sector impact: CPI → tech/growth, Jobs → financials
- Reduce size on macro days', 'Macro data days create the biggest moves because they affect ALL stocks simultaneously. CPI and jobs data move the entire market. Key: don''t trade the data, trade the reaction to the data. The same CPI number can be bullish or bearish depending on context.', 67, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.888Z', '2026-04-10T00:27:02.069Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (123, 'Fed Day / FOMC — 2:00 PM Reversal', 'Macro & Sector Plays', 'Другой', 'FOMC announcement at 2:00 PM ET. Initial move often reverses. Wait for the ''whipsaw'' and trade the real direction.', '- No new positions before 2:00 PM on FOMC day
- Note initial reaction direction at 2:00 PM
- Wait 15-30 minutes for the ''whipsaw''
- If initial move reverses = trade the reversal
- If initial move continues with volume = trade continuation
- Reduce size (FOMC = volatile)
- Stop tight (FOMC moves are fast)
- Close all FOMC trades by end of day', 'FOMC days have a well-known pattern: initial spike at 2:00 PM, then reversal, then the ''real'' move. The initial reaction is often wrong because algorithms react to headlines before the full statement is analyzed. Patience is key.', 62, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.845Z', '2026-04-10T00:27:02.069Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (122, 'Sector Rotation — Follow the Money', 'Macro & Sector Plays', 'Другой', 'Money rotates between sectors based on economic cycle. Identify which sectors are receiving inflows and trade the leaders.', '- Monitor sector ETF relative performance (XLF, XLE, XLK, etc.)
- Identify sector showing 3+ days of outperformance
- Find leading stocks within that sector
- Entry on pullback in the leading stock
- Confirm with sector ETF still trending
- Stop if sector rotation reverses
- Target: sector trend continuation', 'Sector rotation is driven by institutional portfolio rebalancing. When the economy shifts, trillions of dollars rotate. Early identification = riding the institutional wave. Track XL_ ETFs daily for rotation signals.', 72, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.802Z', '2026-04-10T00:27:02.069Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (121, 'Earnings Range Anticipation — Straddle Alternative', 'Earnings Strategies', 'Другой', 'Anticipate the earnings range based on implied move. Trade the break of that range rather than guessing direction.', '- Calculate expected move from options (straddle price)
- Mark expected range (close +/- expected move)
- After earnings: if price exceeds expected range = continuation
- If price within expected range = mean reversion to close
- Entry on confirmation of scenario
- Stop based on expected range boundary
- Target: 1.5x expected move (if exceeded) or prior close (if within)', 'Instead of guessing earnings direction, this framework uses the options market''s expected move as a roadmap. When the actual move exceeds expectations, momentum is real. When it stays within, the move is priced in.', 50, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.760Z', '2026-04-10T00:27:07.980Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (120, 'Post-Earnings Drift (PEAD) — Follow Surprise', 'Earnings Strategies', 'Другой', 'After earnings surprise, stock continues drifting in the direction of the surprise for days/weeks. Trade the drift, not the gap.', '- Significant earnings surprise (>10% above/below estimates)
- Initial gap confirmed by volume
- Wait for first pullback (don''t chase the gap)
- Entry on pullback in direction of surprise
- Positive surprise: long pullback to VWAP/21EMA
- Negative surprise: short bounce to VWAP/21EMA
- Hold: 5-20 days
- Trail stop using 8 EMA daily', 'Post-Earnings Announcement Drift (PEAD) is one of the most well-documented anomalies in finance. Studies show stocks continue moving in the direction of the earnings surprise for 60+ days. The market underreacts to earnings surprises.', 74, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.717Z', '2026-04-10T00:27:07.980Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (119, 'Earnings Whisper — Pre-Earnings Position', 'Earnings Strategies', 'Другой', 'Accumulate position before earnings when technical setup + whisper numbers suggest upside surprise. Small size for binary risk.', '- Earnings within 1-3 days
- Technical setup bullish (above MAs, tight range)
- Options IV < historical norm (cheap options)
- Whisper number higher than consensus
- Revenue growth trend positive
- Entry: small position (25-50% normal size)
- Define max loss BEFORE entry
- Exit plan for both scenarios', 'Pre-earnings positions are high-risk binary trades. SMB teaches: if you trade earnings, use reduced size and define your max loss before entry. The best risk/reward comes when options IV is below average — you''re getting paid less for the uncertainty.', 58, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.675Z', '2026-04-10T00:27:07.980Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (118, 'Fibonacci Retracement — Measured Pullback', 'Swing Trading Setups', 'Breakout', 'Stock in trend pulls back to key Fibonacci level (38.2%, 50%, 61.8%). Enter at Fib level with stop below next Fib.', '- Identify clear trend (impulse move)
- Draw Fibonacci from swing low to swing high (uptrend)
- Wait for pullback to 38.2%, 50%, or 61.8% level
- Look for reversal candle at Fib level
- Volume should decrease on pullback
- Entry on bounce from Fib with volume
- Stop below next Fib level
- Target: retest of prior high or 1.618 extension', 'Fibonacci levels are self-fulfilling because so many traders use them. The 61.8% level is especially powerful — it''s the ''golden ratio'' pullback. If price holds 61.8%, the trend is likely intact. Below 78.6% = trend likely failed.', 71, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.632Z', '2026-04-10T00:27:12.451Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (117, 'Moving Average Crossover — Trend Change', 'Swing Trading Setups', 'Другой', '8/21 EMA crossover on daily chart signals trend change. Enter in direction of the cross with swing time frame.', '- 8 EMA crosses above 21 EMA = bullish
- 8 EMA crosses below 21 EMA = bearish
- Volume confirms crossover
- Wait for pullback to 8 EMA after cross
- Entry on bounce off 8 EMA in crossover direction
- Stop: below 21 EMA
- Target: prior swing high/low or Fibonacci extension
- Hold: 5-20 days', 'EMA crossovers lag by nature but filter noise. The 8/21 combo captures trend changes faster than 50/200. Best used as a trend filter — take only long setups when 8>21, short setups when 8<21.', 63, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.590Z', '2026-04-10T00:27:12.451Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (116, 'Multi-Day Breakout — Weekly Range Expansion', 'Swing Trading Setups', 'Breakout', 'Stock breaks out of a weekly/monthly range on catalyst. Hold for multi-day measured move. Wider stops, bigger targets.', '- Tight weekly range (Bollinger Bands squeezing)
- Breakout on catalyst with volume >2x average
- Close above range high (weekly candle)
- Entry on pullback to breakout level
- Stop below breakout level (former resistance = new support)
- Target: measured move (range height added to breakout)
- Hold time: 3-15 days', 'Weekly range breakouts capture larger moves than intraday trades. The tight range = low volatility, which precedes high volatility (regime change). Best combined with fundamental catalyst.', 76, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.547Z', '2026-04-10T00:27:12.451Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (115, 'Exhaustion Gap — Reversal Signal', 'Gap Trading', 'Gap', 'After an extended multi-day move, a final gap in the trend direction signals exhaustion. Trade the reversal.', '- Stock has moved >20% in one direction over 3-5 days
- Final gap in the same direction (up gap after rally, down gap after selloff)
- Volume highest of the entire move
- Intraday reversal candle forms (shooting star, doji)
- Entry on reversal confirmation
- Stop above/below exhaustion gap extreme
- Target: 38-50% retrace of entire move', 'Exhaustion gaps are one of the most reliable reversal signals in technical analysis. They represent the last burst of momentum before the trend reverses. Key identifier: the gap comes AFTER a multi-day move, not at the beginning.', 65, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.505Z', '2026-04-10T00:27:19.740Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (114, 'Gap and Trap — False Breakout', 'Gap Trading', 'Gap', 'Stock gaps up through resistance but immediately sells off. The gap traps breakout buyers. Short the trapped longs as they panic.', '- Stock gaps above key resistance level
- First 15 minutes: selling pressure emerges
- Stock falls back below resistance (now support becomes resistance)
- Trapped longs begin to panic sell
- Entry short on break below gap low or key level
- Volume increases on the reversal
- Stop above gap high
- Target: prior support or gap fill', 'Gap and Trap is the opposite of Gap and Go. It works because breakout buyers get trapped when the gap fails. Their stop-loss selling accelerates the move down. Best when the gap is on weak catalyst or into major resistance.', 72, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.462Z', '2026-04-10T00:27:19.740Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (113, 'Gap Fill — Statistical Edge', 'Gap Trading', 'Gap', 'Most gaps fill within 1-3 days (statistical tendency). Trade the gap fill when conditions support mean reversion back to prior close.', '- Gap without strong catalyst (earnings, FDA excluded)
- Gap size < 5% (large gaps less likely to fill same day)
- Pre-market volume normal (not elevated)
- If gap up: short toward prior close
- If gap down: long toward prior close
- Entry after first 15 min (avoid opening volatility)
- Stop beyond gap extreme
- Target: prior day close (full fill)', 'Statistical studies show ~70% of gaps eventually fill. However, catalyst-driven gaps (earnings, FDA) fill less often. Best gap fill trades are on ''nothing'' gaps — gap on no real news, just overnight drift.', 70, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.420Z', '2026-04-10T00:27:19.740Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (112, 'Pairs Trade — Relative Value', 'Mean Reversion Plays', 'Другой', 'Two correlated stocks diverge. Long the underperformer, short the outperformer. Profit when the spread reverts to mean.', '- Identify correlated pair (same sector, similar business)
- Calculate historical spread (ratio or price difference)
- Wait for spread to reach 2+ StdDev from mean
- Long the laggard, short the leader (equal dollar amounts)
- Monitor correlation — if it breaks, exit
- Target: spread returns to mean
- Max hold: 5-10 days', 'Pairs trading is market-neutral — you profit from the relative move, not the absolute direction. Classic pairs: XOM/CVX, GOOGL/META, JPM/BAC. Risk: the correlation can break permanently (structural change).', 75, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.376Z', '2026-04-10T00:27:37.341Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (111, 'Rubber Band Snap — Extended Stock Reversal', 'Mean Reversion Plays', 'Reversal', 'Stock stretched far from VWAP or moving average like a rubber band. Trade the snap-back to the mean when momentum exhausts.', '- Stock >2% from VWAP (intraday) or >5% from 20MA (daily)
- Momentum indicators showing divergence
- Volume decreasing on the extension
- Candle pattern showing reversal (doji, hammer, engulfing)
- Entry on reversal confirmation
- Stop beyond the extreme
- Target: VWAP or moving average', 'The rubber band analogy: the further a stock stretches from its mean, the more energy is stored for the snap-back. Works best when the extension is on declining volume — showing exhaustion rather than genuine trend.', 68, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.334Z', '2026-04-10T00:27:37.341Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (110, 'Mean Reversion — Oversold Bounce', 'Mean Reversion Plays', 'Reversal', 'Stock drops >3 standard deviations from its mean (20-day MA). Statistical probability favors a bounce. Long the oversold condition.', '- Stock >3 StdDev below 20-day MA
- RSI < 20 on daily chart
- No fundamental catalyst for further downside
- Volume exhaustion (decreasing on sell-off)
- Entry on first green candle after selling exhaustion
- Stop below recent low
- Target: 20-day MA (mean)', 'Mean reversion works because extreme moves are statistically unsustainable. However, key filter: avoid stocks with ongoing fundamental deterioration (bankruptcy risk, fraud, etc.). Best on large-cap with temporary panic.', 72, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.290Z', '2026-04-10T00:27:37.341Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (109, 'Level 2 Spoofing Detection', 'Advanced Tape Reading', 'Другой', 'Detect spoofing on Level 2 — large orders that appear and disappear to manipulate price. Trade opposite the spoof direction.', '- Watch for large bid/ask orders that repeatedly cancel
- Spoof orders usually >50K shares on illiquid stocks
- Note if price moves toward the spoof, then spoof is removed
- Real orders get filled, spoof orders get cancelled
- If large bid keeps disappearing = fake support = bearish
- If large ask keeps disappearing = fake resistance = bullish
- Use tape confirmation before entry', 'Spoofing is illegal but still occurs, especially on small/mid cap stocks. Recognizing it gives you an edge because you understand which levels are real and which are fake. Key: real orders absorb volume, spoof orders run.', 60, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:49.246Z', '2026-04-10T00:27:40.898Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (108, 'Dark Pool Print — Hidden Liquidity', 'Advanced Tape Reading', 'Другой', 'Unusually large dark pool prints signal institutional interest. Trade in direction of the largest prints when they cluster at a price level.', '- Monitor dark pool print data (Finra ADF, TRF)
- Look for prints >100K shares
- Note price level where prints cluster
- If prints at/above ask = bullish
- If prints at/below bid = bearish
- Use as confirmation, not primary signal
- Combine with chart pattern for entry', 'Dark pools account for ~40% of US equity volume. Large institutional orders often execute there to avoid market impact. When you can see these prints, you''re seeing what smart money is doing.', 65, NULL, NULL, 'Dark Pool Print,Block Trade Follow,Tape Reading Entry,Dark Pool Level,Dark Pool Volume', NULL, NULL, '2026-04-09T23:54:49.203Z', '2026-04-10T00:27:40.898Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (107, 'Tape Reading — Order Flow Entry', 'Advanced Tape Reading', 'Другой', 'Read Level 2 / Time & Sales to identify institutional activity. Large prints, hidden orders, and bid/ask dynamics reveal intent.', '- Watch Time & Sales for large prints (>10K shares)
- Note bid/ask size imbalances on Level 2
- Look for iceberg orders (repeated same-size prints)
- Identify institutional accumulation vs distribution
- Entry when tape confirms your directional bias
- Stop if tape reading thesis is invalidated', 'Tape reading is the original edge. Before charts, traders read the tape. Large prints at the ask = buying pressure. Large prints at the bid = selling pressure. SMB Capital considers tape reading a core skill.', 78, NULL, NULL, 'Tape Reading Entry,Level 2 Entry,Dark Pool Print,Block Trade Follow,High Relative Volume', NULL, NULL, '2026-04-09T23:54:49.160Z', '2026-04-10T00:27:40.898Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (106, 'Overnight Hold — Swing Catalyst', 'Pre-Market & After Hours', 'Другой', 'Hold position overnight when catalyst supports multi-day move. Reduce size for overnight risk. Set hard stop.', '- Catalyst supports multi-day move (earnings beat, FDA, M&A)
- Reduce position to 50% of intraday size
- Set hard stop (worst-case exit level)
- Calculate overnight gap risk
- Check after-hours liquidity
- Set pre-market alert for review
- Re-evaluate at next open', 'Overnight holds add gap risk but capture multi-day moves. Key rule: if you wouldn''t enter the position fresh at the close, don''t hold it overnight. Always reduce size.', 55, NULL, NULL, 'Swing Hold,Overnight Hold Gap,Multi-Day Momentum,Earnings Beat,FDA Approval', NULL, NULL, '2026-04-09T23:54:49.118Z', '2026-04-10T00:27:43.907Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (105, 'After Hours Earnings React — Next Day Prep', 'Pre-Market & After Hours', 'Другой', 'Stock reports earnings after hours. Analyze reaction, prepare next-day game plan based on after-hours price action.', '- Note earnings results vs expectations
- Watch after-hours price reaction
- Identify key AH levels (high, low, close)
- Check options implied move vs actual
- Prepare bull/bear scenario for next day
- Set pre-market alerts', 'After-hours reaction to earnings often sets the tone for the next trading day. Preparing the night before gives you a significant edge over traders who react in real-time.', 70, NULL, NULL, 'Earnings Gap Up,Earnings Gap Down,Second Day Play,After Hours,Earnings Beat,Earnings Miss', NULL, NULL, '2026-04-09T23:54:49.075Z', '2026-04-10T00:27:43.907Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (104, 'Pre-Market Gap Scan — Watchlist Build', 'Pre-Market & After Hours', 'Другой', 'Before market open (7:00-9:30 AM ET). Scan for stocks gapping >4% on catalyst. Build watchlist with levels, plan entries.', '- Scan at 7:00 AM for gaps >4%
- Check catalyst (earnings, news, upgrade/downgrade)
- Note pre-market volume (>500K = in play)
- Mark key levels: PM high, PM low, prior day close
- Calculate ATR for position sizing
- Rank top 3-5 stocks by catalyst quality
- Set alerts at key levels', 'The most important 30 minutes of the day happens before the market opens. Every successful prop trader starts with a thorough pre-market scan. This framework ensures you''re prepared, not reactive.', 85, NULL, NULL, 'Gap Up,Gap Down,Premarket,Premarket High,Premarket Low,High Relative Volume', NULL, NULL, '2026-04-09T23:54:49.032Z', '2026-04-10T00:27:43.907Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (103, 'MOC + Options Expiration — Pin Risk Play', 'MOC / Closing Auction', 'Другой', 'On options expiration (monthly/weekly), stocks tend to ''pin'' to strike prices with maximum open interest. Trade the pin into the close.', '- Identify max pain / highest OI strike price
- After 2:00 PM on OPEX day, monitor price vs strike
- If stock near high-OI strike, expect pinning action
- Trade toward the pin strike (mean reversion to strike)
- MOC order at the pin strike if profitable
- Size small — pinning is not guaranteed
- Works best on large-cap with high options volume
- Close all positions at market close', 'Options expiration pinning occurs because market makers hedge their delta by buying/selling stock. As options expire, this hedging creates mean-reversion toward the highest open interest strike. This effect is strongest in the last 2 hours of OPEX day.', 62, NULL, NULL, 'MOC Imbalance,Closing Cross Play,Imbalance,OPEX Day,Last Hour,Round Number', NULL, NULL, '2026-04-09T23:54:48.901Z', '2026-04-10T00:27:47.437Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (102, 'MOC Fade — Closing Reversal', 'MOC / Closing Auction', 'Другой', 'After an extreme closing imbalance pushes price, the next morning often sees a reversal. Fade the closing auction move at next open.', '- Large closing imbalance pushed price >0.5% in last 15 min
- The move was mechanical (rebalance) not fundamental
- Next day: fade the closing move direction
- Entry: at open or first 15 min of next day
- Target: prior day''s 3:45 PM price (pre-imbalance level)
- Stop: beyond closing price
- Works best on quarterly rebalance days
- Avoid if fundamental catalyst exists', 'Closing imbalances are mechanical — index funds MUST buy or sell regardless of price. This creates artificial moves that often reverse the next morning when the forced buying/selling is done. Key: only fade mechanical moves, not fundamental ones.', 60, NULL, NULL, 'MOC Imbalance,Closing Cross Play,Fade Trade,Reversal,Last Hour,Power Hour', NULL, NULL, '2026-04-09T23:54:48.859Z', '2026-04-10T00:27:47.437Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (101, 'MOC Imbalance — Closing Auction Play', 'MOC / Closing Auction', 'Другой', 'NYSE publishes closing imbalance data at 3:45 PM. Large MOC imbalances create predictable price moves into the close. Trade the last 15 minutes.', '- Check closing imbalance at 3:45 PM ET
- Buy imbalance > 500K shares = bullish into close
- Sell imbalance > 500K shares = bearish into close
- Entry at 3:45-3:50 PM in direction of imbalance
- Price typically moves toward imbalance direction
- Quick trade: entry 3:45, exit at close or MOC
- No overnight hold required
- Best on index rebalance / options expiration days', 'Closing imbalances are the most predictable short-term trades in the market. Index funds, ETFs, and institutional rebalancing create massive order imbalances at the close. On rebalancing days, these can be >$2B. The price MUST adjust to fill these orders.', 73, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.816Z', '2026-04-10T00:27:47.437Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (100, 'MOC — Market On Close Order', 'MOC / Closing Auction', 'Другой', 'Use MOC (Market-On-Close) order to participate in the NYSE closing auction. Capture the closing print for next-day gap positioning.', '- MOC orders must be submitted by 3:45 PM ET (NYSE) or 3:50 PM (NASDAQ)
- Determine direction based on day''s trend (above/below VWAP)
- Size: 50% of normal for overnight risk
- MOC guarantees fill at official closing price
- Cannot cancel after 3:45 PM deadline
- Best for next-day catalyst plays (earnings AH, overnight events)
- Review closing imbalance data at 3:45 PM
- Set overnight stop-loss alert', 'MOC orders are used by institutions to execute at the closing price — the most important price of the day. For prop traders, MOC is useful when you want to hold overnight and want the best closing price without chasing.', 76, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.774Z', '2026-04-10T00:27:47.437Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (99, 'IMBX + VWAP Confirmation', 'Imbalance (IMBX) Strategies', 'Imbalance', 'Combine imbalance data with VWAP direction. When opening imbalance aligns with VWAP trend (stock opens above/below VWAP in same direction as imbalance), the signal is strongest.', '- Buy imbalance + stock above developing VWAP = strong long
- Sell imbalance + stock below developing VWAP = strong short
- Entry on first pullback to VWAP after open
- Volume must confirm direction
- Contradictory signals (buy imbalance but below VWAP) = no trade
- Stop: VWAP cross
- Target: prior day level or measured move
- This is a high-probability A+ setup when aligned', 'Combining two institutional signals (imbalance + VWAP) creates a high-probability setup. Institutions use both VWAP and auction data. When they agree, you''re aligned with smart money. When they contradict, stay flat.', 80, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.731Z', '2026-04-10T00:27:51.019Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (98, 'IMBX Fade — Imbalance Reversal', 'Imbalance (IMBX) Strategies', 'Imbalance', 'When opening imbalance is extreme but reverses by 9:28 AM, the initial move often reverses. Fade the expected direction.', '- Large imbalance at 9:20 (>1M shares one direction)
- By 9:28 AM imbalance reduces significantly or flips
- This signals the imbalance was absorbed / crossed
- Trade opposite the original imbalance direction
- Wait for open, then entry on reversal candle
- Small size (counter-trend play)
- Stop tight — opposite side of opening range
- Target: VWAP', 'Imbalance fades are advanced plays. When a large buy imbalance at 9:20 gets paired off by 9:28, it means the selling interest absorbed the demand. The opening may still pop up, but it quickly reverses. This is a trap for imbalance-only traders.', 58, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.688Z', '2026-04-10T00:27:51.019Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (97, 'IMBX — Opening Imbalance Short', 'Imbalance (IMBX) Strategies', 'Imbalance', 'Significant sell imbalance (IMBX > 500K shares on sell side) at 9:20 AM. Strong selling pressure expected at open. Short into the imbalance.', '- Sell imbalance > 500K shares at 9:20+ AM
- Confirm negative catalyst (earnings miss, downgrade)
- Entry via OPG short or first bounce after open
- Imbalance should be consistent and growing
- Watch 9:28 AM final imbalance (most reliable)
- Stop: if imbalance reverses significantly
- Target: morning low or gap fill
- Close by midday if not working', 'Sell imbalances create supply/demand asymmetry at the open. Institutions are net sellers and the opening price adjusts down. Key: the 9:28 AM imbalance is the most reliable — earlier readings can flip.', 74, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.645Z', '2026-04-10T00:27:51.019Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (96, 'IMBX — Opening Imbalance Long', 'Imbalance (IMBX) Strategies', 'Imbalance', 'NYSE/NASDAQ publish order imbalance data at 9:20 AM. Significant buy imbalance (IMBX > 500K shares) signals strong opening demand. Long into the imbalance.', '- Check imbalance data starting at 9:20 AM
- Buy imbalance > 500K shares = significant
- Confirm catalyst supports the direction
- Entry via OPG order or first pullback after open
- Imbalance should be consistent (not flipping)
- Watch for paired-off vs total imbalance ratio
- Stop: if imbalance reverses or VWAP breaks
- Target: morning high or prior resistance', 'Order imbalance data is public and published by exchanges. A large buy imbalance means there are significantly more buy orders than sell orders for the open. This creates upward pressure on the opening price. Prop firms monitor this data religiously.', 74, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.602Z', '2026-04-10T00:27:51.019Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (95, 'OPG Momentum — Opening Auction Breakout', 'OPG / Auction Plays', 'OPG', 'Use OPG to ride momentum when opening auction price will be significantly different from prior close. Follow the smart money flow.', '- Pre-market shows strong directional bias
- Imbalance data (if available) confirms direction
- Submit OPG in direction of momentum
- Immediately set stop after fill
- Target 1: first 5-min range extreme
- Target 2: VWAP or prior resistance/support
- Scale out in thirds
- Best on In Play stocks with catalyst', 'OPG momentum captures the institutional order flow at the open. When there''s a clear imbalance (more buy than sell orders), the opening price adjusts up and the momentum continues. Getting in at the auction = best possible entry.', 72, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.560Z', '2026-04-10T00:27:55.818Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (94, 'OPG Gap Fade — Auction Reversal', 'OPG / Auction Plays', 'OPG', 'Stock gaps significantly on weak catalyst. OPG order to fade the gap — enter opposite direction at the open, expecting gap fill.', '- Gap >3% but catalyst is weak or already priced in
- Pre-market volume is moderate (not extreme)
- No institutional upgrades/downgrades
- Submit OPG order to fade gap direction
- Size: 25-50% of normal
- Target: gap fill (prior close)
- Stop: beyond gap extreme +0.5%
- Time limit: close by lunch if not working', 'Fading gaps at the open is risky but statistically favorable when the catalyst is weak. The OPG order ensures you get the exact opening price. Key: only fade gaps with no fundamental reason. Earnings/FDA gaps should NOT be faded.', 68, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.517Z', '2026-04-10T00:27:55.818Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (93, 'OPG — Opening Price Guarantee Order', 'OPG / Auction Plays', 'OPG', 'Use OPG (Market-On-Open) order to participate in the NYSE/NASDAQ opening auction. Capture the opening print when catalyst is clear overnight.', '- Strong overnight catalyst (earnings, news, upgrade)
- Pre-market direction is clear and consistent
- Submit OPG order before 9:28 AM ET
- Size: 50% of normal (auction risk)
- OPG executes only at the opening print
- If no fill, order cancels automatically
- Review fill vs pre-market price
- Manage position from open', 'OPG orders guarantee you participate in the opening auction at the official opening price. This is how institutions enter positions. Advantage: no slippage from the open, you get the exact opening print. Best on gap days with clear catalyst.', 75, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:54:48.472Z', '2026-04-10T00:27:55.818Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (92, 'Max Loss Day Rule — Circuit Breaker', 'Trillium - Position Management', 'Другой', 'Hard daily loss limit. When reached, STOP TRADING. No exceptions. This is the most important risk management rule.', '- Set max daily loss (e.g., $500 or 2% of account)
- Track P&L in real-time
- At 50% of max loss: reduce size by half
- At 75% of max loss: only A+ setups
- At 100% of max loss: STOP. Walk away.
- Review losing trades end of day
- NO revenge trading
- Reset next day fresh', 'The max loss day rule is NON-NEGOTIABLE. Every prop firm enforces this. Without it, one bad day can destroy a month of profits. SMB Capital says: ''Live to trade another day.'' The market will be there tomorrow.', 95, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.707Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (91, 'Scaling Out — Tiered Profit Taking', 'Trillium - Position Management', 'Другой', 'Instead of all-or-nothing exits, scale out in tiers. Take 1/3 at first target, 1/3 at second, trail the rest.', '- Before entry: define 3 target levels
- Target 1 (1R): take 1/3 off, move stop to breakeven
- Target 2 (2R): take 1/3 off, trail stop
- Target 3 (3R+): trail remaining 1/3 with tight stop
- If stop hits before T1: full loss (acceptable)
- Result: winners are bigger, losers are controlled
- Track average R-multiple', 'Scaling out is a risk management technique that ensures you capture profits while keeping upside potential. The psychology: taking partial profits reduces the urge to close the entire position too early.', 85, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.668Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (90, 'Dollar Cost Into Winner — Pyramiding', 'Trillium - Position Management', 'Другой', 'When trade is working, add to the position (pyramid) at predetermined levels. Maximize winners, don''t just take profit.', '- Initial entry at planned level (full or partial)
- First add: after breakout confirms (price + volume)
- Second add: on first pullback that holds
- Each add is smaller than the previous
- Move stop to breakeven after first add
- Trail stop to lock in profits on adds
- Never add to losers
- Max position: 3 tiers', 'Pyramiding into winners is how prop traders maximize their best trades. SMB calls this ''pressing your winners.'' The key: each add must be smaller, and the stop must move up. Never average down — that''s the opposite of this strategy.', 80, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.629Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (89, 'CPI / Jobs Report — Morning Gap Framework', 'SMB Capital - Macro & Sector Plays', 'Другой', 'Major economic data (CPI, NFP, PPI) released at 8:30 AM ET. Creates significant gaps. Trade the gap framework after open.', '- Note data release at 8:30 AM (pre-market)
- Calculate gap vs expectations
- If data better than expected = bullish gap (usually)
- If data worse = bearish gap
- Wait for market open, don''t pre-market trade
- Apply Gap and Go or Gap Fill framework
- Sector impact: CPI → tech/growth, Jobs → financials
- Reduce size on macro days', 'Macro data days create the biggest moves because they affect ALL stocks simultaneously. CPI and jobs data move the entire market. Key: don''t trade the data, trade the reaction to the data. The same CPI number can be bullish or bearish depending on context.', 67, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.590Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (88, 'Fed Day / FOMC — 2:00 PM Reversal', 'SMB Capital - Macro & Sector Plays', 'Другой', 'FOMC announcement at 2:00 PM ET. Initial move often reverses. Wait for the ''whipsaw'' and trade the real direction.', '- No new positions before 2:00 PM on FOMC day
- Note initial reaction direction at 2:00 PM
- Wait 15-30 minutes for the ''whipsaw''
- If initial move reverses = trade the reversal
- If initial move continues with volume = trade continuation
- Reduce size (FOMC = volatile)
- Stop tight (FOMC moves are fast)
- Close all FOMC trades by end of day', 'FOMC days have a well-known pattern: initial spike at 2:00 PM, then reversal, then the ''real'' move. The initial reaction is often wrong because algorithms react to headlines before the full statement is analyzed. Patience is key.', 62, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.550Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (87, 'Sector Rotation — Follow the Money', 'SMB Capital - Macro & Sector Plays', 'Другой', 'Money rotates between sectors based on economic cycle. Identify which sectors are receiving inflows and trade the leaders.', '- Monitor sector ETF relative performance (XLF, XLE, XLK, etc.)
- Identify sector showing 3+ days of outperformance
- Find leading stocks within that sector
- Entry on pullback in the leading stock
- Confirm with sector ETF still trending
- Stop if sector rotation reverses
- Target: sector trend continuation', 'Sector rotation is driven by institutional portfolio rebalancing. When the economy shifts, trillions of dollars rotate. Early identification = riding the institutional wave. Track XL_ ETFs daily for rotation signals.', 72, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.511Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (86, 'Earnings Range Anticipation — Straddle Alternative', 'SMB Capital - Earnings Plays', 'Pre-Earnings Run', 'Anticipate the earnings range based on implied move. Trade the break of that range rather than guessing direction.', '- Calculate expected move from options (straddle price)
- Mark expected range (close +/- expected move)
- After earnings: if price exceeds expected range = continuation
- If price within expected range = mean reversion to close
- Entry on confirmation of scenario
- Stop based on expected range boundary
- Target: 1.5x expected move (if exceeded) or prior close (if within)', 'Instead of guessing earnings direction, this framework uses the options market''s expected move as a roadmap. When the actual move exceeds expectations, momentum is real. When it stays within, the move is priced in.', 50, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.471Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (85, 'Post-Earnings Drift (PEAD) — Follow Surprise', 'SMB Capital - Earnings Plays', 'Post-Earnings Continuation', 'After earnings surprise, stock continues drifting in the direction of the surprise for days/weeks. Trade the drift, not the gap.', '- Significant earnings surprise (>10% above/below estimates)
- Initial gap confirmed by volume
- Wait for first pullback (don''t chase the gap)
- Entry on pullback in direction of surprise
- Positive surprise: long pullback to VWAP/21EMA
- Negative surprise: short bounce to VWAP/21EMA
- Hold: 5-20 days
- Trail stop using 8 EMA daily', 'Post-Earnings Announcement Drift (PEAD) is one of the most well-documented anomalies in finance. Studies show stocks continue moving in the direction of the earnings surprise for 60+ days. The market underreacts to earnings surprises.', 74, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.432Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (84, 'Earnings Whisper — Pre-Earnings Position', 'SMB Capital - Earnings Plays', 'Pre-Earnings Run', 'Accumulate position before earnings when technical setup + whisper numbers suggest upside surprise. Small size for binary risk.', '- Earnings within 1-3 days
- Technical setup bullish (above MAs, tight range)
- Options IV < historical norm (cheap options)
- Whisper number higher than consensus
- Revenue growth trend positive
- Entry: small position (25-50% normal size)
- Define max loss BEFORE entry
- Exit plan for both scenarios', 'Pre-earnings positions are high-risk binary trades. SMB teaches: if you trade earnings, use reduced size and define your max loss before entry. The best risk/reward comes when options IV is below average — you''re getting paid less for the uncertainty.', 58, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.392Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (83, 'Fibonacci Retracement — Measured Pullback', 'SMB Capital — Swing Setups', 'Breakout', 'Stock in trend pulls back to key Fibonacci level (38.2%, 50%, 61.8%). Enter at Fib level with stop below next Fib.', '- Identify clear trend (impulse move)
- Draw Fibonacci from swing low to swing high (uptrend)
- Wait for pullback to 38.2%, 50%, or 61.8% level
- Look for reversal candle at Fib level
- Volume should decrease on pullback
- Entry on bounce from Fib with volume
- Stop below next Fib level
- Target: retest of prior high or 1.618 extension', 'Fibonacci levels are self-fulfilling because so many traders use them. The 61.8% level is especially powerful — it''s the ''golden ratio'' pullback. If price holds 61.8%, the trend is likely intact. Below 78.6% = trend likely failed.', 71, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.352Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (82, 'Moving Average Crossover — Trend Change', 'SMB Capital — Swing Setups', 'Другой', '8/21 EMA crossover on daily chart signals trend change. Enter in direction of the cross with swing time frame.', '- 8 EMA crosses above 21 EMA = bullish
- 8 EMA crosses below 21 EMA = bearish
- Volume confirms crossover
- Wait for pullback to 8 EMA after cross
- Entry on bounce off 8 EMA in crossover direction
- Stop: below 21 EMA
- Target: prior swing high/low or Fibonacci extension
- Hold: 5-20 days', 'EMA crossovers lag by nature but filter noise. The 8/21 combo captures trend changes faster than 50/200. Best used as a trend filter — take only long setups when 8>21, short setups when 8<21.', 63, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.312Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (81, 'Multi-Day Breakout — Weekly Range Expansion', 'SMB Capital — Swing Setups', 'Breakout', 'Stock breaks out of a weekly/monthly range on catalyst. Hold for multi-day measured move. Wider stops, bigger targets.', '- Tight weekly range (Bollinger Bands squeezing)
- Breakout on catalyst with volume >2x average
- Close above range high (weekly candle)
- Entry on pullback to breakout level
- Stop below breakout level (former resistance = new support)
- Target: measured move (range height added to breakout)
- Hold time: 3-15 days', 'Weekly range breakouts capture larger moves than intraday trades. The tight range = low volatility, which precedes high volatility (regime change). Best combined with fundamental catalyst.', 76, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.273Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (80, 'Exhaustion Gap — Reversal Signal', 'SMB Capital — Gap Plays', 'Gap', 'After an extended multi-day move, a final gap in the trend direction signals exhaustion. Trade the reversal.', '- Stock has moved >20% in one direction over 3-5 days
- Final gap in the same direction (up gap after rally, down gap after selloff)
- Volume highest of the entire move
- Intraday reversal candle forms (shooting star, doji)
- Entry on reversal confirmation
- Stop above/below exhaustion gap extreme
- Target: 38-50% retrace of entire move', 'Exhaustion gaps are one of the most reliable reversal signals in technical analysis. They represent the last burst of momentum before the trend reverses. Key identifier: the gap comes AFTER a multi-day move, not at the beginning.', 65, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.233Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (79, 'Gap and Trap — False Breakout', 'SMB Capital — Gap Plays', 'Gap', 'Stock gaps up through resistance but immediately sells off. The gap traps breakout buyers. Short the trapped longs as they panic.', '- Stock gaps above key resistance level
- First 15 minutes: selling pressure emerges
- Stock falls back below resistance (now support becomes resistance)
- Trapped longs begin to panic sell
- Entry short on break below gap low or key level
- Volume increases on the reversal
- Stop above gap high
- Target: prior support or gap fill', 'Gap and Trap is the opposite of Gap and Go. It works because breakout buyers get trapped when the gap fails. Their stop-loss selling accelerates the move down. Best when the gap is on weak catalyst or into major resistance.', 72, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.193Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (78, 'Gap Fill — Statistical Edge', 'SMB Capital — Gap Plays', 'Gap', 'Most gaps fill within 1-3 days (statistical tendency). Trade the gap fill when conditions support mean reversion back to prior close.', '- Gap without strong catalyst (earnings, FDA excluded)
- Gap size < 5% (large gaps less likely to fill same day)
- Pre-market volume normal (not elevated)
- If gap up: short toward prior close
- If gap down: long toward prior close
- Entry after first 15 min (avoid opening volatility)
- Stop beyond gap extreme
- Target: prior day close (full fill)', 'Statistical studies show ~70% of gaps eventually fill. However, catalyst-driven gaps (earnings, FDA) fill less often. Best gap fill trades are on ''nothing'' gaps — gap on no real news, just overnight drift.', 70, NULL, '[""]', NULL, NULL, NULL, '2026-04-09T23:43:21.154Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (77, 'Pairs Trade — Relative Value', 'Jane Street - Mean Reversion Plays', 'Другой', 'Two correlated stocks diverge. Long the underperformer, short the outperformer. Profit when the spread reverts to mean.', '- Identify correlated pair (same sector, similar business)
- Calculate historical spread (ratio or price difference)
- Wait for spread to reach 2+ StdDev from mean
- Long the laggard, short the leader (equal dollar amounts)
- Monitor correlation — if it breaks, exit
- Target: spread returns to mean
- Max hold: 5-10 days', 'Pairs trading is market-neutral — you profit from the relative move, not the absolute direction. Classic pairs: XOM/CVX, GOOGL/META, JPM/BAC. Risk: the correlation can break permanently (structural change).', 75, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.114Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (76, 'Rubber Band Snap — Extended Stock Reversal', 'Jane Street - Mean Reversion Plays', 'Reversal', 'Stock stretched far from VWAP or moving average like a rubber band. Trade the snap-back to the mean when momentum exhausts.', '- Stock >2% from VWAP (intraday) or >5% from 20MA (daily)
- Momentum indicators showing divergence
- Volume decreasing on the extension
- Candle pattern showing reversal (doji, hammer, engulfing)
- Entry on reversal confirmation
- Stop beyond the extreme
- Target: VWAP or moving average', 'The rubber band analogy: the further a stock stretches from its mean, the more energy is stored for the snap-back. Works best when the extension is on declining volume — showing exhaustion rather than genuine trend.', 68, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.074Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (75, 'Mean Reversion — Oversold Bounce', 'Jane Street - Mean Reversion Plays', 'Reversal', 'Stock drops >3 standard deviations from its mean (20-day MA). Statistical probability favors a bounce. Long the oversold condition.', '- Stock >3 StdDev below 20-day MA
- RSI < 20 on daily chart
- No fundamental catalyst for further downside
- Volume exhaustion (decreasing on sell-off)
- Entry on first green candle after selling exhaustion
- Stop below recent low
- Target: 20-day MA (mean)', 'Mean reversion works because extreme moves are statistically unsustainable. However, key filter: avoid stocks with ongoing fundamental deterioration (bankruptcy risk, fraud, etc.). Best on large-cap with temporary panic.', 72, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:21.035Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (74, 'Level 2 Spoofing Detection', 'Jane Street - Advanced Tape Reading', 'Другой', 'Detect spoofing on Level 2 — large orders that appear and disappear to manipulate price. Trade opposite the spoof direction.', '- Watch for large bid/ask orders that repeatedly cancel
- Spoof orders usually >50K shares on illiquid stocks
- Note if price moves toward the spoof, then spoof is removed
- Real orders get filled, spoof orders get cancelled
- If large bid keeps disappearing = fake support = bearish
- If large ask keeps disappearing = fake resistance = bullish
- Use tape confirmation before entry', 'Spoofing is illegal but still occurs, especially on small/mid cap stocks. Recognizing it gives you an edge because you understand which levels are real and which are fake. Key: real orders absorb volume, spoof orders run.', 60, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.995Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (73, 'Dark Pool Print — Hidden Liquidity', 'Jane Street - Advanced Tape Reading', 'Другой', 'Unusually large dark pool prints signal institutional interest. Trade in direction of the largest prints when they cluster at a price level.', '- Monitor dark pool print data (Finra ADF, TRF)
- Look for prints >100K shares
- Note price level where prints cluster
- If prints at/above ask = bullish
- If prints at/below bid = bearish
- Use as confirmation, not primary signal
- Combine with chart pattern for entry', 'Dark pools account for ~40% of US equity volume. Large institutional orders often execute there to avoid market impact. When you can see these prints, you''re seeing what smart money is doing.', 65, NULL, NULL, 'Dark Pool Print,Block Trade Follow,Tape Reading Entry,Dark Pool Level,Dark Pool Volume', NULL, NULL, '2026-04-09T23:43:20.956Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (72, 'Tape Reading — Order Flow Entry', 'Jane Street - Advanced Tape Reading', 'Другой', 'Read Level 2 / Time & Sales to identify institutional activity. Large prints, hidden orders, and bid/ask dynamics reveal intent.', '- Watch Time & Sales for large prints (>10K shares)
- Note bid/ask size imbalances on Level 2
- Look for iceberg orders (repeated same-size prints)
- Identify institutional accumulation vs distribution
- Entry when tape confirms your directional bias
- Stop if tape reading thesis is invalidated', 'Tape reading is the original edge. Before charts, traders read the tape. Large prints at the ask = buying pressure. Large prints at the bid = selling pressure. SMB Capital considers tape reading a core skill.', 78, NULL, NULL, 'Tape Reading Entry,Level 2 Entry,Dark Pool Print,Block Trade Follow,High Relative Volume', NULL, NULL, '2026-04-09T23:43:20.916Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (71, 'Overnight Hold — Swing Catalyst', 'Trillium - Pre-Market & After Hours', 'Другой', 'Hold position overnight when catalyst supports multi-day move. Reduce size for overnight risk. Set hard stop.', '- Catalyst supports multi-day move (earnings beat, FDA, M&A)
- Reduce position to 50% of intraday size
- Set hard stop (worst-case exit level)
- Calculate overnight gap risk
- Check after-hours liquidity
- Set pre-market alert for review
- Re-evaluate at next open', 'Overnight holds add gap risk but capture multi-day moves. Key rule: if you wouldn''t enter the position fresh at the close, don''t hold it overnight. Always reduce size.', 55, NULL, NULL, 'Swing Hold,Overnight Hold Gap,Multi-Day Momentum,Earnings Beat,FDA Approval', NULL, NULL, '2026-04-09T23:43:20.877Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (70, 'After Hours Earnings React — Next Day Prep', 'Trillium - Pre-Market & After Hours', 'Другой', 'Stock reports earnings after hours. Analyze reaction, prepare next-day game plan based on after-hours price action.', '- Note earnings results vs expectations
- Watch after-hours price reaction
- Identify key AH levels (high, low, close)
- Check options implied move vs actual
- Prepare bull/bear scenario for next day
- Set pre-market alerts', 'After-hours reaction to earnings often sets the tone for the next trading day. Preparing the night before gives you a significant edge over traders who react in real-time.', 70, NULL, NULL, 'Earnings Gap Up,Earnings Gap Down,Second Day Play,After Hours,Earnings Beat,Earnings Miss', NULL, NULL, '2026-04-09T23:43:20.837Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (69, 'Pre-Market Gap Scan — Watchlist Build', 'Trillium - Pre-Market & After Hours', 'Другой', 'Before market open (7:00-9:30 AM ET). Scan for stocks gapping >4% on catalyst. Build watchlist with levels, plan entries.', '- Scan at 7:00 AM for gaps >4%
- Check catalyst (earnings, news, upgrade/downgrade)
- Note pre-market volume (>500K = in play)
- Mark key levels: PM high, PM low, prior day close
- Calculate ATR for position sizing
- Rank top 3-5 stocks by catalyst quality
- Set alerts at key levels', 'The most important 30 minutes of the day happens before the market opens. Every successful prop trader starts with a thorough pre-market scan. This framework ensures you''re prepared, not reactive.', 85, NULL, NULL, 'Gap Up,Gap Down,Premarket,Premarket High,Premarket Low,High Relative Volume', NULL, NULL, '2026-04-09T23:43:20.798Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (68, 'MOC + Options Expiration — Pin Risk Play', 'Trillium - MOC / Closing Auction', 'Другой', 'On options expiration (monthly/weekly), stocks tend to ''pin'' to strike prices with maximum open interest. Trade the pin into the close.', '- Identify max pain / highest OI strike price
- After 2:00 PM on OPEX day, monitor price vs strike
- If stock near high-OI strike, expect pinning action
- Trade toward the pin strike (mean reversion to strike)
- MOC order at the pin strike if profitable
- Size small — pinning is not guaranteed
- Works best on large-cap with high options volume
- Close all positions at market close', 'Options expiration pinning occurs because market makers hedge their delta by buying/selling stock. As options expire, this hedging creates mean-reversion toward the highest open interest strike. This effect is strongest in the last 2 hours of OPEX day.', 62, NULL, NULL, 'MOC Imbalance,Closing Cross Play,Imbalance,OPEX Day,Last Hour,Round Number', NULL, NULL, '2026-04-09T23:43:20.676Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (67, 'MOC Fade — Closing Reversal', 'Trillium - MOC / Closing Auction', 'Другой', 'After an extreme closing imbalance pushes price, the next morning often sees a reversal. Fade the closing auction move at next open.', '- Large closing imbalance pushed price >0.5% in last 15 min
- The move was mechanical (rebalance) not fundamental
- Next day: fade the closing move direction
- Entry: at open or first 15 min of next day
- Target: prior day''s 3:45 PM price (pre-imbalance level)
- Stop: beyond closing price
- Works best on quarterly rebalance days
- Avoid if fundamental catalyst exists', 'Closing imbalances are mechanical — index funds MUST buy or sell regardless of price. This creates artificial moves that often reverse the next morning when the forced buying/selling is done. Key: only fade mechanical moves, not fundamental ones.', 60, NULL, NULL, 'MOC Imbalance,Closing Cross Play,Fade Trade,Reversal,Last Hour,Power Hour', NULL, NULL, '2026-04-09T23:43:20.637Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (66, 'MOC Imbalance — Closing Auction Play', 'Trillium - MOC / Closing Auction', 'Другой', 'NYSE publishes closing imbalance data at 3:45 PM. Large MOC imbalances create predictable price moves into the close. Trade the last 15 minutes.', '- Check closing imbalance at 3:45 PM ET
- Buy imbalance > 500K shares = bullish into close
- Sell imbalance > 500K shares = bearish into close
- Entry at 3:45-3:50 PM in direction of imbalance
- Price typically moves toward imbalance direction
- Quick trade: entry 3:45, exit at close or MOC
- No overnight hold required
- Best on index rebalance / options expiration days', 'Closing imbalances are the most predictable short-term trades in the market. Index funds, ETFs, and institutional rebalancing create massive order imbalances at the close. On rebalancing days, these can be >$2B. The price MUST adjust to fill these orders.', 73, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.596Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (65, 'MOC — Market On Close Order', 'Trillium - MOC / Closing Auction', 'Другой', 'Use MOC (Market-On-Close) order to participate in the NYSE closing auction. Capture the closing print for next-day gap positioning.', '- MOC orders must be submitted by 3:45 PM ET (NYSE) or 3:50 PM (NASDAQ)
- Determine direction based on day''s trend (above/below VWAP)
- Size: 50% of normal for overnight risk
- MOC guarantees fill at official closing price
- Cannot cancel after 3:45 PM deadline
- Best for next-day catalyst plays (earnings AH, overnight events)
- Review closing imbalance data at 3:45 PM
- Set overnight stop-loss alert', 'MOC orders are used by institutions to execute at the closing price — the most important price of the day. For prop traders, MOC is useful when you want to hold overnight and want the best closing price without chasing.', 76, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.557Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (64, 'IMBX + VWAP Confirmation', 'Jane Street - Imbalance (IMBX) Strategies', 'Imbalance', 'Combine imbalance data with VWAP direction. When opening imbalance aligns with VWAP trend (stock opens above/below VWAP in same direction as imbalance), the signal is strongest.', '- Buy imbalance + stock above developing VWAP = strong long
- Sell imbalance + stock below developing VWAP = strong short
- Entry on first pullback to VWAP after open
- Volume must confirm direction
- Contradictory signals (buy imbalance but below VWAP) = no trade
- Stop: VWAP cross
- Target: prior day level or measured move
- This is a high-probability A+ setup when aligned', 'Combining two institutional signals (imbalance + VWAP) creates a high-probability setup. Institutions use both VWAP and auction data. When they agree, you''re aligned with smart money. When they contradict, stay flat.', 80, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.517Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (63, 'IMBX Fade — Imbalance Reversal', 'Jane Street - Imbalance (IMBX) Strategies', 'Imbalance', 'When opening imbalance is extreme but reverses by 9:28 AM, the initial move often reverses. Fade the expected direction.', '- Large imbalance at 9:20 (>1M shares one direction)
- By 9:28 AM imbalance reduces significantly or flips
- This signals the imbalance was absorbed / crossed
- Trade opposite the original imbalance direction
- Wait for open, then entry on reversal candle
- Small size (counter-trend play)
- Stop tight — opposite side of opening range
- Target: VWAP', 'Imbalance fades are advanced plays. When a large buy imbalance at 9:20 gets paired off by 9:28, it means the selling interest absorbed the demand. The opening may still pop up, but it quickly reverses. This is a trap for imbalance-only traders.', 58, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.477Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (62, 'IMBX — Opening Imbalance Short', 'Jane Street - Imbalance (IMBX) Strategies', 'Imbalance', 'Significant sell imbalance (IMBX > 500K shares on sell side) at 9:20 AM. Strong selling pressure expected at open. Short into the imbalance.', '- Sell imbalance > 500K shares at 9:20+ AM
- Confirm negative catalyst (earnings miss, downgrade)
- Entry via OPG short or first bounce after open
- Imbalance should be consistent and growing
- Watch 9:28 AM final imbalance (most reliable)
- Stop: if imbalance reverses significantly
- Target: morning low or gap fill
- Close by midday if not working', 'Sell imbalances create supply/demand asymmetry at the open. Institutions are net sellers and the opening price adjusts down. Key: the 9:28 AM imbalance is the most reliable — earlier readings can flip.', 74, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.438Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (61, 'IMBX — Opening Imbalance Long', 'Jane Street - Imbalance (IMBX) Strategies', 'Imbalance', 'NYSE/NASDAQ publish order imbalance data at 9:20 AM. Significant buy imbalance (IMBX > 500K shares) signals strong opening demand. Long into the imbalance.', '- Check imbalance data starting at 9:20 AM
- Buy imbalance > 500K shares = significant
- Confirm catalyst supports the direction
- Entry via OPG order or first pullback after open
- Imbalance should be consistent (not flipping)
- Watch for paired-off vs total imbalance ratio
- Stop: if imbalance reverses or VWAP breaks
- Target: morning high or prior resistance', 'Order imbalance data is public and published by exchanges. A large buy imbalance means there are significantly more buy orders than sell orders for the open. This creates upward pressure on the opening price. Prop firms monitor this data religiously.', 74, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.398Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (60, 'OPG Momentum — Opening Auction Breakout', 'Trillium - OPG / Auction Plays', 'OPG', 'Use OPG to ride momentum when opening auction price will be significantly different from prior close. Follow the smart money flow.', '- Pre-market shows strong directional bias
- Imbalance data (if available) confirms direction
- Submit OPG in direction of momentum
- Immediately set stop after fill
- Target 1: first 5-min range extreme
- Target 2: VWAP or prior resistance/support
- Scale out in thirds
- Best on In Play stocks with catalyst', 'OPG momentum captures the institutional order flow at the open. When there''s a clear imbalance (more buy than sell orders), the opening price adjusts up and the momentum continues. Getting in at the auction = best possible entry.', 72, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.359Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (59, 'OPG Gap Fade — Auction Reversal', 'Trillium - OPG / Auction Plays', 'OPG', 'Stock gaps significantly on weak catalyst. OPG order to fade the gap — enter opposite direction at the open, expecting gap fill.', '- Gap >3% but catalyst is weak or already priced in
- Pre-market volume is moderate (not extreme)
- No institutional upgrades/downgrades
- Submit OPG order to fade gap direction
- Size: 25-50% of normal
- Target: gap fill (prior close)
- Stop: beyond gap extreme +0.5%
- Time limit: close by lunch if not working', 'Fading gaps at the open is risky but statistically favorable when the catalyst is weak. The OPG order ensures you get the exact opening price. Key: only fade gaps with no fundamental reason. Earnings/FDA gaps should NOT be faded.', 68, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.319Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (58, 'OPG — Opening Price Guarantee Order', 'Trillium - OPG / Auction Plays', 'OPG', 'Use OPG (Market-On-Open) order to participate in the NYSE/NASDAQ opening auction. Capture the opening print when catalyst is clear overnight.', '- Strong overnight catalyst (earnings, news, upgrade)
- Pre-market direction is clear and consistent
- Submit OPG order before 9:28 AM ET
- Size: 50% of normal (auction risk)
- OPG executes only at the opening print
- If no fill, order cancels automatically
- Review fill vs pre-market price
- Manage position from open', 'OPG orders guarantee you participate in the opening auction at the official opening price. This is how institutions enter positions. Advantage: no slippage from the open, you get the exact opening print. Best on gap days with clear catalyst.', 75, NULL, NULL, NULL, NULL, NULL, '2026-04-09T23:43:20.279Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (57, 'Power Hour Momentum — 3:00–4:00 PM', 'SMB Capital — Intraday Setups', 'Intraday Momentum', 'Last hour of trading (3:00-4:00 PM). Institutions execute large orders, creating momentum. Trade in direction of the day''s trend.', '- Identify day''s trend (above/below VWAP)
- Wait until 3:00 PM
- Look for volume increase (institutional activity)
- Long if above VWAP all day, Short if below
- Entry on pullback within the trend
- Stop: VWAP cross
- Target: close of day or trailing stop', 'Power hour is when institutions execute their remaining orders for the day. This creates volume and momentum. SMB teaches that the last hour often mirrors the first hour in terms of direction and opportunity.', 68, NULL, NULL, 'Intraday Momentum,VWAP Trend,Trend Continuation,Power Hour,Last Hour,VWAP', NULL, NULL, '2026-04-09T23:34:22.819Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (56, 'In Play Stock Framework — Отбор акций', 'SMB Capital — Frameworks', 'Другой', 'Framework for identifying ''In Play'' stocks — stocks that will have the most opportunity for day traders on a given day.', '- Fresh catalyst (earnings, FDA, news) within 24 hours
- Gap > 4% (up or down)
- Pre-market volume > 500K shares
- Relative volume > 2x average
- ATR > $2 (enough range to trade)
- Float < 100M preferred
- Not in a halt or pending news
- Check sector (is the whole sector moving?)', 'The In Play framework is the foundation of SMB Capital''s methodology. Before trading any setup, the stock must be ''In Play'' — meaning it has a catalyst, volume, and range to create opportunity. Without In Play status, setups have much lower probability.', 90, NULL, NULL, 'Gap Up,Gap Down,High Relative Volume,Volume Spike,Breaking News,Earnings Beat', NULL, NULL, '2026-04-09T23:34:22.778Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (55, 'News Fade — Sell/Short the News', 'SMB Capital — Reversal Setups', 'Reversal', 'Stock spikes on news but the news is already priced in or overhyped. Fade the initial move as it reverses.', '- News event causes spike (upgrade, product launch, partnership)
- Assess if news is truly new or already expected
- Wait for first signs of reversal (red candle, volume shift)
- Entry on break of initial spike candle low
- Stop above spike high
- Target: pre-news price or VWAP', '''Buy the rumor, sell the news'' — one of the oldest market principles. SMB teaches to identify when news is already priced in by checking: pre-news price action, options activity, and whether the move is proportional to the catalyst.', 66, NULL, NULL, 'Fade Trade,News Spike Fade,Reversal,Short,Breaking News,Analyst Upgrade,VWAP', NULL, NULL, '2026-04-09T23:34:22.741Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (54, 'High of Day Break — Momentum Ignition', 'SMB Capital — Intraday Setups', 'Breakout', 'Stock consolidates near HOD then breaks to new highs. This ''momentum ignition'' triggers stops and algorithms, creating a powerful move.', '- Stock near HOD with tightening range
- At least 2-3 tests of HOD level
- Volume building on each test
- Entry on break above HOD with volume surge
- Stop below consolidation / last pullback low
- Target: next resistance or measured move', 'HOD breaks are powerful because they trigger: 1) Buy stops from shorts, 2) Momentum algorithms, 3) Breakout traders. The combination creates a supply/demand imbalance that drives price higher quickly.', 73, NULL, NULL, 'Breakout,Momentum Ignition,HOD,Flat Top Breakout,Volume Spike,High Relative Volume,Trending Day', NULL, NULL, '2026-04-09T23:34:22.705Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (53, 'Dead Cat Bounce — Short the Recovery', 'SMB Capital — Short Setups', 'Reversal', 'Stock drops sharply on bad news (earnings miss, downgrade). A weak bounce follows. Short the failed bounce.', '- Stock dropped >10% on negative catalyst
- Weak bounce: low volume, doesn''t reclaim VWAP
- Bounce reaches resistance (prior support, moving average)
- Entry on reversal from bounce high
- Stop above bounce high
- Target: retest of lows or new low', 'Dead cat bounces occur because: 1) Short covering, 2) Bottom fishers, 3) Algorithmic mean reversion. These bounces typically fail because the fundamental damage is real. SMB shorts these aggressively.', 68, NULL, NULL, 'Dead Cat Bounce,Reversal,Fade Trade,Short,Earnings Miss,Analyst Downgrade,VWAP,Daily Resistance', NULL, NULL, '2026-04-09T23:34:22.668Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (52, '9 EMA Daily — Swing Entry на Trend', 'SMB Capital — Swing Setups', 'Breakout', 'Stock in strong uptrend pulls back to 9 EMA on daily chart. This is the ''trend pullback'' entry for swing traders.', '- Stock in clear uptrend (higher highs, higher lows)
- Pullback to 9 EMA daily (within 1-2% of EMA)
- Volume decreases on pullback
- Entry on bounce off 9 EMA with volume
- Stop: below 9 EMA or recent swing low
- Target: prior high or measured move
- Hold time: 2-10 days', 'The 9 EMA daily is SMB''s favorite swing setup. It works because strong stocks rarely pull back more than 3-5 days before continuing. The 9 EMA captures this rhythm perfectly.', 74, NULL, NULL, 'Pullback Trade,Swing Hold,Trend Continuation,EMA9,Daily Support,Trending Day', NULL, NULL, '2026-04-09T23:34:22.631Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (51, 'Anchored VWAP — Earnings / IPO Level', 'SMB Capital — Intraday Setups', 'Breakout', 'Anchored VWAP from significant event (earnings, IPO, offering) acts as key support/resistance. Trade the reaction at this level.', '- Identify significant event date (earnings, IPO, offering)
- Calculate anchored VWAP from that date
- Wait for price to reach anchored VWAP level
- Look for reaction (bounce or break)
- Entry on confirmation of direction
- Stop: other side of anchored VWAP
- Target: next significant level', 'Anchored VWAP shows the average price paid by all participants since a significant event. Institutions track this level closely. It''s especially powerful from earnings dates and IPO dates.', 70, NULL, NULL, 'VWAP Bounce,VWAP Rejection,Breakout,Anchored VWAP,Earnings Beat,IPO Stock,Daily Support,Daily Resistance', NULL, NULL, '2026-04-09T23:34:22.594Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (50, 'Halt & Resume Play', 'SMB Capital — Intraday Setups', 'Другой', 'Stock gets halted (LULD halt or news halt). Trade the resume — either continuation or reversal depending on context.', '- Note halt type (LULD up/down, news pending)
- During halt: assess catalyst, level 2, pre-halt momentum
- On resume: wait 30 seconds for price discovery
- If continuation: long above halt price (up halt) or short below (down halt)
- If reversal: opposite direction after failed continuation
- Use small size — halts = maximum volatility
- Stop: opposite side of resume range', 'Halt resumes are some of the highest-volatility moments in trading. SMB teaches discipline: don''t place orders during halt, wait for resume, let price discover, then act. Many traders get destroyed by blindly buying/shorting halts.', 65, NULL, NULL, 'Halt & Resume,Breakout,Reversal,High Relative Volume,Volume Spike,High Volatility', NULL, NULL, '2026-04-09T23:34:22.548Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (49, 'Sympathy Play — Sector Follower', 'SMB Capital — Momentum Setups', 'Intraday Momentum', 'When a sector leader makes a big move, other stocks in the same sector often follow (sympathy move). Trade the follower.', '- Identify the sector leader making the move
- Find related stocks in same sector/industry
- Sympathy stock should have its own catalyst or setup
- Entry on breakout or momentum confirmation
- Don''t chase — wait for your setup
- Stop based on the sympathy stock''s chart, not the leader
- Target: proportional move to leader', 'Sympathy plays are a staple of prop trading. When NVDA moves, watch AMD, AVGO, MU. When one biotech gets FDA approval, watch similar pipeline companies. Key: the leader goes first, sympathies follow with a delay.', 60, NULL, NULL, 'Sympathy Play,Sector Rotation Play,Intraday Momentum,Breakout,Sector Leading,Sector Rotation', NULL, NULL, '2026-04-09T23:34:22.511Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (48, 'Short Squeeze Play', 'SMB Capital — Momentum Setups', 'Intraday Momentum', 'High short interest stock (>20%) gets a catalyst. Short sellers forced to cover, creating buying pressure and rapid price increase.', '- Short interest > 20% of float
- Catalyst (earnings beat, news, upgrade)
- Pre-market gap up with high volume
- Entry on first pullback after initial squeeze
- Monitor short interest data / borrow rates
- Tight stop (if squeeze fails, reversal is sharp)
- Target: prior resistance levels from weekly chart', 'Short squeezes are unpredictable. SMB teaches to trade them small and respect the volatility. The best squeezes happen when fundamental catalyst + high short interest + low float combine.', 55, NULL, NULL, 'Short Squeeze,Intraday Momentum,Breakout,High Short Interest (>20%),High Relative Volume,Volume Spike,Gap Up', NULL, NULL, '2026-04-09T23:34:22.475Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (47, 'Failed Follow Through — Bear Flag Short', 'SMB Capital — Short Setups', 'Reversal', 'Stock had a big move up but fails to follow through. Forms a bear flag (weak bounce on low volume). Short the breakdown of the flag.', '- Prior move up on Day 1
- Day 2/3: weak bounce, low volume
- Bear flag pattern forms (lower highs)
- Entry on break below flag support
- Volume increases on breakdown
- Stop above flag high
- Target: measured move down (flag pole)', 'Failed follow-through is the opposite of the Second Day Play. When momentum should continue but doesn''t, it''s a powerful reversal signal. SMB uses this as one of their primary short setups.', 73, NULL, NULL, 'Failed Follow Through,Bear Flag,Reversal,Dead Cat Bounce,Short,Yesterday High,Low Volume', NULL, NULL, '2026-04-09T23:34:22.437Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (46, 'Low Float Momentum — Float Rotation', 'SMB Capital — Intraday Setups', 'Intraday Momentum', 'Low float stock (<20M shares) with catalyst. When volume > float (float rotation), momentum can carry the stock much further than expected.', '- Float < 20M shares
- Catalyst (earnings, news, FDA)
- Volume approaching or exceeding float
- Stock making new HOD with increasing volume
- Entry on pullback or flag break
- Small size (low float = volatile)
- Stop: prior consolidation low', 'Float rotation = when the entire float has traded hands. At this point, there are no more ''trapped'' sellers and the stock can run much further. Key metric: volume/float ratio.', 60, NULL, NULL, 'Intraday Momentum,Runner,Breakout,Bull Flag,Low Float (<10M),Extremely Low Float (<2M),High Relative Volume,Volume Spike', NULL, NULL, '2026-04-09T23:34:22.400Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (45, 'Opening Range Breakout (ORB)', 'SMB Capital — Intraday Setups', 'Breakout', 'First 5/15/30 minute range establishes. Trade the breakout above the high or breakdown below the low of that range.', '- Define opening range (5min, 15min, or 30min)
- Wait for range to complete
- Long above range high / Short below range low
- Volume must confirm breakout (> average)
- Stop: opposite side of range or midpoint
- Target: 1:1 then trail', 'ORB is a bread-and-butter SMB setup. The opening range captures the battle between buyers and sellers. When one side wins (breakout), the move can be powerful. Best on days with catalyst.', 72, NULL, NULL, 'ORB,ORB 5min,ORB 15min,Breakout,Opening Range High,Opening Range Low,First 15min,First 30min,Volume Spike', NULL, NULL, '2026-04-09T23:34:22.364Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (44, 'Parabolic Short — Extended Stock', 'SMB Capital — Short Setups', 'Reversal', 'Stock goes parabolic (vertical move up 30%+ intraday). Short the blow-off top when momentum exhausts.', '- Stock up >30% intraday on low/mid float
- Parabolic arc visible on 1-min chart
- Wait for first red candle after vertical move
- Volume climax (highest volume candle of the day)
- Entry on break of first red candle low
- Stop above high of day
- Target: VWAP or 50% retrace', 'High risk / high reward. SMB teaches strict rules: NEVER short into strength. Wait for the first crack. Use small size. The blow-off top often comes with a volume climax — that''s your signal.', 65, NULL, NULL, 'Parabolic Short,Blow-Off Top Short,Exhaustion Short,Reversal,HOD,Low Float (<10M),High Relative Volume,Volume Spike', NULL, NULL, '2026-04-09T23:34:22.327Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (43, 'VWAP Trend Trade — Intraday', 'SMB Capital — Intraday Setups', 'Intraday Momentum', 'Stock trends above/below VWAP all day. Trade pullbacks to VWAP in direction of the trend. Long if above, short if below.', '- Clear trend direction established by 10:00 AM
- Stock respects VWAP as support (uptrend) or resistance (downtrend)
- Entry on pullback to VWAP with volume dry-up
- Stop: VWAP cross (close below for longs, above for shorts)
- Trail stop using rising/falling VWAP', 'VWAP is the institutional benchmark. When a stock trends above VWAP, institutions are net buyers. When below, net sellers. This creates a self-reinforcing cycle.', 75, NULL, NULL, 'VWAP Trend,VWAP Bounce,VWAP Hold Long,Pullback Trade,Intraday Momentum,VWAP,Trending Day', NULL, NULL, '2026-04-09T23:34:22.289Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (42, 'Second Day Play — Momentum Continuation', 'SMB Capital — Gap Plays', 'Second Day Play', 'Stock had a big move Day 1 (earnings, news, IPO). Day 2 continuation trade — long above Day 1 high or short below Day 1 low.', '- Day 1 move was >10% on catalyst
- Pre-market shows continuation interest
- Entry above Day 1 high (long) or below Day 1 low (short)
- Volume confirmation needed
- Stop: Day 1 close or VWAP
- Target: measured move from Day 1 range', 'Second Day Play is one of SMB''s signature setups. The idea: momentum from Day 1 carries into Day 2. Best when the catalyst is fundamental (earnings, FDA) rather than technical.', 70, NULL, NULL, 'Second Day Play,Trend Continuation,Breakout,Gap Up,HOD,Yesterday High,High Relative Volume', NULL, NULL, '2026-04-09T23:34:22.251Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (41, 'IPO Day Trade — First Day Play', 'SMB Capital — IPO Plays', 'IPO Day Trade', 'First day of trading for IPO. Wait for opening range to establish (first 5-15 min), then trade the breakout or breakdown.', '- IPO with significant hype/demand
- Wait for opening print and first range
- Don''t trade first 5 minutes
- Long above opening range high OR short below opening range low
- Use half size (IPO = volatile)
- Stop: middle of opening range', 'SMB teaches patience on IPO day 1. The opening range is key. Many traders get chopped trying to trade the first 5 minutes. Wait for the range, then trade the break.', 60, NULL, NULL, 'IPO Trade,ORB,Breakout,Opening Range High,Opening Range Low,IPO Stock,Recent IPO (<6mo),High Relative Volume', NULL, NULL, '2026-04-09T23:34:22.214Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (40, 'Gap and Go — Earnings Momentum', 'SMB Capital — Gap Plays', 'Earnings Gap Up', 'Stock gaps up >5% on strong earnings. Follow-through buying in first 30 minutes. Long continuation above opening range.', '- Earnings beat expectations significantly
- Gap > 5% with volume > 2x average
- Stock holds above VWAP in first 15 min
- Entry on first pullback to VWAP or opening range high break
- Stop below VWAP or opening range low
- Target: prior resistance levels', 'Classic SMB play. The key is waiting for the first pullback rather than chasing the gap. Quality of earnings matters — revenue growth > EPS beats.', 75, NULL, NULL, 'Gap and Go,Earnings Gap Up,ORB,Trend Continuation,Earnings Beat,Revenue Beat,VWAP,Opening Range High,High Relative Volume', NULL, NULL, '2026-04-09T23:34:22.177Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (39, 'Pricing Play — Long Bounce', 'SMB Capital — Offering Plays', 'Reversal', 'After offering is priced (usually after hours), stock often gaps down to or below offering price. Long bounce off offering price level.', '- Offering priced (press release confirms price)
- Stock trades at or below offering price
- Volume confirms capitulation
- Entry near offering price with tight stop
- Target: VWAP or prior support turned resistance', 'Offering price acts as strong support because institutions bought at that level. They defend their position. Key risk: if offering price breaks, there''s no floor.', 65, NULL, NULL, 'Offering Play,Post-Offering Bounce,Reversal,VWAP Bounce,Offering,Pricing,Offering Price', NULL, NULL, '2026-04-09T23:34:22.140Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (38, 'ATM Offering Play — Short', 'SMB Capital — Offering Plays', 'Другой', 'Stock announces ATM offering (shelf registration). Price drops on dilution fear. Short into the bounce after initial panic selling.', '- ATM offering confirmed (SEC filing)
- Price dropped >5% on news
- Volume spike > 3x average
- Wait for first bounce attempt
- Entry on failed bounce / rejection at VWAP
- Stop above pre-market high', 'One of SMB Capital''s core plays. ATM offerings create sustained selling pressure as the company sells shares into the open market. Key: don''t short the initial drop, wait for the bounce attempt and short the failure.', 80, NULL, NULL, 'Offering Play,ATM Offering,Fade Trade,VWAP Rejection,Offering,ATM,S-1 Filing,High Relative Volume,Volume Spike', NULL, NULL, '2026-04-09T23:34:22.098Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (37, 'MSFT', 'Short Setups', 'Reversal', NULL, NULL, NULL, 70, 'https://www.tradingview.com/x/rmUTqjFd/', '[""]', 'Gap Up, Reversal, Retest', NULL, NULL, '2026-04-09T20:50:27.510Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (36, 'IGV', 'Short Setups', 'Reversal', '- Можно брать перед открытием, если weak open
- Короткий стоп (закладывать перезаход, возможен вынос стопов)

', NULL, NULL, 70, 'https://www.tradingview.com/x/6SsOSEI4/', '["IGV"]', 'Gap Up, Breakout, News, Sector Move, SMA50, Sector Weak, Reversal, Trend Continuation, Liquidity Sweep, Analyst Action, Relative Weakness, Open Price, High Volatility, News Risk, gap up', NULL, NULL, '2026-04-09T20:32:47.115Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (35, 'XOM, CVX, CNQ, BP, SHEL, EQNR, COP macro (2026-04-08)', 'News Trupm', NULL, 'Новость о перемирие США и Иран на две недели', NULL, 'Реакция: gap_down
Движение: -3%', NULL, 'https://www.tradingview.com/x/TZQz4RJK/
https://www.tradingview.com/x/S6QMUxHa/
https://www.tradingview.com/x/UfXA2Yeu/
https://www.tradingview.com/x/UfXA2Yeu/
https://www.tradingview.com/x/qDYXXLky/
https://www.tradingview.com/x/4coYBSFp/
https://www.tradingview.com/x/jl3X9X2v/', '["","","","","","",""]', 'Gap Down, News, Sector Move', 'event', 9, '2026-04-09T20:16:14.983Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (34, 'Pricing strategy', 'Pricing', 'Другой', 'Выше цены прайсинга
Объем на премаркете 
Акция показывает силу на премаркете
', 'Объявление цены прайсинга на хаях а не на лаях
Gap down (это нормально для прайсинга)
Акция торговалась выше цены прайсинга', NULL, 70, 'https://www.tradingview.com/x/Wi3MRLsU/', '["SPIR\nПрайсинг объявили на хаях\nАкция показывает силу на премаркете\nТорговалась выше цены прайсинга\nGap down -14.5%\nPremarket Volume: 1,2 M"]', 'Gap Down, Pricing, Reversal, VWAP, Imbalance, OPG, Relative Strength', NULL, NULL, '2026-04-09T19:49:52.648Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (33, 'XOM, CVX, CNQ, BP ,SHEL, EQNR ,COP  macro (2026-04-08)', 'News Trupm', NULL, NULL, 'Гэп > 5%
На премаркете показывают слабость 

', 'Новость о перемирие США и Иран на две недели
Реакция: gap_down
И с открытие все падали первые 5 минут 
потом начали расти и в итоге закрылись на хаях ', 70, NULL, '[""]', 'Gap Down, News, Sector Move', 'event', 9, '2026-04-09T19:32:10.298Z', '2026-04-09T20:16:24.517Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (32, 'AEHR', '2 Day long', 'Second Day Play', NULL, 'Volume 50k
', 'Вышла новость об офферинге что потенциально сильный негатив для 2 day long AEHR — офферинг (очень коротко)
Объявили ATM размещение до $60 млн
Будут продавать акции постепенно по рынку
Смысл:
➝ Дилюция → давление вниз (short bias)
➝ Не жесткий слив, а растянутый
Вывод:

👉 Новость медвежья краткосрок
👉 Смотри реакцию: держат цену = сильный спрос, падает = чистый шорт', 70, 'https://www.tradingview.com/x/TZQz4RJK/', '["AEHR"]', 'Offering, Second Day, All Time High, Market Weak, High Volatility, News Risk', NULL, NULL, '2026-04-09T17:24:07.837Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (31, 'AEHR', '2 Day long', 'Second Day Play', NULL, NULL, NULL, 60, 'https://www.tradingview.com/x/cvgoOjx3/', '["AEHR"]', 'Gap Up, Breakout, Trend Continuation, Second Day, Earnings, Offering, All Time High, Market Weak', NULL, NULL, '2026-04-09T17:12:29.594Z', '2026-04-09T17:24:17.134Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (30, 'INTC', 'NEWS, partnership', 'Breakout', NULL, NULL, NULL, 60, 'https://www.tradingview.com/x/wEWpA20D/', '[""]', 'Gap Down, News', NULL, NULL, '2026-04-09T15:50:38.555Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (29, 'AEHR', 'Earning gap up, break out all time high', 'Earnings Gap Up', 'Day, above open, stop day low.', 'GAP 6%
615K volume 9:29
imbx 30k Влиял.
All time high 

', 'Можно было брать от VWAP', 70, 'https://www.tradingview.com/x/6lORAEpX/', '["AEHR"]', 'Earnings Gap Up, Gap Up, Breakout, Liquidity Sweep, Trend Continuation, Flag, Earnings, All Time High, Relative Strength, Market Weak, High Volatility', NULL, NULL, '2026-04-09T15:36:27.607Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (28, 'PLTR other (2026-04-09)', '2 day Gap down Short', 'other', '2 day short, пробил локальную недельную поддержку, под вчерашнем закрытием рядом с лоем вчерашнего дня буду брать опг to day', 'R.Volume 1.8 First day
Premarket Volume before open 2.5kk
Weak Premarket
Weak open
Under Yesterday close
8:30 already below premarket
IGV, Sector weak.
TP, 1/2 first day move', 'Что сработало: Перед открытием уже началось падение.
Стопы не выбивало, Идеальная твх за 30-15 мин перед открытием, не реагировала на рынок
Вывод: Можно было закладывать больший риск, и покрывать частями и ждать, так же в процессе давала шансы добрать
', 70, 'https://www.tradingview.com/x/0BVXZ0qL/', '["PLTR"]', 'Gap Down, Breakout, Liquidity Sweep, Sector Move, Yesterday Low, Yesterday Close, Open Price, Daily Support, Market Weak, High Volatility, Sector Weak', 'trade', 87, '2026-04-09T15:23:59.387Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (1, 'Healthcare (2026-04-07)', 'Sector Move', NULL, 'Рыночная тема: Healthcare', NULL, 'Акции крупных медицинских страховщиков — UnitedHealth, Humana и CVS Health — выросли на 6–10% в ходе предпродовой сессии после того, как CMS объявила о повышении выплат по программе Medicare Advantage на 2,48% в 2027 году. Это показатель оказался лучше ожиданий рынка, особенно на фоне того, что в начале года предложенная надбавка в 0,99% уже обвалила акции UnitedHealth почти на 20% за один день.
Тикеры: UNH, CVS, HUM, CNC, MOH', NULL, 'https://www.tradingview.com/x/Kx08uyL8/
https://www.tradingview.com/x/RoAZqVUP/
https://www.tradingview.com/x/YlaCWNQE/
https://www.tradingview.com/x/83k2rYJq/
https://www.tradingview.com/x/aq07OYla/', '["UNH, Принт по гепу, рисовки в маркет превратились","CVS, Принт против гепа.","HUM, Принт против гепа.","CNC, Принт flat.","MOH, Принт против гепа."]', 'Reversal, Gap Up, Breakout, News, Sector Move, Relative Strength, Wide Spread, High Volatility, News Risk, Market Weak', 'dailyfeed', 17, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (22, 'Earnings Gap Up — First Pullback Long', 'SMB Capital - Earnings Plays', 'Earnings Gap Up', 'Gap up >5% на отчётности с beat по EPS и revenue
Объём premarket >500K shares
Ключевые уровни: вчерашний high, pre-market high, whole/half dollars
Катализатор чистый — guidance raised или beat >10%
Нет значимого сопротивления в первые $2-3 от открытия', '- EPS beat >5%
- Revenue beat >3%
- Guidance raised или не снижен
- Premarket volume >500K
- Gap >5% от close
- Float <100M (идеально <30M)
- Нет earnings peer в тот же день
- Risk/Reward минимум 3:1
- Стоп под VWAP или low первого 5-мин бара', 'SMB Capital core setup. Ждём первый откат к VWAP или rising 9 EMA на 1-мин после opening drive. Вход на hold VWAP с тейком на новый HOD. Ключ — скорость recovery после pullback. Если recovery медленная (>3 мин), пропускаем.

Лучшие дни: вторник-четверг. Избегать в дни FOMC/CPI.

Trades to study: CELH earnings Aug 2023, SMCI earnings Jan 2024, ONON earnings multiple.', 90, NULL, NULL, 'earnings, gap-up, momentum, A+', NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T11:31:38.969Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (21, 'Earnings Gap Down — Short the Failed Bounce', 'SMB Capital - Earnings Plays', 'Earnings Gap Down Short', 'Gap down >7% на miss по EPS или guidance cut
Объём premarket >300K
Структура: opening drive down → bounce attempt → fail at resistance
Resistance: VWAP, prior close, declining 9 EMA
Sector weak или нейтральный', '- EPS miss или guidance cut
- Gap down >7%
- Bounce to VWAP or 38.2% retrace fails
- Lower highs формируются на bounce
- Volume fade на bounce
- No major support nearby ($1-2 range)
- Risk: above VWAP or bounce high
- Target: LOD retest or extension', 'Ждём failed bounce к VWAP после утреннего sell-off. Вход short на rejection от VWAP или declining 9 EMA. Стоп выше VWAP. Тейк — retest LOD и ниже.

Осторожно с акциями <$10 и с очень высоким short interest — могут сквизнуть.

Примеры: SNAP earnings, ZM earnings drops, PYPL guidance cuts.', 82, NULL, NULL, 'earnings, gap-down, short, reversal', NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T11:31:44.151Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (20, 'Earnings Winner — Day 2 Continuation', 'SMB Capital - Earnings Plays', 'Second Day Play', 'Day 1: сильный earnings gap up с close near HOD
Day 2 gap up или flat open above Day 1 close
Объём Day 1 был >3x 20-day average volume
Нет распродажи premarket Day 2
Sector momentum positive', '- Day 1 closed >80% от range
- Day 1 volume >3x average
- Day 2 premarket: not fading below Day 1 close
- Opening range first 5 min: above VWAP
- Catalyst still fresh — upgrades/coverage
- Entry: hold of Day 1 close or VWAP
- Stop: below Day 1 close
- Target: 1.5x Day 1 range extension', 'SMB classic Day 2 play. Самые сильные earnings movers продолжают движение на Day 2 из-за institutional buying, short covering, и upgrades overnight.

Ключ — Day 1 close должен быть near HOD (закрытие силы). Если Day 1 закрылся с длинной верхней тенью, Day 2 обычно слабый.

Track: NVDA, META, AMZN post-earnings Day 2 moves.', 78, NULL, NULL, 'earnings, continuation, day-2, momentum', NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T11:31:32.425Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (9, 'Weak Open Short — Gap Up Fail', 'SMB Capital — Short Setups', 'Earnings Gap Up', 'Акция gap up >5% но open weak — первый 5-мин бар red
VWAP immediately turns down
Volume heavy on sell side
Каталист не достаточно сильный для sustained move
Sector/market weak', '- Gap up >5% but opens weak
- First 5-min candle: bearish (close < open)
- VWAP slope negative from open
- Heavy selling volume first 5 min
- No strong fundamental catalyst
- Entry: break below first 5-min low
- Stop: above first 5-min high or VWAP
- Target: gap fill (yesterday close)', 'Gap up fail — когда рынок отвергает gap. Часто на weak catalysts: minor upgrades, sector sympathy plays, pre-market pump.

Самый надёжный short intraday. Win rate ~60%.

Не путать с earnings gap ups — те часто имеют real buying и recover. Gap up fails работают на слабых catalyst.', 74, 'https://www.tradingview.com/x/DfPrCSB8/
https://www.tradingview.com/x/TLWHHeMC/', '["TSLA\nNo weak open*\nGap up из за рынка\nGap up 4.95%\nПервая пятимунатная свеча красная\nVWAP сразу развернулся вниз\nКатализатора не было. Разве что 7.04.2026 вышел downgrade от JP Morgan.\nРынок был слабый упал на 1.25 %\n\n","Сравнение QQQ и TSLA"]', 'short, gap-fail, morning, reliable', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (10, 'Parabolic Short — Blow-Off Top', 'SMB Capital — Short Setups', 'Reversal', 'Акция выросла >30% за 1-2 дня без fundamental catalyst
Последняя волна роста — вертикальная (parabolic)
Volume climax — огромный volume на top
First red candle с high volume после parabolic move
SSR не активен (или есть shares to short)', '- Move >30% in 1-2 days
- No real catalyst (just momentum/social media)
- Volume climax bar at top
- First lower high on 5-min chart
- Spread widening at top
- Entry: break below first consolidation after climax
- Stop: above HOD (tight)
- Target: 50% retrace of the move or VWAP', 'High risk / high reward. Самый опасный но и самый прибыльный short setup.

Правила SMB для parabolic shorts:
1. Никогда не шортить на пути вверх — только после confirmation top
2. Size small — максимум 50% обычного размера
3. Стоп жёсткий — HOD +$0.25
4. Не шортить low float (<5M) parabolics — могут squeeze бесконечно

Примеры: GME, AMC blow-offs, random small cap pumps.', 65, NULL, '[""]', 'short, parabolic, high-risk, blow-off', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (16, 'Earnings Gap Up — First Pullback Long', 'SMB Capital - Earnings Plays', 'Earnings Gap Up', 'Gap up >5% на отчётности с beat по EPS и revenue
Объём premarket >500K shares
Ключевые уровни: вчерашний high, pre-market high, whole/half dollars
Катализатор чистый — guidance raised или beat >10%
Нет значимого сопротивления в первые $2-3 от открытия', '- EPS beat >5%
- Revenue beat >3%
- Guidance raised или не снижен
- Premarket volume >500K
- Gap >5% от close
- Float <100M (идеально <30M)
- Нет earnings peer в тот же день
- Risk/Reward минимум 3:1
- Стоп под VWAP или low первого 5-мин бара', 'SMB Capital core setup. Ждём первый откат к VWAP или rising 9 EMA на 1-мин после opening drive. Вход на hold VWAP с тейком на новый HOD. Ключ — скорость recovery после pullback. Если recovery медленная (>3 мин), пропускаем.

Лучшие дни: вторник-четверг. Избегать в дни FOMC/CPI.

Trades to study: CELH earnings Aug 2023, SMCI earnings Jan 2024, ONON earnings multiple.', 90, 'https://www.tradingview.com/x/ml9Ftk5B/', '["AEHR\nGap up: +8 %\nVokume: 500 k\nПробила все ключевые уровни: вчерашний high, pre-market high\nEPS = 28,5 %\nНа открытии провалилась вниз на 2.5 поинта"]', 'earnings, gap-up, momentum, A+', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (5, 'FOMC Fade — Post-Decision Reversal', 'SMB Capital - Macro & Sector Plays', 'Другой', 'FOMC decision day в 2:00 PM ET
Initial move >1% на SPY в первые 15 минут после решения
Move driven by algo/knee-jerk reaction
Powell press conference начинается в 2:30 PM
Reversal signs: volume spike + exhaustion candle', '- FOMC decision released at 2:00 PM ET
- Initial move >1% on SPY
- Wait for exhaustion (15-30 min after decision)
- Powell presser reversal typical at 2:30-3:00 PM
- Entry: reversal candle after initial move
- Stop: beyond the extreme of initial move
- Target: full retrace of FOMC initial move', 'FOMC fade — один из самых statistically reliable сетапов. Initial reaction часто reversed полностью к close.

Statistics: ~60% FOMC days reverse the initial move. Powell press conference creates the second volatility wave.

Риск: иногда initial move продолжается (hawkish surprise). Размер позиции = 50% от обычного.

SMB правило: не торговать первые 15 минут после FOMC. Ждать clarity.', 70, NULL, '[""]', 'fomc, macro, fade, event-driven', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (15, 'Earnings Gap Down — Short the Failed Bounce', 'SMB Capital - Earnings Plays', 'Earnings Gap Down Short', 'Gap down >7% на miss по EPS или guidance cut
Объём premarket >300K
Структура: opening drive down → bounce attempt → fail at resistance
Resistance: VWAP, prior close, declining 9 EMA
Sector weak или нейтральный', '- EPS miss или guidance cut
- Gap down >7%
- Bounce to VWAP or 38.2% retrace fails
- Lower highs формируются на bounce
- Volume fade на bounce
- No major support nearby ($1-2 range)
- Risk: above VWAP or bounce high
- Target: LOD retest or extension', 'Ждём failed bounce к VWAP после утреннего sell-off. Вход short на rejection от VWAP или declining 9 EMA. Стоп выше VWAP. Тейк — retest LOD и ниже.

Осторожно с акциями <$10 и с очень высоким short interest — могут сквизнуть.

Примеры: SNAP earnings, ZM earnings drops, PYPL guidance cuts.', 82, NULL, NULL, 'earnings, gap-down, short, reversal', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (14, 'Earnings Winner — Day 2 Continuation', 'SMB Capital - Earnings Plays', 'Second Day Play', 'Day 1: сильный earnings gap up с close near HOD
Day 2 gap up или flat open above Day 1 close
Объём Day 1 был >3x 20-day average volume
Нет распродажи premarket Day 2
Sector momentum positive', '- Day 1 closed >80% от range
- Day 1 volume >3x average
- Day 2 premarket: not fading below Day 1 close
- Opening range first 5 min: above VWAP
- Catalyst still fresh — upgrades/coverage
- Entry: hold of Day 1 close or VWAP
- Stop: below Day 1 close
- Target: 1.5x Day 1 range extension', 'SMB classic Day 2 play. Самые сильные earnings movers продолжают движение на Day 2 из-за institutional buying, short covering, и upgrades overnight.

Ключ — Day 1 close должен быть near HOD (закрытие силы). Если Day 1 закрылся с длинной верхней тенью, Day 2 обычно слабый.

Track: NVDA, META, AMZN post-earnings Day 2 moves.', 78, NULL, NULL, 'earnings, continuation, day-2, momentum', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (6, 'IPO Day 1 — Opening Range Breakout', 'SMB Capital — IPO Plays', 'IPO Day Trade', 'Новый IPO первый день торгов
Открылся выше IPO price с premium >20%
First 15 min range establishes
Institutional demand visible (large prints on tape)
Sector hot (tech, AI, biotech catalysts)', '- IPO price vs open price: premium >20%
- First 15-min range: tight (<5% of price)
- Volume first 15 min: massive (>5M shares)
- Large block prints on tape
- No lockup expiry imminent
- Entry: break above 15-min high
- Stop: below 15-min low or VWAP
- Target: 2x opening range height', 'IPO Day 1 — unique setup потому что нет технических уровней. Всё определяется supply/demand.

Правила:
1. Торговать только IPO с strong demand (oversubscribed)
2. Ждать первый 15-мин range — никогда не покупать на open
3. Size small — IPO volatile
4. Быть готовым к wide stops

Recent examples: ARM Holdings, Instacart, Reddit IPO days.', 68, NULL, '[""]', 'ipo, day-1, opening-range, high-vol', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (12, 'VWAP Reclaim — Mean Reversion Long', 'SMB Capital — Momentum Setups', 'Reversal', 'Акция упала ниже VWAP утром на weak selling (low volume)
Начинает формировать higher lows ниже VWAP
Volume pick up на reclaim candle
Общий рынок (SPY) стабилен или растёт
Акция имеет дневной uptrend (выше 20 SMA daily)', '- Stock pulled back to/below VWAP on declining volume
- Higher lows forming (ascending triangle pattern)
- Volume increase on reclaim candle
- SPY not tanking
- Daily trend is up (above 20 SMA)
- Entry: break above VWAP with volume
- Stop: below last higher low
- Target: HOD retest', 'Mean reversion к VWAP — один из самых reliable сетапов. Работает когда selling exhaustion очевиден (volume dry up below VWAP).

Лучше всего работает 10:30-11:30 AM ET после утренней волатильности.

Не торговать если акция имеет negative catalyst (earnings miss, downgrade). Только для технических pullback.', 80, NULL, '[""]', 'vwap, mean-reversion, long, reliable', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (26, 'Scalping 1-Min Bounce', NULL, 'Scalp', 'Stock with sub-5M float, RVOL 3+, support level confirmed', '1-min entry, 0.05-0.15 target, stop 0.10 below', 'Quick execution critical, needs tight spreads', 6, NULL, NULL, NULL, NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T23:38:31.835Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (25, 'HOD Failure Short', NULL, 'Short', 'Gap up then fails at HOD, 2M+ premarket float', 'Resistance at HOD confirmed, short entry near resistance', 'Avoid on strong earnings names - Tech exception', 7, NULL, NULL, NULL, NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T23:38:29.979Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (24, 'Low Float Runner', NULL, 'Runner', 'Float under 3M, gap up 5%+, RVOL 2+, sustained momentum', 'Let winner run with trailing stop, partials at 5% and 10%', 'High risk/reward - Manage size carefully, micro caps', 5, NULL, NULL, NULL, NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T23:38:27.856Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (23, 'VWAP Support Bounce', NULL, 'Support', 'Stock consolidates at VWAP, RVOL 1.5+, clean candle bounce', 'VWAP touched, entry on close above VWAP, resistance plotted', 'Works in trending markets - Morning preferred', 7, NULL, NULL, NULL, NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T23:38:25.961Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (27, 'Earnings Gap and Go', NULL, 'Gap', 'Stock gaps 3%+ after earnings, strong guidance, premarket volume 2M+', 'Check float size, RVOL at entry, first resistance identified', 'Best performance on tech earnings - Mega cap bias', 8, NULL, NULL, NULL, NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T23:38:23.849Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (19, 'Opening Drive — Momentum Ignition', 'Intraday Momentum', 'Intraday Momentum', 'Гэп >3% с каталистом (news, upgrade, sector move)
Premarket volume >200K
Bid-ask tight (<0.05 для stocks >$20)
Level 2 показывает стэковый bid
First 1-min candle closes near high с volume >50K', '- Clear catalyst identified
- Gap >3% with volume
- First 1-min candle: bullish close
- VWAP slope positive
- No immediate overhead resistance ($0.50)
- Entry: break of 1-min high
- Stop: below 1-min low or VWAP
- Target: next whole dollar / premarket high', 'Самый быстрый setup — первые 5-15 минут торгов. Вход на break первой 1-мин свечи с volume confirmation. Всё решается за 2-5 минут.

Ошибка новичков: входить в открытие без подтверждения первой свечи. Пропускайте если первая свеча — doji или bearish.

Win rate ~55%, но R:R обычно 3:1+. Один из хлебных сетапов SMB.', 75, NULL, NULL, 'momentum, opening, speed, A-setup', NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T11:18:59.061Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (17, 'Red to Green Move', 'Intraday Momentum', 'Reversal', 'Акция открылась red (ниже yesterday close)
Нет negative catalyst — продажа на общем рынке или sector rotation
Начинает recovery с volume build
Reclaims yesterday close (red to green)
Strong relative strength vs SPY', '- No company-specific bad news
- Pre-market selling was sector/market-wide
- Recovery on increasing volume
- Break above yesterday close
- Relative strength vs SPY positive
- Entry: first pullback after R2G move
- Stop: below the red-to-green level
- Target: prior day high or VWAP from prior day', 'Red to Green — сигнал институционального buying. Кто-то считает цену attractive и набирает позицию.

Самые сильные R2G moves происходят в первый час торгов. Если R2G происходит после 11 AM — менее надёжно.

Track: крупные tech names (AAPL, MSFT, GOOGL) часто показывают R2G в дни market weakness.', 77, NULL, NULL, 'reversal, red-to-green, relative-strength', NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T11:18:55.346Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (18, 'VWAP Reclaim — Mean Reversion Long', 'Intraday Momentum', 'Reversal', 'Акция упала ниже VWAP утром на weak selling (low volume)
Начинает формировать higher lows ниже VWAP
Volume pick up на reclaim candle
Общий рынок (SPY) стабилен или растёт
Акция имеет дневной uptrend (выше 20 SMA daily)', '- Stock pulled back to/below VWAP on declining volume
- Higher lows forming (ascending triangle pattern)
- Volume increase on reclaim candle
- SPY not tanking
- Daily trend is up (above 20 SMA)
- Entry: break above VWAP with volume
- Stop: below last higher low
- Target: HOD retest', 'Mean reversion к VWAP — один из самых reliable сетапов. Работает когда selling exhaustion очевиден (volume dry up below VWAP).

Лучше всего работает 10:30-11:30 AM ET после утренней волатильности.

Не торговать если акция имеет negative catalyst (earnings miss, downgrade). Только для технических pullback.', 80, NULL, NULL, 'vwap, mean-reversion, long, reliable', NULL, NULL, '2026-04-09T10:30:06.853Z', '2026-04-09T11:18:57.445Z');
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (8, 'Flag Pattern Breakout', 'SMB Capital - Breakout Patterns', 'Breakout', 'Strong initial move (pole) >5% с high volume
Consolidation 15-45 min с declining volume (flag)
Flag retraces <38.2% of pole
VWAP ниже flag — supportive
Market (SPY) stable или bullish', '- Pole move >5% on volume
- Consolidation (flag) 3-8 candles on 5-min
- Volume declining during flag
- Flag <38.2% retrace of pole
- Break above flag high on volume surge
- Entry: break of flag high
- Stop: below flag low
- Target: measured move (pole length from breakout)', 'Классический continuation pattern. Один из самых чистых сетапов в day trading.

Flag должен быть tight — если широкий (>50% retrace), это уже не flag а reversal.

Look for: tight candles, declining volume in flag, clean break with volume. Measured move target обычно достигается в 65% случаев.

SMB traders ищут 2-3 flag patterns per day в leading stocks.', 82, NULL, NULL, 'breakout, flag, continuation, clean', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (7, 'Range Break — Consolidation Squeeze', 'SMB Capital - Breakout Patterns', 'Breakout', 'Акция торгуется в tight range >30 минут
Range сужается (squeeze) — Bollinger Bands narrowing
Volume declining в range
Акция near HOD или at significant level
Catalyst present (upcoming event, sector move)', '- Range <2% for >30 min
- Volume declining in range
- ATR squeeze visible
- Stock near HOD or key daily level
- Clear direction bias (above/below VWAP)
- Entry: break of range with volume >2x range average
- Stop: opposite side of range
- Target: range width x 2 extension', 'Compression leads to expansion. Длительная консолидация создаёт energy для big move.

Часто работает в midday (11-1 PM) когда утренний momentum затухает и формируется новый range.

Risk management: если breakout immediately fails (1 candle), это false breakout — выходить немедленно. Real breakouts не дают re-entry ниже breakout level.', 72, NULL, NULL, 'breakout, squeeze, range, patience', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (11, 'Red to Green Move', 'SMB Capital — Momentum Setups', 'Reversal', 'Акция открылась red (ниже yesterday close)
Нет negative catalyst — продажа на общем рынке или sector rotation
Начинает recovery с volume build
Reclaims yesterday close (red to green)
Strong relative strength vs SPY', '- No company-specific bad news
- Pre-market selling was sector/market-wide
- Recovery on increasing volume
- Break above yesterday close
- Relative strength vs SPY positive
- Entry: first pullback after R2G move
- Stop: below the red-to-green level
- Target: prior day high or VWAP from prior day', 'Red to Green — сигнал институционального buying. Кто-то считает цену attractive и набирает позицию.

Самые сильные R2G moves происходят в первый час торгов. Если R2G происходит после 11 AM — менее надёжно.

Track: крупные tech names (AAPL, MSFT, GOOGL) часто показывают R2G в дни market weakness.', 77, NULL, '[""]', 'reversal, red-to-green, relative-strength', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (13, 'Opening Drive — Momentum Ignition', 'SMB Capital — Momentum Setups', 'Intraday Momentum', 'Гэп >3% с каталистом (news, upgrade, sector move)
Premarket volume >200K
Bid-ask tight (<0.05 для stocks >$20)
Level 2 показывает стэковый bid
First 1-min candle closes near high с volume >50K', '- Clear catalyst identified
- Gap >3% with volume
- First 1-min candle: bullish close
- VWAP slope positive
- No immediate overhead resistance ($0.50)
- Entry: break of 1-min high
- Stop: below 1-min low or VWAP
- Target: next whole dollar / premarket high', 'Самый быстрый setup — первые 5-15 минут торгов. Вход на break первой 1-мин свечи с volume confirmation. Всё решается за 2-5 минут.

Ошибка новичков: входить в открытие без подтверждения первой свечи. Пропускайте если первая свеча — doji или bearish.

Win rate ~55%, но R:R обычно 3:1+. Один из хлебных сетапов SMB.', 75, NULL, '[""]', 'momentum, opening, speed, A-setup', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (2, 'Trade Review Checklist', 'Trillium - Position Management', 'Другой', 'Выполнять для КАЖДОГО трейда, win или loss
Заполнять в течение 30 минут после закрытия позиции
Честная оценка — никакого hindsight bias', '- Был ли это мой setup из плейбука?
- Дождался ли я confirmation?
- Правильный ли был sizing?
- Стоп был определён до входа?
- Следовал ли я своему стопу?
- Был ли entry timing оптимальным?
- Достаточно ли я держал winner?
- Не передержал ли я loser?
- Что я сделал бы по-другому?
- Какой урок вынес?', 'Без review нет improvement. Каждый трейд — это data point.

SMB требует от всех трейдеров вести journal и review. Без этого невозможно идентифицировать edge.

Playback method: в конце дня пересмотри каждый трейд на charts. Отметь entry/exit/stop. Оцени 1-10.

Еженедельный review: top 3 best trades, top 3 worst trades, паттерны ошибок.', 100, NULL, '[""]', 'review, process, discipline, must-do', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (3, 'Position Sizing Framework', 'Trillium - Position Management', 'Другой', 'Применять ко ВСЕМ сетапам без исключений
Максимальный риск на трейд: 1% от счёта
A+ setups: полный размер (1%)
B setups: 50-75% от полного размера
C setups: 25-50% или пропуск', '- Account risk per trade: MAX 1%
- A+ setup: full size
- B setup: 50-75% size
- C setup: 25-50% size
- Daily loss limit: 3% of account
- Weekly loss limit: 5% of account
- Stop ALWAYS defined BEFORE entry
- No averaging down on losers', 'SMB Capital Risk Management:

1. Новичок (<6 мес): 0.25% risk per trade, max 3 trades/day
2. Developing (6-12 мес): 0.5% risk per trade, max 5 trades/day
3. Experienced (>1 год с profit): 1% risk per trade, no daily limit

Golden rule: если проиграл 3 трейда подряд — стоп на день. Не пытайся отбить.

Position sizing formula: Shares = (Account * Risk%) / (Entry - Stop)', 95, NULL, '[""]', 'risk, sizing, rules, critical', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
INSERT INTO "playbook" ("id", "name", "folder", "setup_type", "conditions", "checklist", "notes", "confidence_level", "screenshot_url", "screenshot_notes", "tags", "source_type", "source_id", "created_at", "deleted_at") VALUES (4, 'CPI Morning Gap — Trend Day Trade', 'SMB Capital - Macro & Sector Plays', 'Другой', 'CPI data release 8:30 AM ET
Significant deviation from expectations (>0.2%)
SPY gaps >0.5% on the data
Bond yields move sharply in same direction
First 15-мин range clean (not choppy)', '- CPI deviation from consensus >0.2%
- SPY gap >0.5%
- Bond yields (TNX) confirming direction
- VIX expansion
- First 15-min candle establishes direction
- Entry: with trend after first pullback
- Stop: opposite side of first 15-min range
- Target: 2-3x first hour range (trend day potential)', 'CPI days часто становятся trend days — одно направление весь день.

Если CPI горячий (выше ожиданий) — sell the open, short rallies.
Если CPI мягкий (ниже ожиданий) — buy pullbacks.

Trend day characteristics: closes near HOD/LOD, TICK persistent, breadth one-sided.

Best stocks for CPI plays: rate-sensitive (banks, REITs, tech growth).', 73, NULL, '[""]', 'cpi, macro, trend-day, morning', NULL, NULL, '2026-04-09T10:30:06.853Z', NULL);
SELECT setval(pg_get_serial_sequence('"playbook"', 'id'), COALESCE((SELECT MAX(id) FROM "playbook"), 1));

INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (122, 'updated', 'playbook', '86', 'Earnings Range Anticipation — Straddle Alternative', 'system', 'Обновлён сетап', '2026-04-10T05:51:07.621Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (121, 'updated', 'playbook', '84', 'Earnings Whisper — Pre-Earnings Position', 'system', 'Обновлён сетап', '2026-04-10T05:50:28.997Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (120, 'updated', 'playbook', '85', 'Post-Earnings Drift (PEAD) — Follow Surprise', 'system', 'Обновлён сетап', '2026-04-10T05:48:40.267Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (119, 'updated', 'playbook', '86', 'Earnings Range Anticipation — Straddle Alternative', 'system', 'Обновлён сетап', '2026-04-10T05:48:13.398Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (118, 'deleted', 'playbook', NULL, 'OPG / Auction Plays', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:55.861Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (117, 'deleted', 'playbook', NULL, 'Imbalance (IMBX) Strategies', 'system', 'Папка удалена (4 стратегий)', '2026-04-10T00:27:51.062Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (116, 'deleted', 'playbook', NULL, 'MOC / Closing Auction', 'system', 'Папка удалена (4 стратегий)', '2026-04-10T00:27:47.481Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (115, 'deleted', 'playbook', NULL, 'Pre-Market & After Hours', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:43.950Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (114, 'deleted', 'playbook', NULL, 'Advanced Tape Reading', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:40.941Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (113, 'deleted', 'playbook', NULL, 'Mean Reversion Plays', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:37.384Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (112, 'deleted', 'playbook', NULL, 'Gap Trading', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:19.783Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (111, 'deleted', 'playbook', NULL, 'Swing Trading Setups', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:12.495Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (110, 'deleted', 'playbook', NULL, 'Earnings Strategies', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:08.025Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (109, 'deleted', 'playbook', NULL, 'Macro & Sector Plays', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:27:02.114Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (108, 'deleted', 'playbook', NULL, 'Position Management', 'system', 'Папка удалена (3 стратегий)', '2026-04-10T00:26:56.191Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (107, 'updated', 'trades', '88', 'AEHR', 'Рахматулло', NULL, '2026-04-09T19:14:18.219Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (106, 'updated', 'trades', '87', 'PLTR', 'Закир', NULL, '2026-04-09T19:14:14.459Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (105, 'updated', 'trades', '89', 'SPIR', 'Артур', NULL, '2026-04-09T19:14:10.277Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (104, 'updated', 'trades', '92', 'SPIR', 'Максат', NULL, '2026-04-09T19:14:04.423Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (103, 'created', 'discussions', '7', 'partnership', 'Закир', NULL, '2026-04-09T18:56:04.838Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (102, 'updated', 'trades', '92', 'SPIR', 'Максат', NULL, '2026-04-09T17:34:15.413Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (101, 'updated', 'trades', '90', 'CRWV', 'Умид', NULL, '2026-04-09T17:33:21.431Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (100, 'created', 'trades', '92', 'SPIR', 'Максат', 'Long win $48.60', '2026-04-09T17:32:03.404Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (99, 'created', 'trades', '91', 'INTC', 'Артур', 'Short win', '2026-04-09T17:30:49.685Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (98, 'updated', 'trades', '90', 'CRWV', 'Умид', NULL, '2026-04-09T17:24:59.068Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (97, 'updated', 'trades', '90', 'CRWV', 'Умид', NULL, '2026-04-09T17:24:18.972Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (96, 'created', 'trades', '90', 'CRWV', 'Умид', 'Short win $83.00', '2026-04-09T17:22:55.182Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (95, 'created', 'trades', '89', 'SPIR', 'Артур', 'Long loss $-25.00', '2026-04-09T17:21:34.265Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (94, 'updated', 'trades', '88', 'AEHR', 'Рахматулло', NULL, '2026-04-09T17:08:47.222Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (93, 'created', 'trades', '88', 'AEHR', 'Рахматулло', 'Long win $144.00', '2026-04-09T16:08:02.807Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (92, 'updated', 'trades', '87', 'PLTR', 'Закир', NULL, '2026-04-09T16:06:54.108Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (91, 'updated', 'trades', '87', 'PLTR', 'Закир', NULL, '2026-04-09T15:12:34.395Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (90, 'updated', 'trades', '87', 'PLTR', 'Закир', NULL, '2026-04-09T15:12:32.433Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (89, 'created', 'trades', '87', 'PLTR', 'Закир', 'Short win $135.00', '2026-04-09T15:12:00.539Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (88, 'created', 'discussions', '6', 'Кто что добавит сегодня', 'Закир', NULL, '2026-04-09T12:43:52.440Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (87, 'deleted', 'trades', '86', 'GME', 'Максат', NULL, '2026-04-09T11:41:48.596Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (86, 'deleted', 'trades', '19', 'NFLX', 'Умид', NULL, '2026-04-09T11:41:46.541Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (85, 'deleted', 'trades', '51', 'DIS', 'Рахматулло', NULL, '2026-04-09T11:41:43.990Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (84, 'deleted', 'trades', '64', 'DIS', 'Рахматулло', NULL, '2026-04-09T11:41:41.798Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (83, 'deleted', 'trades', '84', 'DIS', 'Рахматулло', NULL, '2026-04-09T11:41:39.882Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (82, 'deleted', 'trades', '17', 'ROKU', 'Артур', NULL, '2026-04-09T11:41:38.224Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (81, 'deleted', 'trades', '37', 'ROKU', 'Артур', NULL, '2026-04-09T11:41:36.582Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (80, 'deleted', 'trades', '50', 'ROKU', 'Артур', NULL, '2026-04-09T11:41:35.071Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (79, 'deleted', 'trades', '63', 'ROKU', 'Артур', NULL, '2026-04-09T11:41:06.222Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (78, 'deleted', 'trades', '83', 'ROKU', 'Артур', NULL, '2026-04-09T11:41:04.319Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (77, 'deleted', 'trades', '16', 'BABA', 'Антон', NULL, '2026-04-09T11:41:02.161Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (76, 'deleted', 'trades', '36', 'BABA', 'Антон', NULL, '2026-04-09T11:40:58.511Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (75, 'deleted', 'trades', '49', 'BABA', 'Антон', NULL, '2026-04-09T11:40:55.976Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (74, 'deleted', 'trades', '62', 'BABA', 'Антон', NULL, '2026-04-09T11:40:51.383Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (73, 'deleted', 'trades', '82', 'BABA', 'Антон', NULL, '2026-04-09T11:40:49.602Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (72, 'deleted', 'trades', '15', 'MSFT', 'Закир', NULL, '2026-04-09T11:40:48.052Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (71, 'deleted', 'trades', '35', 'MSFT', 'Закир', NULL, '2026-04-09T11:40:46.287Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (70, 'deleted', 'trades', '48', 'MSFT', 'Закир', NULL, '2026-04-09T11:40:44.263Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (69, 'deleted', 'trades', '61', 'MSFT', 'Закир', NULL, '2026-04-09T11:40:41.623Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (68, 'deleted', 'trades', '81', 'MSFT', 'Закир', NULL, '2026-04-09T11:40:39.735Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (67, 'deleted', 'trades', '14', 'AVGO', 'Тимур', NULL, '2026-04-09T11:40:38.062Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (66, 'deleted', 'trades', '34', 'AVGO', 'Тимур', NULL, '2026-04-09T11:40:36.097Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (65, 'deleted', 'trades', '47', 'AVGO', 'Тимур', NULL, '2026-04-09T11:40:33.814Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (64, 'deleted', 'trades', '60', 'AVGO', 'Тимур', NULL, '2026-04-09T11:40:31.744Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (63, 'deleted', 'trades', '80', 'AVGO', 'Тимур', NULL, '2026-04-09T11:40:29.719Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (62, 'deleted', 'trades', '13', 'SMCI', 'Максат', NULL, '2026-04-09T11:40:27.667Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (61, 'deleted', 'trades', '33', 'SMCI', 'Максат', NULL, '2026-04-09T11:40:25.760Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (60, 'deleted', 'trades', '46', 'SMCI', 'Максат', NULL, '2026-04-09T11:40:23.752Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (59, 'deleted', 'trades', '59', 'SMCI', 'Максат', NULL, '2026-04-09T11:40:21.993Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (58, 'deleted', 'trades', '79', 'SMCI', 'Максат', NULL, '2026-04-09T11:39:59.068Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (57, 'deleted', 'trades', '12', 'SPY', 'Умид', NULL, '2026-04-09T11:39:56.741Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (56, 'deleted', 'trades', '32', 'SPY', 'Умид', NULL, '2026-04-09T11:39:54.502Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (55, 'deleted', 'trades', '45', 'SPY', 'Умид', NULL, '2026-04-09T11:39:52.398Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (54, 'deleted', 'trades', '58', 'SPY', 'Умид', NULL, '2026-04-09T11:39:50.531Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (53, 'deleted', 'trades', '78', 'SPY', 'Умид', NULL, '2026-04-09T11:39:48.651Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (52, 'deleted', 'trades', '11', 'RIOT', 'Рахматулло', NULL, '2026-04-09T11:39:46.637Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (51, 'deleted', 'trades', '31', 'RIOT', 'Рахматулло', NULL, '2026-04-09T11:39:44.662Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (50, 'deleted', 'trades', '44', 'RIOT', 'Рахматулло', NULL, '2026-04-09T11:39:42.701Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (49, 'deleted', 'trades', '57', 'RIOT', 'Рахматулло', NULL, '2026-04-09T11:39:40.725Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (48, 'deleted', 'trades', '77', 'RIOT', 'Рахматулло', NULL, '2026-04-09T11:39:38.738Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (47, 'deleted', 'trades', '10', 'COIN', 'Артур', NULL, '2026-04-09T11:39:33.199Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (46, 'deleted', 'trades', '30', 'COIN', 'Артур', NULL, '2026-04-09T11:39:31.090Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (45, 'deleted', 'trades', '43', 'COIN', 'Артур', NULL, '2026-04-09T11:39:29.374Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (44, 'deleted', 'trades', '56', 'COIN', 'Артур', NULL, '2026-04-09T11:39:27.255Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (43, 'deleted', 'trades', '76', 'COIN', 'Артур', NULL, '2026-04-09T11:39:25.239Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (42, 'deleted', 'trades', '9', 'META', 'Антон', NULL, '2026-04-09T11:39:22.901Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (41, 'deleted', 'trades', '29', 'META', 'Антон', NULL, '2026-04-09T11:39:20.143Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (40, 'deleted', 'trades', '42', 'META', 'Антон', NULL, '2026-04-09T11:39:16.824Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (39, 'deleted', 'trades', '55', 'META', 'Антон', NULL, '2026-04-09T11:39:14.356Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (38, 'deleted', 'trades', '75', 'META', 'Антон', NULL, '2026-04-09T11:39:12.324Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (37, 'deleted', 'trades', '8', 'AAPL', 'Закир', NULL, '2026-04-09T11:39:10.352Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (36, 'deleted', 'trades', '28', 'AAPL', 'Закир', NULL, '2026-04-09T11:39:07.997Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (35, 'deleted', 'trades', '41', 'AAPL', 'Закир', NULL, '2026-04-09T11:39:06.001Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (34, 'deleted', 'trades', '54', 'AAPL', 'Закир', NULL, '2026-04-09T11:39:03.797Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (33, 'deleted', 'trades', '74', 'AAPL', 'Закир', NULL, '2026-04-09T11:39:01.904Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (32, 'deleted', 'trades', '7', 'XLF', 'Тимур', NULL, '2026-04-09T11:39:00.006Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (31, 'deleted', 'trades', '27', 'XLF', 'Тимур', NULL, '2026-04-09T11:38:57.838Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (30, 'deleted', 'trades', '73', 'XLF', 'Тимур', NULL, '2026-04-09T11:38:55.244Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (29, 'deleted', 'trades', '6', 'PLTR', 'Максат', NULL, '2026-04-09T11:38:52.551Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (28, 'deleted', 'trades', '26', 'PLTR', 'Максат', NULL, '2026-04-09T11:38:50.405Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (27, 'deleted', 'trades', '72', 'PLTR', 'Максат', NULL, '2026-04-09T11:38:48.485Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (26, 'deleted', 'trades', '5', 'SOFI', 'Умид', NULL, '2026-04-09T11:38:46.558Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (25, 'deleted', 'trades', '25', 'SOFI', 'Умид', NULL, '2026-04-09T11:38:44.645Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (24, 'deleted', 'trades', '71', 'SOFI', 'Умид', NULL, '2026-04-09T11:38:42.614Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (23, 'deleted', 'trades', '4', 'MSTR', 'Рахматулло', NULL, '2026-04-09T11:38:40.541Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (22, 'deleted', 'trades', '24', 'MSTR', 'Рахматулло', NULL, '2026-04-09T11:38:37.710Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (21, 'deleted', 'trades', '70', 'MSTR', 'Рахматулло', NULL, '2026-04-09T11:38:35.628Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (20, 'deleted', 'trades', '3', 'AMD', 'Артур', NULL, '2026-04-09T11:38:33.870Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (19, 'deleted', 'trades', '23', 'AMD', 'Артур', NULL, '2026-04-09T11:38:31.926Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (18, 'deleted', 'trades', '69', 'AMD', 'Артур', NULL, '2026-04-09T11:38:30.037Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (17, 'deleted', 'trades', '2', 'TSLA', 'Антон', NULL, '2026-04-09T11:38:28.231Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (16, 'deleted', 'trades', '22', 'TSLA', 'Антон', NULL, '2026-04-09T11:38:26.195Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (15, 'deleted', 'trades', '68', 'TSLA', 'Антон', NULL, '2026-04-09T11:38:24.050Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (14, 'deleted', 'trades', '1', 'NVDA', 'Закир', NULL, '2026-04-09T11:38:21.031Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (13, 'deleted', 'trades', '65', 'NFLX', 'Умид', NULL, '2026-04-09T11:09:36.247Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (12, 'deleted', 'trades', '18', 'DIS', 'Рахматулло', NULL, '2026-04-09T11:09:32.670Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (11, 'deleted', 'trades', '85', 'NFLX', 'Умид', NULL, '2026-04-09T11:09:30.235Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (10, 'deleted', 'trades', '38', 'DIS', 'Рахматулло', NULL, '2026-04-09T11:09:21.010Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (9, 'deleted', 'trades', '52', 'NFLX', 'Умид', NULL, '2026-04-09T11:08:59.593Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (8, 'deleted', 'trades', '39', 'NFLX', 'Умид', NULL, '2026-04-09T11:08:57.864Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (7, 'deleted', 'trades', '39', 'NFLX', 'Умид', NULL, '2026-04-09T11:08:55.951Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (6, 'deleted', 'trades', '66', 'GME', 'Максат', NULL, '2026-04-09T11:08:53.415Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (5, 'deleted', 'trades', '53', 'GME', 'Максат', NULL, '2026-04-09T11:08:51.106Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (4, 'deleted', 'trades', '40', 'GME', 'Максат', NULL, '2026-04-09T11:08:48.175Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (3, 'deleted', 'trades', '20', 'GME', 'Максат', NULL, '2026-04-09T11:08:45.827Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (2, 'deleted', 'trades', '21', 'NVDA', 'Закир', NULL, '2026-04-09T11:03:57.430Z');
INSERT INTO "activity_log" ("id", "action", "section", "entity_id", "entity_title", "trader", "details", "created_at") VALUES (1, 'deleted', 'trades', '67', 'NVDA', 'Закир', NULL, '2026-04-09T11:03:55.286Z');
SELECT setval(pg_get_serial_sequence('"activity_log"', 'id'), COALESCE((SELECT MAX(id) FROM "activity_log"), 1));

INSERT INTO "trade_reactions" ("id", "trade_id", "trader", "reaction_type", "created_at") VALUES (1, 41, 'Закир', 'like', '2026-04-09T10:22:54.462Z');
SELECT setval(pg_get_serial_sequence('"trade_reactions"', 'id'), COALESCE((SELECT MAX(id) FROM "trade_reactions"), 1));

INSERT INTO "big7_levels" ("id", "ticker", "label", "price", "notes", "created_at") VALUES (1, 'TEST', 'Test Level', '100.5000', 'round-trip test', '2026-04-09T10:30:06.979Z');
SELECT setval(pg_get_serial_sequence('"big7_levels"', 'id'), COALESCE((SELECT MAX(id) FROM "big7_levels"), 1));
