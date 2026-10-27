-- Design audit wave 2: the course editor still showed the level label «Стажёр» of the seeded demo course, a stage that
-- left the ladder in 0229 (Джун → Трейдер → Сеньор). The free-text level of such programs becomes «Базовый» (the seed,
-- lib/academySeedCourse.ts, now writes the same). Only that exact label changes; nothing is deleted.
-- 0264 is the next free number on main (0263 = market_regime).

DO $$
DECLARE n integer;
BEGIN
  IF to_regclass('public.academy_programs') IS NOT NULL THEN
    UPDATE academy_programs SET level = 'Базовый' WHERE level = 'Стажёр';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_programs level trainee label → basic: % rows', n;
  END IF;
END $$;
