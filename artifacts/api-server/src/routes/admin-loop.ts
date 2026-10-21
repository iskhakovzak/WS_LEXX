/**
 * Admin console «Обзор» → «Петля вчера» (Волна 2 п. 2.4).
 *
 *   GET /admin/loop-yesterday[?date=YYYY-MM-DD][&scope=group|all]
 *     → {date, scope, mine, slaHours, rows, totals} (lib/admin/loopYesterday.ts)
 *
 * The date is the last finished NY trading day (the last trading day strictly before today, lib/usage/stats
 * lastTradingDays); `?date` picks another day up to today (INVALID_DATE otherwise). Capability team.read (admins and
 * curators; a trader 403, anonymous 401), limited by its matrix scope (readScope) and the curator «Моя группа / Все»
 * switch (lib/people/deskGroups myPeople + pickScope, as routes/curator-requests.ts). `mine` = the viewer leads anyone
 * (the switch is worth showing). Mounted by routes/admin-console.ts.
 */
import type { IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { readScope, requireCap } from "../lib/permissions";
import { AppError } from "../lib/http";
import { addDays, nyDate } from "../lib/tradingDate";
import { lastTradingDays } from "../lib/usage/stats";
import { marketClosedDays } from "../lib/curatorStore";
import { myPeople, pickScope } from "../lib/people/deskGroups";
import { buildLoop, loadLoopFacts } from "../lib/admin/loopYesterday";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** `?date` (valid calendar day, not in the future) or the last finished trading day. */
async function loopDate(raw: unknown, today: string): Promise<string> {
  if (raw === undefined || raw === "") return (await lastTradingDays(addDays(today, -1), 1))[0] ?? addDays(today, -1);
  const s = String(raw);
  if (!YMD.test(s) || Number.isNaN(Date.parse(`${s}T12:00:00Z`)) || new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) !== s || s > today) {
    throw new AppError("INVALID_DATE");
  }
  return s;
}

export function mountLoopYesterdayRoutes(router: IRouter): void {
  router.get("/admin/loop-yesterday", asyncHandler(async (req, res): Promise<void> => {
    if (!(await requireCap(req, res, "team.read"))) return;
    const today = nyDate();
    const date = await loopDate(req.query.date, today);
    const [readable, mine] = await Promise.all([readScope(req, "team.read"), myPeople(req.authUser!.name)]);
    const { scope, names } = pickScope(req.query.scope, mine);
    let keep: Set<string> | null = readable ? new Set(readable) : null;
    if (names) keep = new Set([...(keep ?? names)].filter((n) => names.has(n)));
    const [facts, closedDays] = await Promise.all([
      loadLoopFacts(date, keep),
      marketClosedDays(today).catch(() => new Set<string>()),
    ]);
    res.json({ scope, mine: mine.length > 0, ...buildLoop(date, facts, closedDays) });
  }));
}
