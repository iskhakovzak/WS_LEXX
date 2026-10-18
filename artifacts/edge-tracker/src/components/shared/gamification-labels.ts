// Gamification labels shared by the dashboard rewards chip (components/daily), the quests tab, the season / league
// views, the curator queue and the admin editor: titles, ranking labels (aliases for traders), mastery level names,
// the season month and the one-line season bar. Texts: i18n namespace `gamification`.
import type { SeasonState, SetupMastery } from "@/lib/gamification/types";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { personName } from "@/i18n";

const ALIAS_RE = /^t(\d+)$/;

/** «Железный» / «Снайпер 1.3» — an earned title; unknown keys show nothing rather than a raw code. */
export function titleLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  const [base, arg] = key.split(":", 2);
  if (base === "sniper") return gamificationI18n.t("titles.name.sniper", { setup: arg ?? "" });
  return gamificationI18n.tryT(`titles.name.${base}`) ?? null;
}

/**
 * A ranking row's name: the viewer's own row is «я»; "t<n>" is a per-season alias («Трейдер 3») for traders when names
 * are hidden; anything else is a stored name (staff / names shown).
 */
export function rankingName(label: string, me: boolean): string {
  if (me) return gamificationI18n.t("season.me");
  const m = ALIAS_RE.exec(label);
  if (m) return gamificationI18n.t("season.alias", { n: Number(m[1]) });
  return personName(label);
}

/** «Новичок» … «Мастер» (0..4); levels past the dictionary show their number. */
export function masteryLevelName(level: number): string {
  return gamificationI18n.tryT(`mastery.level.${level}`) ?? String(level);
}

/** Progress inside the current mastery level, 0..100 (100 at the top level). */
export function masteryPct(m: Pick<SetupMastery, "progress">): number {
  const { current, next } = m.progress;
  if (next == null) return 100;
  return next > 0 ? Math.max(0, Math.min(100, Math.round((current / next) * 100))) : 0;
}

/** «октября» from "2026-10" (genitive in RU: «Сезон октября»). */
export function seasonMonth(key: string): string {
  const m = Number(key.split("-")[1]);
  return (Number.isInteger(m) && gamificationI18n.tryT(`season.month.${m}`)) || key;
}

/** «Сезон октября: 84 очка · 7-е место · 12 дней до конца». */
export function seasonBarText(s: SeasonState): string {
  const t = gamificationI18n.t;
  const month = seasonMonth(s.key);
  const points = t("season.points", { count: s.myPoints });
  const left = s.endsInDays > 0 ? t("season.left", { count: s.endsInDays }) : t("season.lastDay");
  if (s.myRank == null) return t("season.barNoRank", { month, points, left });
  return t("season.bar", { month, points, rank: t("season.rankShort", { rank: s.myRank }), left });
}

/** «ORB 5 минут» from code "1.3" + name "1.3 ORB 5 минут" (playbook names carry the code; the chip shows it apart). */
export function setupShortName(code: string | null, name: string): string {
  if (code && name.startsWith(code)) return name.slice(code.length).trim() || name;
  return name;
}
