/**
 * One live fills cycle (the loop is ./loop.ts): today's fills of the desk → journal trades, in seconds.
 *
 *   fetch      ONE `fills` call for today in the tick's own scope (the group, or PROPREPORTS_ACCOUNT_IDS) — page size
 *              50 000, so the whole desk is one request whatever the number of accounts; more pages only on a day with
 *              > 50 000 fills (bounded by the cycle budget; a partial day is never applied, the full sync takes it)
 *   detect     per broker account a fingerprint of today's fills (tick/fillsStep accountFingerprint) against the cursor
 *              "live:acct:<account>": a quiet desk costs that one call and no writes. Only accounts mapped to an active
 *              trader are looked at — unmapped / inactive ones are the full sync's business (it records them).
 *   carry      an account with an open broker trade from an earlier day (or a fill that closes a position not opened
 *              today): its trips need the older fills, so they are fetched for [oldest open day, today] scoped to its
 *              PropReports account id (one more call, within the budget). Without an account id it is left to the full sync.
 *   ingest     the SAME path as the 5-minute sync: canonicalizeFillIds → buildRoundTrips → planSync → applySync
 *              (dedup by external id, fee settings, savepoint per trade, trade caches + DB stamp bumped, outbox kicked).
 *              The "propreports.synced" event is coalesced by the loop (≤ 1 a minute) instead of one per cycle.
 *   cursors    written only for accounts that were really applied; the rest is looked at again next cycle.
 *
 * The 5-minute full sync (tick step fills.recent) keeps running as the reconciliation pass: it re-plans the accounts
 * this cycle wrote (their window fingerprint moved) and finds them unchanged.
 */
import type { Logger } from "pino";
import { pool } from "@workspace/db";
import { addDays, nyDate } from "../../tradingDate";
import { buildRoundTrips } from "../round-trips";
import { applySync, loadAccountMappings, planSync, resolveAccount, type AccountMapping, type SyncPlan, type SyncRunResult } from "../sync";
import { changedTraders } from "../syncEffects";
import { canonicalizeFillIds } from "../replacement";
import { getCursors, setCursor } from "../tick/cursor";
import { accountFingerprint, groupByAccount } from "../tick/fillsStep";
import type { DetectedFeeColumn } from "../fees";
import type { Fill } from "../types";
import type { FillQuery, PropReportsClient } from "../client";
import { RequestBudget } from "./policy";

export const LIVE_CURSOR_PREFIX = "live:acct:";
/** A carried position older than this is the full sync's (scheduler.fetchStartFor uses the same 10 days). */
const MAX_CARRY_DAYS = 10;
/** Account ids per scoped `fills` call. */
const IDS_PER_CALL = 50;

export type LiveCursor = { fp: string; date: string; fills: number; lastFillAt: string | null; syncedAt: string };

export type LiveCycleResult = {
  requests: number;
  fills: number;
  changed: number;
  deferred: number;
  inserted: number;
  updated: number;
  /** Traders whose book changed (for the coalesced "propreports.synced" event). */
  traders: string[];
  /** Seconds between the newest fill of a changed account and now (what PropReports + this loop added), or null. */
  lagSec: number | null;
  note: string;
};

type FillsClient = Pick<PropReportsClient, "fillsPage">;

export type LiveCycleCtx = { now: Date; deadline: number; client: FillsClient; log: Pick<Logger, "warn" | "info">; budget?: RequestBudget };

/** Everything with I/O besides the client (tests inject fakes). */
export type LiveCycleDeps = {
  loadMappings: () => Promise<AccountMapping[]>;
  getCursors: () => Promise<Map<string, LiveCursor>>;
  setCursor: (key: string, value: LiveCursor) => Promise<void>;
  /** raw broker account → oldest open broker trade date before `today` (accounts without one are absent). */
  carryStarts: (accounts: string[], today: string) => Promise<Map<string, string>>;
  canonicalize: (fills: Fill[]) => Promise<Fill[]>;
  plan: (trips: ReturnType<typeof buildRoundTrips>["trips"]) => Promise<SyncPlan>;
  apply: (plan: SyncPlan, opts: Parameters<typeof applySync>[1]) => Promise<SyncRunResult>;
};

