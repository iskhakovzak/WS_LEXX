/**
 * Admin «Обзор» — pure helpers (unit-tested in overview-model.test.ts): weekend days, who the overdue reviews belong
 * to (OWNER-05), a missing fresh DB backup (OWNER-14).
 */
import { personName } from "@/i18n";
import { adminI18n } from "@/i18n/ns/admin";
import type { HealthData, ReviewLoad } from "./console-api";

/** Saturday / Sunday for a YYYY-MM-DD desk date. */
export function isWeekendYmd(ymd: string): boolean {
  const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * The review queue of /admin as one variable (design audit: the KPI said 1 overdue while the panel said «очередь пуста»):
 * the KPI tile, the «Требует действий» item and «Ревью по кураторам» all read this. undefined = loading, null = n/a.
 */
export function reviewQueueOf(load: ReviewLoad | null | undefined): { count: number; overdue: number; slaHours: number } | null | undefined {
  if (load === undefined) return undefined;
  if (load === null) return null;
  const total = load.total ?? [...load.curators, load.unassigned].reduce((a, c) => ({ count: a.count + c.count, overdue: a.overdue + c.overdue }), { count: 0, overdue: 0 });
  return { ...total, slaHours: load.slaHours };
}

/** «Ольга Н. — 20 · без куратора — 8»: who the overdue reviews belong to (OWNER-05). */
export function overdueByCurator(load: ReviewLoad | null | undefined, max = 3): string | undefined {
  if (!load) return undefined;
  const t = adminI18n.t;
  const parts = load.curators.filter((c) => c.overdue > 0).slice(0, max).map((c) => t("attention.slaCurator", { name: personName(c.name), count: c.overdue }));
  if (load.unassigned.overdue > 0) parts.push(t("attention.slaNoCurator", { count: load.unassigned.overdue }));
  return parts.length ? parts.join(" · ") : undefined;
}

/** No backup newer than 24 h (production, OWNER-14): null when fine or not checked. */
export function backupProblem(health: Pick<HealthData, "backup"> | undefined, now = Date.now()): { lastAt: string | null } | null {
  const b = health?.backup;
  if (!b) return null;
  if (b.lastAt && now - Date.parse(b.lastAt) < 24 * 3_600_000) return null;
  return { lastAt: b.lastAt };
}
