/**
 * I/O of the session gates (pure rules in ./openWindow.ts and ./ideas.ts): the opening-window state of a trader-day
 * (risk desk, morning brief, the guard) and the plan's idea marks. Read-only; the edge history of the window is cached
 * per trader and day (it ends yesterday, so it does not move during the session).
 */
import { pool } from "@workspace/db";
import { etWallIsoToMs } from "../../routes/behavior";
import { loadEffectiveLimits } from "../riskData";
import { viewerStage } from "../access/stage";
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import { flowTrades } from "./load";
import { ideaBreaches, type IdeaMark } from "./ideas";
import { openWindowBreach, openWindowEdge, openWindowState, type OpenWindowCfg, type OpenWindowEdge, type OpenWindowState } from "./openWindow";
import type { FlowTrade } from "./types";
import type { RuleBreach } from "../leakGuard/rules";

type Queryable = { query: (typeof pool)["query"] };

export const openWindowCfg = (): OpenWindowCfg => ({
  shares: { junior: setting("flow.openShareJunior"), trader: setting("flow.openShareTrader"), senior: setting("flow.openShareSenior") },
  liftMinTrades: setting("flow.openLiftMinTrades"),
});

const edgeCache = new Map<string, Promise<OpenWindowEdge>>();

function windowEdgeOf(trader: string, day: string): Promise<OpenWindowEdge> {
  const k = `${trader}|${day}|${setting("flow.openLiftDays")}`;
  let hit = edgeCache.get(k);
  if (!hit) {
    hit = flowTrades(trader, addDays(day, -setting("flow.openLiftDays")), addDays(day, -1)).then(openWindowEdge);
    hit.catch(() => edgeCache.delete(k));
    if (edgeCache.size > 500) edgeCache.clear();
    edgeCache.set(k, hit);
  }
  return hit;
}

export async function openWindowStateOf(trader: string, day: string): Promise<OpenWindowState> {
  const [stage, limits, edge] = await Promise.all([viewerStage(trader), loadEffectiveLimits(trader, day), windowEdgeOf(trader, day)]);
  const l = limits.get(trader) ?? null;
  return openWindowState({ stage, dailyLimit: l?.dailyLossLimit ?? null, ownLimit: l?.openWindowLossLimit ?? null, edge, cfg: openWindowCfg() });
}

const IDEA_COLS = `trader, day, ticker, side, tier, authored, setup_id, score::float8 AS score, max_score::float8 AS max_score, threshold::float8 AS threshold`;

export function toIdea(r: any): IdeaMark {
  return {
    trader: String(r.trader), day: String(r.day), ticker: String(r.ticker), side: r.side === "long" || r.side === "short" ? r.side : null,
    tier: r.tier === 1 || r.tier === 2 || r.tier === 3 ? r.tier : null, authored: r.authored === true,
    setupId: r.setup_id == null ? null : Number(r.setup_id), score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score), threshold: r.threshold == null ? null : Number(r.threshold),
  };
}

export async function ideaMarksOf(traders: readonly string[], from: string, to: string, db: Queryable = pool): Promise<IdeaMark[]> {
  if (!traders.length) return [];
  const { rows } = await db.query(`SELECT ${IDEA_COLS} FROM plan_idea_marks WHERE trader = ANY($1::text[]) AND day BETWEEN $2 AND $3 ORDER BY day, ticker`, [traders, from, to]);
  return rows.map(toIdea);
}

/** The guard's open_window and idea_limit breaches of today, per trader with trades today. */
export async function gateBreaches(day: string, byTrader: ReadonlyMap<string, FlowTrade[]>, o: { openWindow: boolean; ideaLimits: boolean; closeAt: number }): Promise<Map<string, RuleBreach[]>> {
  const out = new Map<string, RuleBreach[]>();
  const traders = [...byTrader.keys()];
  const windowEnd = etWallIsoToMs(`${day}T10:00:00`) ?? o.closeAt;
  const [marks, limits] = await Promise.all([
    o.ideaLimits ? ideaMarksOf(traders, day, day) : Promise.resolve([] as IdeaMark[]),
    loadEffectiveLimits(null, day),
  ]);
  for (const [trader, today] of byTrader) {
    const list: RuleBreach[] = [];
    if (o.openWindow) {
      const st = await openWindowStateOf(trader, day).catch(() => null);
      const b = st ? openWindowBreach(today, st.limitUsd, windowEnd) : null;
      if (b && st) list.push({ pattern: "open_window", sourceKey: "window", at: b.at, pauseUntil: windowEnd, tradeId: b.tradeId, stats: { limit: st.limitUsd, loss: b.loss } });
    }
    if (o.ideaLimits) {
      const mine = marks.filter((m) => m.trader === trader);
      if (mine.length) list.push(...ideaBreaches(today, mine, limits.get(trader)?.dailyLossLimit ?? null, setting("flow.ideaStopShare"), o.closeAt));
    }
    if (list.length) out.set(trader, list);
  }
  return out;
}