export const defaultLiveDeps: LiveCycleDeps = {
  loadMappings: () => loadAccountMappings(),
  getCursors: () => getCursors<LiveCursor>(LIVE_CURSOR_PREFIX),
  setCursor: (key, value) => setCursor(key, value),
  carryStarts: async (accounts, today) => {
    if (!accounts.length) return new Map();
    const { rows } = await pool.query(
      `SELECT broker_account AS a, MIN(LEFT(date, 10)) AS d FROM trades
        WHERE source = 'propreports' AND deleted_at IS NULL AND LOWER(COALESCE(result, '')) = 'open'
          AND broker_account = ANY($1::text[]) AND LEFT(date, 10) < $2
        GROUP BY broker_account`,
      [accounts, today],
    );
    return new Map(rows.map((r: { a: string; d: string }) => [String(r.a), String(r.d)]));
  },
  canonicalize: async (fills) => (await canonicalizeFillIds(fills)).fills,
  plan: (trips) => planSync(trips),
  apply: (plan, opts) => applySync(plan, opts),
};

type Fetched = { fills: Fill[]; feeColumns: DetectedFeeColumn[]; complete: boolean };

/** Every page of fills for [from, to] in `scope`, one budget unit per call; complete:false when the budget / deadline ran out. */
export async function fetchLivePages(client: FillsClient, from: string, to: string, scope: FillQuery, budget: RequestBudget, deadline: number): Promise<Fetched> {
  const fills: Fill[] = [];
  const fee = new Map<string, DetectedFeeColumn>();
  let total = 1;
  for (let page = 1; page <= total; page++) {
    if (Date.now() > deadline - 2_000 || !budget.take()) return { fills, feeColumns: [...fee.values()], complete: false };
    const r = await client.fillsPage(from, to, page, scope);
    total = Math.max(1, r.page.total);
    fills.push(...r.fills);
    for (const c of r.feeColumns) fee.set(c.key, c);
  }
  return { fills, feeColumns: [...fee.values()], complete: true };
}

const NY_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Seconds from the newest of `fills` (naive New York "YYYY-MM-DD HH:MM:SS") to `now`; null when none is from today. */
export function fillLagSec(fills: Fill[], now: Date): number | null {
  const today = nyDate(now);
  const newest = fills.reduce<string | null>((m, f) => (f.dateTime.startsWith(today) && (m == null || f.dateTime > m) ? f.dateTime : m), null);
  if (!newest) return null;
  const sec = (hms: string) => { const [h, m, s] = hms.split(":").map(Number); return h * 3600 + m * 60 + Math.floor(s || 0); };
  return Math.max(0, sec(NY_CLOCK.format(now)) - sec(newest.slice(11, 19)));
}

const empty = (requests: number, note: string, fills = 0): LiveCycleResult => ({ requests, fills, changed: 0, deferred: 0, inserted: 0, updated: 0, traders: [], lagSec: null, note });

