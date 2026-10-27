/**
 * Capital proposals in the scaling queue (scaling_proposals kind 'limits', migration 0270): decide, withdraw, revert.
 *
 *   approve   one transaction: the proposal is still pending and the trader's daily limit is still the one the engine
 *             saw (else CAPITAL_LIMITS_CHANGED — recount) → trader_risk_limits (daily loss limit, buying power) +
 *             trader_risk_limit_events (before / after, the limit history of /risk) + scaling_history (action raise / cut,
 *             limits { kind: 'capital', before, after, eventId }) + the proposal approved + audit_log «capital.apply».
 *             Then (best-effort) the intervention log (limit_change) and the trader's notification (limit_change).
 *   reject    status rejected + audit «capital.reject».
 *   withdraw  the tier flow goes first (routes/scaling createProposal) / a recount says keep: status rejected by the
 *             actor with a stored note in their language.
 *   revert    a capital change back to its «before» values (only while the limit is still the «after» one), as a new
 *             scaling_history row (action revert, limits.revertOf) + limit event + audit «capital.revert». Revert twice → 409.
 * The ladder's own tier changes (/scaling approve, assign, templates) close a pending capital proposal of the trader.
 */
import { pool } from "@workspace/db";
import { capitalT } from "../../i18n/ns";
import type { Lang } from "../../i18n";
import { AppError, conflict, notFound } from "../http";
import { toLimits } from "../riskData";
import { logInterventionSafe } from "../interventions/log";
import { notifyUser } from "../notifyUtils";
import { notifLinks } from "../notificationCore";
import { inBackground } from "../notifyEvents";
import { limitsDiffParams } from "../notifyEventsCore";
import type { Limits } from "../riskMetrics";
import { dropCapitalCache } from "./cache";

export { renderCapitalReasons } from "./text";

/** scaling_proposals.limits of a capital proposal. */
export type CapitalPayload = {
  /** ISO week of the run (one proposal per trader and week, lib/capital/service). */
  week: string;
  direction: "raise" | "cut";
  stepPct: number;
  before: { dailyLossLimit: number | null; buyingPower: number | null };
  after: { dailyLossLimit: number | null; buyingPower: number | null };
  expected: { perDay: number; sdPerDay: number } | null;
  composite: number | null;
};

type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const COLS = `id, trader, action, from_tier, to_tier, status, source, reasons, comment, created_by, created_at, decided_by, decided_at, decision_comment, kind, limits`;
const same = (a: unknown, b: unknown) => (a == null ? null : Number(a)) === (b == null ? null : Number(b));
const strip = (l: Limits | null) => {
  if (!l) return null;
  const { updatedBy: _b, updatedAt: _a, ...rest } = l;
  return rest;
};

export async function isCapitalProposal(id: number): Promise<boolean> {
  const { rows } = await pool.query<{ kind: string }>(`SELECT kind FROM scaling_proposals WHERE id = $1`, [id]);
  return rows[0]?.kind === "limits";
}

/** Closes the trader's pending capital proposal (the tier decision goes first / a recount says keep). */
export async function withdrawCapitalProposal(trader: string, actor: string, lang: Lang = "ru", why: "ladder" | "keep" = "ladder", q: Client = pool): Promise<number> {
  const { rows } = await q.query(
    `UPDATE scaling_proposals SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_comment = $3,
            limits = COALESCE(limits, '{}'::jsonb) || '{"withdrawn": true}'::jsonb
      WHERE trader = $1 AND status = 'pending' AND kind = 'limits' RETURNING id`,
    [trader, actor, capitalT.tFor(lang)(`decision.${why}`)],
  );
  return rows.length;
}

async function audit(q: Client, actor: string, action: string, trader: string, details: unknown): Promise<void> {
  await q.query(`INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES ($1, $2, 'trader_risk_limits', $3, $4)`, [actor, action, trader, JSON.stringify(details)]);
}

