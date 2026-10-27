/**
 * Capital allocation — the plan and the queue.
 *
 *   capitalPlan(today)          the engine over the desk now (read-only; memoised CACHE_MS per day + settings)
 *   recomputeCapital(actor)     «Пересчитать» / the weekly job: one pending proposal per trader in the scaling queue
 *                               (scaling_proposals kind 'limits'): new → insert, changed → refreshed in place, same →
 *                               untouched, «keep» now → the pending one is withdrawn. A trader whose capital proposal was
 *                               approved or rejected this ISO week gets no second one (idempotent re-runs). With
 *                               `apply` (the weekly job while settings capital.autoApply is on) the run's proposals are
 *                               approved by «system» right away — through the same audited, reversible path.
 */
import { pool } from "@workspace/db";
import type { Lang } from "../../i18n";
import { nyDate } from "../tradingDate";
import { allocate } from "./engine";
import { loadCapitalInputs } from "./load";
import { capitalSettings } from "./settings";
import { dropCapitalCache, onCapitalCacheDrop } from "./cache";
import { approveAllCapital, withdrawCapitalProposal, type CapitalPayload } from "./decide";
import type { CapPlanRow, CapitalPlan } from "./types";

const CACHE_MS = 60_000;
export const SYSTEM_ACTOR = "system";

type Plan = CapitalPlan & { pending: Map<string, number> };
let memo: { key: string; at: number; value: Promise<Plan> } | null = null;

/** ISO week «YYYY-Www» of a NY trading day. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of the week decides the year
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

async function build(today: string): Promise<Plan> {
  const settings = capitalSettings();
  const data = await loadCapitalInputs(today, settings.windowDays);
  const { rows, desk } = allocate(data.inputs, { settings, tiers: data.tiers, regime: data.regime?.key ?? null });
  return { asOf: today, regime: data.regime, rows, desk, settings, pending: data.pending };
}

export function capitalPlan(today: string = nyDate(), fresh = false): Promise<Plan> {
  const key = `${today}|${JSON.stringify(capitalSettings())}`;
  if (!fresh && memo && memo.key === key && Date.now() - memo.at < CACHE_MS) return memo.value;
  const value = build(today);
  value.catch(() => { if (memo?.value === value) memo = null; });
  memo = { key, at: Date.now(), value };
  return value;
}

onCapitalCacheDrop(() => { memo = null; });
export { dropCapitalCache };

function payloadOf(row: CapPlanRow, week: string): CapitalPayload {
  return {
    week, direction: row.direction === "raise" ? "raise" : "cut", stepPct: row.stepPct,
    before: { ...row.current }, after: { ...row.proposed }, expected: row.expected, composite: row.composite,
  };
}

/** Compact evidence stored with the proposal (no raw trades). */
function snapshotOf(row: CapPlanRow, plan: Plan) {
  const est = (e: { theta: number; lo80: number; hi80: number; n: number } | null) => (e ? { theta: e.theta, lo80: e.lo80, hi80: e.hi80, n: e.n } : null);
  return {
    asOf: plan.asOf, regime: plan.regime, composite: row.composite, band: row.band,
    edge: { trades: row.edge.trades, days: row.edge.days, r: est(row.edge.r), u: est(row.edge.u), proven: row.edge.proven, negative: row.edge.negative },
    regimeEdge: row.regime ? { regime: row.regime.regime, days: row.regime.days, u: est(row.regime.u) } : null,
    discipline: row.discipline, settings: plan.settings,
  };
}

export type RecomputeResult = { week: string; created: number; updated: number; unchanged: number; withdrawn: number; decidedThisWeek: number; applied: number; skipped: number };

export async function recomputeCapital(actor: string, lang: Lang = "ru", opts: { today?: string; apply?: boolean } = {}): Promise<RecomputeResult> {
  const today = opts.today ?? nyDate();
  const plan = await capitalPlan(today, true);
  const week = isoWeek(today);
  const { rows: decided } = await pool.query<{ trader: string }>(
    `SELECT DISTINCT trader FROM scaling_proposals
      WHERE kind = 'limits' AND status IN ('approved', 'rejected') AND limits ->> 'week' = $1 AND COALESCE((limits ->> 'withdrawn')::boolean, false) = false`,
    [week],
  );
  const done = new Set(decided.map((d) => d.trader));
  const out: RecomputeResult = { week, created: 0, updated: 0, unchanged: 0, withdrawn: 0, decidedThisWeek: 0, applied: 0, skipped: 0 };
  const touched: number[] = [];
  for (const row of plan.rows) {
    const pendingId = plan.pending.get(row.trader) ?? null;
    if (row.direction === "keep") {
      const ladder = row.reasons.some((r) => r.code === "gate" && (r.gate === "ladder" || r.gate === "tierPending"));
      if (pendingId) out.withdrawn += await withdrawCapitalProposal(row.trader, actor, lang, ladder ? "ladder" : "keep");
      continue;
    }
    if (done.has(row.trader)) { out.decidedThisWeek++; continue; }
    const payload = payloadOf(row, week);
    const args = [JSON.stringify(row.reasons), JSON.stringify(snapshotOf(row, plan)), JSON.stringify(payload)];
    if (pendingId) {
      const { rows } = await pool.query(
        `UPDATE scaling_proposals SET action = $2, reasons = $3::jsonb, snapshot = $4::jsonb, limits = $5::jsonb
          WHERE id = $1 AND status = 'pending' AND kind = 'limits'
            AND (limits -> 'after' IS DISTINCT FROM ($5::jsonb -> 'after') OR action IS DISTINCT FROM $2 OR limits ->> 'week' IS DISTINCT FROM $6)
          RETURNING id`,
        [pendingId, row.direction, ...args, week],
      );
      if (rows.length) { out.updated++; touched.push(pendingId); } else out.unchanged++;
      continue;
    }
    const { rows } = await pool.query(
      `INSERT INTO scaling_proposals (trader, action, from_tier, to_tier, status, source, reasons, snapshot, kind, limits, created_by)
       VALUES ($1, $2, $3, $3, 'pending', 'auto', $4::jsonb, $5::jsonb, 'limits', $6::jsonb, $7)
       ON CONFLICT (trader) WHERE status = 'pending' DO NOTHING RETURNING id`,
      [row.trader, row.direction, row.tierKey, ...args, actor],
    );
    if (rows[0]) { out.created++; touched.push(Number(rows[0].id)); } else out.skipped++; // a tier proposal got there first
  }
  if (opts.apply && touched.length) {
    const r = await approveAllCapital(SYSTEM_ACTOR, lang, touched);
    out.applied = r.approved.length;
  }
  dropCapitalCache();
  await pool.query(
    `INSERT INTO audit_log (actor, action, target_type, details) VALUES ($1, 'capital.recompute', 'scaling_proposal', $2)`,
    [actor, JSON.stringify({ ...out, regime: plan.regime?.key ?? null, autoApply: !!opts.apply })],
  ).catch(() => undefined); // the run is done; a lost audit row must not fail it
  return out;
}
