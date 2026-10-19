/**
 * Tick step "fills.recent": today's (and recent) fills of the whole group → journal trades.
 *
 *   window   [today − 1 day, today] (New York dates), reaching back to the oldest still-open broker trade (≤ 10 days,
 *            scheduler.fetchStartFor) so an overnight / swing exit pairs with its entry
 *   bounded  pages are fetched one by one under the tick deadline (≤ MAX_PAGES); a partial fetch is NOT applied
 *            (a trip with its exit on the missing page would look open) — the step returns done:false and the next
 *            tick starts over (cheap: fingerprints skip what did not change)
 *   cursors  one per broker account, "fills:acct:<account>" = { fp, from, fills, lastFillAt, syncedAt }: an account
 *            whose fills fingerprint did not change since the last applied tick is not re-planned, so a quiet desk costs
 *            one API call and no DB writes every 5 minutes. Accounts that are unmapped / inactive get no cursor
 *            (they are re-planned once a mapping appears).
 *   writes   planSync + applySync (idempotent; side effects go to the outbox inside its transaction)
 */
import { createHash } from "node:crypto";
import { addDays, nyDate } from "../../tradingDate";
import { buildRoundTrips } from "../round-trips";
import { applySync, planSync, rememberSeen, type SyncRunResult } from "../sync";
import { fetchStartFor } from "../scheduler";
import { canonicalizeFillIds } from "../replacement";
import { getCursors, setCursor } from "./cursor";
import { deskCadence, remainingMs } from "./due";
import type { Fill } from "../types";
import type { DetectedFeeColumn } from "../fees";
import type { PropReportsClient } from "../client";
import type { TickCtx, TickStep, TickStepResult } from "./types";

export const MAX_PAGES = 20;
const CURSOR_PREFIX = "fills:acct:";

export type AccountCursor = { fp: string; from: string; fills: number; lastFillAt: string | null; syncedAt: string };

/** Stable fingerprint of one account's fills in the window (order-independent; includes the window start). */
export function accountFingerprint(fills: Fill[], from: string): string {
  const keys = fills
    .map((f) => [f.propReportsId ?? f.fillId ?? "", f.dateTime, f.side, f.qty, f.symbol, f.price, f.status ?? ""].join("|"))
    .sort();
  return createHash("sha1").update(from).update("\n").update(keys.join("\n")).digest("hex");
}

export function groupByAccount(fills: Fill[]): Map<string, Fill[]> {
  const m = new Map<string, Fill[]>();
  for (const f of fills) {
    const arr = m.get(f.account);
    if (arr) arr.push(f); else m.set(f.account, [f]);
  }
  return m;
}

/** Accounts whose fingerprint differs from the stored cursor. */
export function changedAccounts(byAccount: Map<string, Fill[]>, from: string, cursors: Map<string, AccountCursor>): Array<{ account: string; fp: string; fills: Fill[] }> {
  const out: Array<{ account: string; fp: string; fills: Fill[] }> = [];
  for (const [account, fills] of byAccount) {
    const fp = accountFingerprint(fills, from);
    if (cursors.get(CURSOR_PREFIX + account)?.fp !== fp) out.push({ account, fp, fills });
  }
  return out;
}

export type PagedFills = { fills: Fill[]; feeColumns: DetectedFeeColumn[]; pages: number; total: number; complete: boolean };

/** Fetch every page of fills for the window, stopping early (complete:false) when the deadline gets close. */
export async function fetchFillsBounded(client: PropReportsClient, from: string, to: string, deadline: number, maxPages = MAX_PAGES): Promise<PagedFills> {
  const fills: Fill[] = [];
  const fee = new Map<string, DetectedFeeColumn>();
  let total = 1;
  let page = 1;
  for (; page <= Math.min(total, maxPages); page++) {
    if (remainingMs(deadline) < 4000) return { fills, feeColumns: [...fee.values()], pages: page - 1, total, complete: false };
    const r = await client.fillsPage(from, to, page);
    total = Math.max(1, r.page.total);
    fills.push(...r.fills);
    for (const c of r.feeColumns) fee.set(c.key, c);
  }
  return { fills, feeColumns: [...fee.values()], pages: page - 1, total, complete: total <= maxPages };
}

export async function syncRecentFills(ctx: TickCtx): Promise<TickStepResult> {
  const today = nyDate(ctx.now);
  const fromDate = await fetchStartFor(new Date(`${addDays(today, -1)}T00:00:00Z`), ctx.now);
  const from = fromDate.toISOString().slice(0, 10);
  const fetched = await fetchFillsBounded(ctx.client, from, today, ctx.deadline);
  if (!fetched.complete) return { done: false, note: `partial fetch ${fetched.pages}/${fetched.total} pages — retry next tick` };

  const { fills } = await canonicalizeFillIds(fetched.fills);
  const byAccount = groupByAccount(fills);
  const cursors = await getCursors<AccountCursor>(CURSOR_PREFIX);
  const changed = changedAccounts(byAccount, from, cursors);
  if (!changed.length) return { done: true, note: `${from}…${today}: ${fills.length} fills, no changes` };

  const { trips, orphanFills } = buildRoundTrips(changed.flatMap((c) => c.fills));
  const plan = await planSync(trips);
  const writes = plan.counts.insert + plan.counts.update + plan.counts.adopt + plan.counts.conflict;
  let result: SyncRunResult | null = null;
  if (writes > 0) {
    result = await applySync(plan, {
      actor: "tick", source: "api", dateFrom: from, dateTo: today, feeColumns: fetched.feeColumns, kick: false,
      details: { tick: true, fills: fills.length, accounts: changed.length, orphanCount: orphanFills.length },
    });
    if (result.errors && !result.inserted && !result.updated) throw new Error(`apply failed: ${(result.errorText ?? "").slice(0, 300)}`);
  } else {
    await rememberSeen(plan.unmappedAccounts, fetched.feeColumns);
  }

  // Cursors only for accounts that were really applied (mapped + active, no errors): the rest is re-planned next tick.
  const notApplied = new Set([...plan.unmappedAccounts, ...plan.inactiveAccounts]);
  const syncedAt = ctx.now.toISOString();
  if (!result || !result.errors) {
    for (const c of changed) {
      if (notApplied.has(c.account)) continue;
      const lastFillAt = c.fills.reduce<string | null>((m, f) => (m == null || f.dateTime > m ? f.dateTime : m), null);
      await setCursor(CURSOR_PREFIX + c.account, { fp: c.fp, from, fills: c.fills.length, lastFillAt, syncedAt } satisfies AccountCursor);
    }
  }
  const counts = result ? `+${result.inserted} ~${result.updated} ?${result.conflicts}` : "no writes";
  return { done: true, note: `${from}…${today}: ${fills.length} fills, ${changed.length} account(s) changed, ${counts}${notApplied.size ? `, unmapped ${notApplied.size}` : ""}` };
}

export const fillsRecentStep: TickStep = {
  name: "fills.recent",
  // every heartbeat in desk hours (5 min), hourly otherwise (after-hours corrections, overnight adjustments)
  due: deskCadence(5, 60),
  run: syncRecentFills,
};