async function inTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Writes new daily limit / BP + the limit event + the scaling_history row. Caller holds the row lock (FOR UPDATE). */
async function writeLimits(c: Client, o: {
  trader: string; before: any; daily: number | null; bp: number | null; actor: string; reason: string;
  history: { action: string; proposalId: number | null; comment: string | null; extra: Record<string, unknown> };
}): Promise<{ eventId: number; historyId: number; before: Limits; after: Limits }> {
  const { rows } = await c.query(
    `UPDATE trader_risk_limits SET daily_loss_limit = $2, buying_power = $3, updated_by = $4, updated_at = NOW() WHERE trader = $1 RETURNING *`,
    [o.trader, o.daily, o.bp, o.actor],
  );
  const before = toLimits(o.before);
  const after = toLimits(rows[0]);
  const ev = await c.query(
    `INSERT INTO trader_risk_limit_events (trader, before, after, reason, changed_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [o.trader, JSON.stringify(strip(before)), JSON.stringify(strip(after)), o.reason, o.actor],
  );
  const eventId = Number(ev.rows[0].id);
  const tier = after.tier ?? null;
  const h = await c.query(
    `INSERT INTO scaling_history (trader, action, from_tier, to_tier, proposal_id, actor, comment, limits)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
    [o.trader, o.history.action, tier ?? "", o.history.proposalId, o.actor, o.history.comment, JSON.stringify({
      kind: "capital", eventId, ...o.history.extra,
      before: { dailyLossLimit: before.dailyLossLimit, buyingPower: before.buyingPower },
      after: { dailyLossLimit: after.dailyLossLimit, buyingPower: after.buyingPower },
    })],
  );
  return { eventId, historyId: Number(h.rows[0].id), before, after };
}

function afterApply(trader: string, actor: string, eventId: number, before: Limits, after: Limits, params: Record<string, unknown>): void {
  void logInterventionSafe({ trader, kind: "limit_change", author: actor, params, sourceTable: "trader_risk_limit_events", sourceId: eventId });
  if (actor === trader) return;
  inBackground("capital.limits", () => notifyUser({
    userName: trader, type: "limit_change", actor, source: "risk",
    params: { variant: "manual", actor, ...limitsDiffParams(before, after) },
    link: notifLinks.risk(trader), entityType: "risk_limits", entityId: trader,
  }));
}

/** Applies a pending capital proposal (inside the caller's transaction): throws on a decided / stale proposal. */
async function applyIn(c: Client, id: number, actor: string, comment: string | null, lang: Lang) {
  const { rows } = await c.query(`SELECT ${COLS} FROM scaling_proposals WHERE id = $1 FOR UPDATE`, [id]);
  const p = rows[0];
  if (!p || p.kind !== "limits") throw notFound("PROPOSAL_NOT_FOUND");
  if (p.status !== "pending") throw conflict("PROPOSAL_DECIDED");
  const payload = p.limits as CapitalPayload;
  const { rows: cur } = await c.query(`SELECT * FROM trader_risk_limits WHERE trader = $1 FOR UPDATE`, [p.trader]);
  if (!cur[0] || !same(cur[0].daily_loss_limit, payload.before.dailyLossLimit)) throw conflict("CAPITAL_LIMITS_CHANGED");
  const bp = same(cur[0].buying_power, payload.before.buyingPower) ? payload.after.buyingPower : cur[0].buying_power;
  const reason = capitalT.tFor(lang)("applied", { direction: capitalT.tFor(lang)(`direction.${payload.direction}`), pct: Math.abs(payload.stepPct), id });
  const w = await writeLimits(c, {
    trader: p.trader, before: cur[0], daily: payload.after.dailyLossLimit, bp: bp == null ? null : Number(bp), actor, reason,
    history: { action: payload.direction, proposalId: id, comment, extra: { stepPct: payload.stepPct } },
  });
  const { rows: upd } = await c.query(
    `UPDATE scaling_proposals SET status = 'approved', decided_by = $2, decided_at = NOW(), decision_comment = $3 WHERE id = $1 RETURNING id`,
    [id, actor, comment],
  );
  await audit(c, actor, "capital.apply", p.trader, { proposalId: id, direction: payload.direction, stepPct: payload.stepPct, before: payload.before, after: { dailyLossLimit: w.after.dailyLossLimit, buyingPower: w.after.buyingPower }, historyId: w.historyId, comment });
  return { trader: String(p.trader), proposalId: Number(upd[0].id), historyId: w.historyId, eventId: w.eventId, before: w.before, after: w.after, direction: payload.direction };
}

export type Decided = { id: number; trader: string; status: "approved" | "rejected"; historyId: number | null };

export async function decideCapitalProposal(id: number, decision: "approve" | "reject", actor: string, comment: string | null, lang: Lang = "ru"): Promise<Decided> {
  if (decision === "reject") {
    const { rows } = await pool.query(
      `UPDATE scaling_proposals SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_comment = $3
        WHERE id = $1 AND kind = 'limits' AND status = 'pending' RETURNING trader`,
      [id, actor, comment],
    );
    if (!rows[0]) {
      const { rows: ex } = await pool.query(`SELECT 1 FROM scaling_proposals WHERE id = $1 AND kind = 'limits'`, [id]);
      throw ex[0] ? conflict("PROPOSAL_DECIDED") : notFound("PROPOSAL_NOT_FOUND");
    }
    await audit(pool, actor, "capital.reject", String(rows[0].trader), { proposalId: id, comment });
    dropCapitalCache();
    return { id, trader: String(rows[0].trader), status: "rejected", historyId: null };
  }
  const r = await inTx((c) => applyIn(c, id, actor, comment, lang));
  dropCapitalCache();
  afterApply(r.trader, actor, r.eventId, r.before, r.after, { variant: "capital", direction: r.direction, proposalId: id });
  return { id, trader: r.trader, status: "approved", historyId: r.historyId };
}

