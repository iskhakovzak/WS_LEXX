/**
 * Tick step "reconcile.nightly" (phase 3 ACCURACY): per mapped account per day, our journal net vs the PropReports
 * "Summary by Date" report (report&type=summary&accountId=…), results in propreports_reconcile_days (mismatches > $1
 * are what the admin panel lists — components/propreports/reconcile-broker-panel.tsx).
 *
 *   when      once per evening: the target day is today (NY) from 20:00 ET, else yesterday; window = the target and
 *             the RECONCILE_DAYS − 1 calendar days before it (late corrections and re-imports show up there)
 *   progress  cursor "reconcile:run" { target, from, to, done[] } — one report call per account; a deadline pauses the
 *             run (done: false) and the next tick continues with the accounts not done yet
 *   accounts  active mappings with a trader and a broker account id (the report is per account id); the rest are
 *             counted in the note
 */
import { addDays, nyDate, nyMinutes } from "../../tradingDate";
import { getCursor, setCursor } from "../tick/cursor";
import { everyMinutes, remainingMs } from "../tick/due";
import type { TickStep } from "../tick/types";
import { loadAccountMappings, type AccountMapping } from "../sync";
import { carryDays, compareDays, parseSummaryByDate } from "../reconcile-broker";
import { accountNames, loadOurDays, saveComparisons } from "../reconcile-broker-store";

export const RECONCILE_DAYS = 5;
export const RECONCILE_REPORT_TYPE = "summary";
const EVENING_MIN = 20 * 60; // after the 19:00 ET adjustments run, so adjustment diffs compare fresh rows
const MIN_ACCOUNT_MS = 5_000;
const CURSOR_KEY = "reconcile:run";

export type ReconcileCursor = { target: string; from: string; to: string; done: string[]; mismatches: number; skipped: number; unparsed: number; total?: number; startedAt: string; finishedAt: string | null };

/** Pure: the NY date whose close tonight's run reconciles. */
export function reconcileTarget(now: Date): string {
  const today = nyDate(now);
  return nyMinutes(now) >= EVENING_MIN ? today : addDays(today, -1);
}

/** Pure: mappings the report can be asked for. */
export function reconcilableAccounts(mappings: AccountMapping[]): { accounts: AccountMapping[]; skipped: number } {
  const accounts = mappings.filter((m) => m.active && m.trader && m.accountId);
  return { accounts, skipped: mappings.filter((m) => m.active && m.trader && !m.accountId).length };
}

export const reconcileStep: TickStep = {
  name: "reconcile.nightly",
  due: everyMinutes(60),
  async run(ctx) {
    const target = reconcileTarget(ctx.now);
    let cur = await getCursor<ReconcileCursor>(CURSOR_KEY);
    if (cur && cur.target === target && cur.finishedAt) return { done: true, note: `already reconciled ${target}` };
    if (!cur || cur.target !== target) {
      cur = { target, from: addDays(target, -(RECONCILE_DAYS - 1)), to: target, done: [], mismatches: 0, skipped: 0, unparsed: 0, startedAt: ctx.now.toISOString(), finishedAt: null };
    }
    const { accounts, skipped } = reconcilableAccounts(await loadAccountMappings());
    cur.skipped = skipped;
    cur.total = accounts.length;
    const done = new Set(cur.done);
    for (const m of accounts) {
      if (done.has(m.accountId!)) continue;
      if (remainingMs(ctx.deadline) < MIN_ACCOUNT_MS) {
        await setCursor(CURSOR_KEY, cur);
        return { done: false, note: `reconcile ${target}: ${done.size}/${accounts.length} accounts, paused` };
      }
      const text = await ctx.client.report(RECONCILE_REPORT_TYPE, cur.from, cur.to, { accountId: m.accountId! });
      const broker = parseSummaryByDate(text);
      if (!broker.columns.length && text.trim()) {
        cur.unparsed++;
        ctx.log.warn({ account: m.account, head: text.trim().split(/\r?\n/)[0]?.slice(0, 200) }, "propreports reconcile: report not recognised");
      } else {
        const names = accountNames(m);
        const ours = await loadOurDays(names, cur.from, cur.to);
        const rows = compareDays(ours.days, broker.days, { carry: carryDays(ours.spans, cur.from, cur.to), from: cur.from, to: cur.to });
        const saved = await saveComparisons({ account: m.account, accountId: m.accountId, trader: m.trader }, rows);
        cur.mismatches += saved.mismatches;
      }
      done.add(m.accountId!);
      cur.done = [...done];
      await setCursor(CURSOR_KEY, cur);
    }
    cur.finishedAt = new Date().toISOString();
    await setCursor(CURSOR_KEY, cur);
    return { done: true, note: `reconcile ${cur.from}..${cur.to}: ${accounts.length} accounts, ${cur.mismatches} day(s) off by > $1, ${skipped} without account id, ${cur.unparsed} unparsed` };
  },
};

export async function reconcileRunState(): Promise<ReconcileCursor | null> {
  return getCursor<ReconcileCursor>(CURSOR_KEY);
}
