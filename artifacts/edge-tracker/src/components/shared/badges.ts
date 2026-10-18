// Discipline levels (api-server lib/daily/discipline.ts): level names for the dashboard rewards chip
// (components/daily), the quests tab, the curator profile and the rewards catalog. Badges are tiers of the achievement
// lines now (one award system, lib/quests) — their old separate icons / list are gone; the evening card still names a
// badge from an older server through `daily` rewards.badge.*. Texts: i18n namespace `daily` (rewards.*).
import { dailyI18n } from "@/i18n/ns/daily";

/** «Стабильный» — level name; levels past the dictionary show their number. */
export function levelName(level: number): string {
  return dailyI18n.tryT(`rewards.level.${level}`) ?? String(level);
}