export async function runLiveCycle(ctx: LiveCycleCtx, deps: LiveCycleDeps = defaultLiveDeps): Promise<LiveCycleResult> {
  const budget = ctx.budget ?? new RequestBudget();
  const today = nyDate(ctx.now);
  const mappings = await deps.loadMappings();
  const live = mappings.filter((m) => m.active && m.trader);
  if (!live.length) return empty(0, "no active mapped accounts");

  const day = await fetchLivePages(ctx.client, today, today, {}, budget, ctx.deadline);
  if (!day.complete) return empty(budget.used, `today's fills need more than ${budget.max} calls — left to the full sync`, day.fills.length);

  // Raw broker account → its mapping, only for accounts of active traders.
  const mappingOf = new Map<string, AccountMapping>();
  const byAccount = groupByAccount(day.fills);
  for (const raw of byAccount.keys()) {
    const m = resolveAccount(raw, mappings)?.mapping;
    if (m && m.active && m.trader) mappingOf.set(raw, m);
  }
  const cursors = await deps.getCursors();
  const changed: Array<{ account: string; fp: string; fills: Fill[] }> = [];
  for (const [account, fills] of byAccount) {
    if (!mappingOf.has(account)) continue;
    const fp = accountFingerprint(fills, today);
    if (cursors.get(LIVE_CURSOR_PREFIX + account)?.fp !== fp) changed.push({ account, fp, fills });
  }
  if (!changed.length) return empty(budget.used, `${today}: ${day.fills.length} fills, no changes`, day.fills.length);

  // Carried positions: fetch their older fills (scoped by account id), or leave them to the full sync.
  const deferred = new Set<string>();
  const fillsFor = new Map(changed.map((c) => [c.account, c.fills]));
  const carry = await deps.carryStarts(changed.map((c) => c.account), today);
  const floor = addDays(today, -MAX_CARRY_DAYS);
  const carryIds: Array<{ account: string; id: string; from: string }> = [];
  for (const [account, d] of carry) {
    const id = mappingOf.get(account)?.accountId;
    if (!id || d < floor) deferred.add(account);
    else carryIds.push({ account, id, from: d });
  }
  let feeColumns = day.feeColumns;
  for (let i = 0; i < carryIds.length; i += IDS_PER_CALL) {
    const chunk = carryIds.slice(i, i + IDS_PER_CALL);
    const from = chunk.reduce((m, c) => (c.from < m ? c.from : m), today);
    const got = await fetchLivePages(ctx.client, from, today, { accountIds: chunk.map((c) => c.id) }, budget, ctx.deadline);
    if (!got.complete) { for (const c of chunk) deferred.add(c.account); continue; }
    const window = groupByAccount(got.fills);
    for (const c of chunk) fillsFor.set(c.account, window.get(c.account) ?? fillsFor.get(c.account) ?? []);
    feeColumns = [...new Map([...feeColumns, ...got.feeColumns].map((f) => [f.key, f])).values()];
  }

  const fills = await deps.canonicalize(changed.filter((c) => !deferred.has(c.account)).flatMap((c) => fillsFor.get(c.account) ?? []));
  const built = buildRoundTrips(fills);
  // A fill that closes a position not opened in the data: the window is too short for that account — full sync's.
  for (const f of built.orphanFills) deferred.add(f.account);
  const trips = built.trips.filter((t) => !deferred.has(t.account));
  const lagSec = fillLagSec(changed.flatMap((c) => c.fills), ctx.now);

  let result: SyncRunResult | null = null;
  const failed = new Set<string>();
  let plan: SyncPlan | null = null;
  if (trips.length) {
    plan = await deps.plan(trips);
    const writes = plan.counts.insert + plan.counts.update + plan.counts.adopt + plan.counts.conflict;
    if (writes > 0) {
      let itemErrors = 0;
      result = await deps.apply(plan, {
        actor: "live", source: "api", dateFrom: plan.dateFrom ?? today, dateTo: today, feeColumns, syncedEvent: false, audit: false,
        details: { live: true, fills: fills.length, accounts: changed.length - deferred.size },
        onItemError: (it) => { itemErrors++; failed.add(it.trip.account); },
      });
      if (result.errors > itemErrors) throw new Error(`live apply failed: ${(result.errorText ?? "").slice(0, 300)}`);
      if (itemErrors) ctx.log.warn({ errors: itemErrors, accounts: [...failed] }, "propreports live: some trades failed");
    }
  }

  const notApplied = new Set([...deferred, ...failed, ...(plan?.unmappedAccounts ?? []), ...(plan?.inactiveAccounts ?? [])]);
  const syncedAt = ctx.now.toISOString();
  for (const c of changed) {
    if (notApplied.has(c.account)) continue;
    const lastFillAt = c.fills.reduce<string | null>((m, f) => (m == null || f.dateTime > m ? f.dateTime : m), null);
    await deps.setCursor(LIVE_CURSOR_PREFIX + c.account, { fp: c.fp, date: today, fills: c.fills.length, lastFillAt, syncedAt });
  }
  const wrote = !!result && result.inserted + result.updated > 0;
  return {
    requests: budget.used,
    fills: day.fills.length,
    changed: changed.length,
    deferred: deferred.size,
    inserted: result?.inserted ?? 0,
    updated: result?.updated ?? 0,
    traders: wrote && plan ? changedTraders(plan) : [],
    lagSec,
    note: `${today}: ${changed.length} account(s) changed${result ? `, +${result.inserted} ~${result.updated}` : ", no writes"}${deferred.size ? `, ${deferred.size} left to the full sync` : ""}`,
  };
}