/** «Одобрить все»: every pending capital proposal (or the listed ones), each in its own transaction; stale ones are skipped. */
export async function approveAllCapital(actor: string, lang: Lang = "ru", ids?: readonly number[]): Promise<{ approved: number[]; skipped: { id: number; code: string }[] }> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM scaling_proposals WHERE kind = 'limits' AND status = 'pending' AND ($1::int[] IS NULL OR id = ANY($1::int[])) ORDER BY id`,
    [ids?.length ? [...ids] : null],
  );
  const approved: number[] = [];
  const skipped: { id: number; code: string }[] = [];
  for (const { id } of rows) {
    try {
      await decideCapitalProposal(Number(id), "approve", actor, null, lang);
      approved.push(Number(id));
    } catch (e) {
      skipped.push({ id: Number(id), code: e instanceof AppError ? e.code : "INTERNAL" });
    }
  }
  return { approved, skipped };
}

/** Restores the «before» limits of a capital change (scaling_history row). */
export async function revertCapitalChange(historyId: number, actor: string, lang: Lang = "ru"): Promise<{ trader: string; historyId: number }> {
  const r = await inTx(async (c) => {
    const { rows } = await c.query(`SELECT id, trader, action, limits FROM scaling_history WHERE id = $1 FOR UPDATE`, [historyId]);
    const h = rows[0];
    if (!h) throw notFound("NOT_FOUND");
    const lim = h.limits as { kind?: string; before?: { dailyLossLimit: number | null; buyingPower: number | null }; after?: { dailyLossLimit: number | null; buyingPower: number | null } } | null;
    if (lim?.kind !== "capital" || (h.action !== "raise" && h.action !== "cut") || !lim.before || !lim.after) throw new AppError("CAPITAL_NOT_REVERTIBLE");
    const { rows: done } = await c.query(`SELECT 1 FROM scaling_history WHERE action = 'revert' AND limits ->> 'revertOf' = $1 LIMIT 1`, [String(historyId)]);
    if (done.length) throw conflict("CAPITAL_ALREADY_REVERTED");
    const { rows: cur } = await c.query(`SELECT * FROM trader_risk_limits WHERE trader = $1 FOR UPDATE`, [h.trader]);
    if (!cur[0] || !same(cur[0].daily_loss_limit, lim.after.dailyLossLimit)) throw conflict("CAPITAL_LIMITS_CHANGED");
    const bp = same(cur[0].buying_power, lim.after.buyingPower) ? lim.before.buyingPower : cur[0].buying_power;
    const w = await writeLimits(c, {
      trader: h.trader, before: cur[0], daily: lim.before.dailyLossLimit, bp: bp == null ? null : Number(bp), actor,
      reason: capitalT.tFor(lang)("reverted", { id: historyId }),
      history: { action: "revert", proposalId: null, comment: null, extra: { revertOf: historyId } },
    });
    await audit(c, actor, "capital.revert", h.trader, { historyId, newHistoryId: w.historyId, before: lim.after, after: lim.before });
    return { trader: String(h.trader), ...w };
  });
  afterApply(r.trader, actor, r.eventId, r.before, r.after, { variant: "capital_revert", revertOf: historyId });
  return { trader: r.trader, historyId: r.historyId };
}

/** Applied capital changes (newest first) with whether each was reverted — the «Откатить» list. */
export async function capitalHistory(limit = 30): Promise<{ id: number; trader: string; action: string; actor: string; createdAt: string; before: unknown; after: unknown; reverted: boolean }[]> {
  const { rows } = await pool.query(
    `SELECT h.id, h.trader, h.action, h.actor, h.created_at, h.limits,
            EXISTS (SELECT 1 FROM scaling_history r WHERE r.action = 'revert' AND r.limits ->> 'revertOf' = h.id::text) AS reverted
       FROM scaling_history h
      WHERE h.limits ->> 'kind' = 'capital' AND h.action IN ('raise', 'cut')
      ORDER BY h.created_at DESC, h.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r: any) => ({
    id: Number(r.id), trader: String(r.trader), action: String(r.action), actor: String(r.actor),
    createdAt: new Date(r.created_at).toISOString(), before: r.limits?.before ?? null, after: r.limits?.after ?? null, reverted: r.reverted === true,
  }));
}
