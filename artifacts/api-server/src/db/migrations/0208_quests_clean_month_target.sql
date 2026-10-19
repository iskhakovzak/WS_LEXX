-- Quests follow-up (lib/quests/achievements.ts). The «clean_month» badge stored the traded days a month needed as its
-- number (rewards.cleanMonthMinDays, e.g. 10); copied by 0207 as the bronze tier of the clean_month line, whose tiers
-- count MONTHS (1 / 3 / 6). The tier keeps its day; its number becomes 1 month.
UPDATE trader_achievements SET target = 1 WHERE line = 'clean_month' AND tier = 'bronze' AND target <> 1;
