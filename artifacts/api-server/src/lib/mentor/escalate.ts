/**
 * Escalation to the human, DB side: detect (lib/mentor/escalation.ts, pure) → skip what is already open → store →
 * one in-app notice to the trader's assigned staff (curator / mentor / risk manager; none assigned → the desk's
 * curators and admins). Never Telegram. No model call — deterministic and free.
 *
 * Runs when a trader opens the mentor's rhythm, and once a day for the whole desk (job mentor.escalations, 18:50 NY
 * Mon–Fri, setting mentor.escalationsEnabled) so a silent trader is noticed too. Staff using the mentor for
 * themselves are never escalated.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { addDays } from "../tradingDate";
import { setting } from "../settings/registry";
import { insertNotification } from "../notifyUtils";
import { staffOrFallback } from "../notifyEvents";
import { fmtUsd } from "../notifyEventsCore";
import { behaviorTradesOf } from "../daily/load";
import { mistakesByTrade } from "../daily/service";
import { riskStateOf, riskSummary } from "../coreMetrics/risk";
import { breaksByDay, trackCommitment } from "./commitments";
import { detectEscalations, freshEscalations, type EscalationCfg } from "./escalation";
import { dayStats, tradedDays, type MentorFacts } from "./facts";
import { escalationsOf, insertEscalation, lastUserMessageDay, listCommitments, type Escalation } from "./store";

export function escalationCfg(): EscalationCfg {
  return {
    tiltDays: setting("mentor.escTiltDays"),
    breakCount: setting("mentor.escBreakCount"),
    breakWindow: 5,
    ddShare: setting("mentor.escDrawdownShare"),
    silenceDays: setting("mentor.escSilenceDays"),
    cooldownDays: 5,
  };
}

async function lastCheckinDay(trader: string): Promise<string | null> {
  const { rows } = await pool.query<{ d: string | null }>(`SELECT MAX(date) AS d FROM emotional_state_log WHERE user_id = $1`, [trader]);
  return rows[0]?.d ?? null;
}

type EscFacts = Pick<MentorFacts, "trader" | "today" | "days" | "tiltDays" | "risk"> & { breaks: Map<string, number> };

const TILT = new Set(["behavior:tilt", "behavior:revenge", "behavior:martingale"]);

/** The escalation inputs without the heavy sources (the nightly desk run). */
async function lightFacts(trader: string, today: string): Promise<EscFacts> {
  const from = addDays(today, -35);
  const [commitments, trades, risk] = await Promise.all([listCommitments(trader, 0), behaviorTradesOf(trader)(from, today), riskStateOf(trader, today)]);
  const oldest = commitments.active.map((c) => c.startedOn).sort()[0];
  const track = oldest && oldest < from ? await behaviorTradesOf(trader)(oldest, today) : trades;
  const progress = commitments.active.map((c) => trackCommitment(c, track));
  const tiltDays = new Set<string>();
  if (trades.length) {
    const dayOf = new Map(trades.map((t) => [t.id, t.date]));
    for (const [id, ms] of await mistakesByTrade(trader, from, today)) if (ms.some((m) => TILT.has(m))) { const d = dayOf.get(id); if (d) tiltDays.add(d); }
  }
  return { trader, today, days: dayStats(trades, risk.days), tiltDays, risk: riskSummary(risk), breaks: breaksByDay(progress) };
}

const money = (v: number | undefined) => (v == null ? "" : fmtUsd(v));

async function escalate(f: EscFacts): Promise<Escalation[]> {
  const lastActivity = [await lastUserMessageDay(f.trader), await lastCheckinDay(f.trader)].filter((d): d is string => !!d).sort().at(-1) ?? null;
  const cfg = escalationCfg();
  const detected = detectEscalations({ today: f.today, days: tradedDays(f), breaks: f.breaks, maxDrawdown: f.risk.maxDrawdownUsd, drawdownFromPeak: f.risk.drawdownFromPeakUsd, lastActivity }, cfg);
  if (!detected.length) return [];
  const existing = await escalationsOf([f.trader], addDays(f.today, -21));
  const fresh = freshEscalations(detected, existing, f.today, cfg);
  const out: Escalation[] = [];
  for (const d of fresh) {
    const staff = (await staffOrFallback(f.trader)).filter((n) => n !== f.trader);
    const row = await insertEscalation({ trader: f.trader, rule: d.rule, day: f.today, params: d.params, notified: staff });
    if (!row) continue;
    out.push(row);
    for (const userName of staff) {
      await insertNotification({
        userName, type: "mentor_escalation", severity: d.rule === "drawdown_near_limit" ? "critical" : "warn",
        params: { trader: f.trader, variant: d.rule, days: d.params.days ?? null, count: d.params.count ?? null, pct: d.params.pct ?? null, drawdown: money(d.params.drawdown), limit: money(d.params.limit) },
        link: `/curator?view=traders&trader=${encodeURIComponent(f.trader)}`, entityType: "mentor_escalation", entityId: row.id, actor: null,
      });
    }
  }
  return out;
}

/** After a rhythm call: check the trader the mentor just looked at (facts already loaded). */
export async function escalateFromFacts(f: MentorFacts, staff: boolean): Promise<Escalation[]> {
  if (staff || !setting("mentor.escalationsEnabled")) return [];
  try {
    const breaks = breaksByDay(f.commitments.active.map((c) => c.progress));
    return await escalate({ ...f, breaks });
  } catch (err) {
    logger.warn({ err }, "mentor: escalation check failed");
    return [];
  }
}

/** Nightly desk run (job mentor.escalations): every active trader. */
export async function runEscalations(opts: { signal?: AbortSignal; today: string }): Promise<{ traders: number; escalations: number }> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM users WHERE active = true AND role = 'trader' AND COALESCE(banned, false) = false ORDER BY name`,
  );
  let n = 0;
  for (const { name } of rows) {
    if (opts.signal?.aborted) break;
    try {
      n += (await escalate(await lightFacts(name, opts.today))).length;
    } catch (err) {
      logger.warn({ err }, "mentor: nightly escalation failed for one trader");
    }
  }
  return { traders: rows.length, escalations: n };
}

