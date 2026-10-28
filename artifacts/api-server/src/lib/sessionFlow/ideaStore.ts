/**
 * The plan's idea marks (table plan_idea_marks, migration 0280; pure rules in ./ideas.ts and ./checklist.ts). Plans are
 * where manual input belongs: the tier, «authored», the setup and its checklist ticks. Everything else is prefilled:
 *
 *   dayView(trader, day, tickers)   the marks of the day with their setup checklist (weights, auto items ticked from the
 *                                   day's gap / relative volume / strong catalyst mark / analyst action), the score, the
 *                                   suggested risk (1R of the plan, × flow.checklistRiskFactor below the threshold) and the
 *                                   limits of an authored / tier-3 idea; per unmarked ticker the suggested tier (from the
 *                                   setup's own edge verdict) and «authored» (not in the desk plan)
 *   saveIdea(trader, day, ticker, …) upsert of one mark — the score is recomputed here, never sent by the client
 *   ideaStats(trader, from, to)     P&L by tier and checklist band, the authored ideas, the missed tier 1–2 ideas
 * GET never writes.
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { loadEffectiveLimits } from "../riskData";
import { dayMoves, prevSessionDay } from "../catalyst/store";
import { playbookToday } from "../playbookToday/service";
import type { UsdStats } from "../playbookEdge";
import { normItems, prefillChecks, scoreOf, suggestedRisk, weightOf, type ChecklistItem, type Score } from "./checklist";
import { ideaCap, isLimited, missedIdeas, tierStats, tradedKey, type BandRow, type IdeaMark, type MissedIdea, type TierRow } from "./ideas";
import { ideaMarksOf, toIdea } from "./gates";
import { flowTrades } from "./load";

type Queryable = { query: (typeof pool)["query"] };

type SetupRow = { id: number; name: string; items: ChecklistItem[]; threshold: number | null };

async function setupsById(ids: readonly number[], db: Queryable): Promise<Map<number, SetupRow>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT id, name, checklist_items, checklist_threshold::float8 AS thr FROM playbook WHERE id = ANY($1::int[]) AND deleted_at IS NULL`, [ids],
  );
  return new Map(rows.map((r: any) => [Number(r.id), { id: Number(r.id), name: String(r.name), items: normItems(r.checklist_items) ?? [], threshold: r.thr == null ? null : Number(r.thr) }]));
}

type Facts = { gapPct: number | null; rvol: number | null; catalystStrong: boolean; analyst: boolean };

async function dayFacts(trader: string, day: string, tickers: readonly string[], db: Queryable): Promise<Map<string, Facts>> {
  const out = new Map<string, Facts>();
  if (!tickers.length) return out;
  const prev = await prevSessionDay(day);
  const [moves, rvol, marks, analyst] = await Promise.all([
    dayMoves(day, tickers, db),
    db.query(`SELECT DISTINCT ON (UPPER(ticker)) UPPER(ticker) AS t, relative_volume::float8 AS rv FROM watchlist
               WHERE deleted_at IS NULL AND UPPER(ticker) = ANY($1::text[]) AND relative_volume IS NOT NULL ORDER BY UPPER(ticker), created_at DESC`, [tickers]),
    db.query(`SELECT ticker FROM catalyst_marks WHERE trader = $1 AND day = $2 AND strength = 'strong' AND ticker = ANY($3::text[])`, [trader, day, tickers]),
    db.query(`SELECT DISTINCT UPPER(ticker) AS t FROM analyst_actions_cache
               WHERE UPPER(ticker) = ANY($1::text[]) AND (graded_at AT TIME ZONE 'America/New_York')::date BETWEEN $2::date AND $3::date`, [tickers, prev, day]),
  ]);
  const rv = new Map((rvol.rows as any[]).map((r) => [String(r.t), Number(r.rv)]));
  const strong = new Set((marks.rows as any[]).map((r) => String(r.ticker)));
  const an = new Set((analyst.rows as any[]).map((r) => String(r.t)));
  for (const t of tickers) out.set(t, { gapPct: moves.get(t)?.gap ?? null, rvol: rv.get(t) ?? null, catalystStrong: strong.has(t), analyst: an.has(t) });
  return out;
}

export type IdeaItemView = ChecklistItem & { weight: number; checked: boolean; prefilled: boolean };
export type IdeaView = IdeaMark & {
  setupName: string | null;
  checklist: { items: IdeaItemView[]; score: Score | null } | null;
  risk: { usd: number | null; reduced: boolean; factor: number };
  limits: { limited: boolean; maxLossUsd: number | null; noReentry: boolean };
};
export type DayIdeas = {
  trader: string;
  day: string;
  ideas: IdeaView[];
  setups: { id: number; name: string; tier: 1 | 2 | 3 | null }[];
  /** Unmarked tickers of the screen: the suggested «authored» (not in the desk plan). */
  suggest: Record<string, { authored: boolean }>;
};

const tierOfVerdict = (v: string | null | undefined): 1 | 2 | 3 | null => (v === "best" ? 1 : v === "good" ? 2 : v ? 3 : null);

async function stored(trader: string, day: string, db: Queryable): Promise<Map<string, { mark: IdeaMark; checks: Record<string, boolean> }>> {
  const { rows } = await db.query(
    `SELECT trader, day, ticker, side, tier, authored, setup_id, score::float8 AS score, max_score::float8 AS max_score, threshold::float8 AS threshold, checks
       FROM plan_idea_marks WHERE trader = $1 AND day = $2`, [trader, day],
  );
  return new Map((rows as any[]).map((r) => [String(r.ticker), { mark: toIdea(r), checks: (r.checks ?? {}) as Record<string, boolean> }]));
}

export async function dayView(trader: string, day: string, tickers: readonly string[], db: Queryable = pool): Promise<DayIdeas> {
  const marks = await stored(trader, day, db);
  const all = [...new Set([...marks.keys(), ...tickers])].slice(0, 60);
  const [pb, desk, limits, facts] = await Promise.all([
    playbookToday(trader).catch(() => null),
    db.query(`SELECT UPPER(x->>'ticker') AS t FROM game_plans g, jsonb_array_elements(CASE WHEN jsonb_typeof(g.in_play) = 'array' THEN g.in_play ELSE '[]'::jsonb END) x
               WHERE g.date = $1 AND g.deleted_at IS NULL`, [day]).then((r) => new Set((r.rows as any[]).map((x) => String(x.t)))),
    loadEffectiveLimits(trader, day),
    dayFacts(trader, day, all, db),
  ]);
  const setups = (pb?.setups ?? []).filter((s) => !s.locked).map((s) => ({ id: s.id, name: s.name, tier: tierOfVerdict(s.myEdge?.verdict) }));
  const ids = [...new Set([...marks.values()].map((m) => m.mark.setupId).filter((x): x is number => x != null))];
  const byId = await setupsById(ids, db);
  const daily = limits.get(trader)?.dailyLossLimit ?? null;
  const oneR = pb?.oneR?.usd ?? null; // 1R of the plan (or the risk desk's max risk per trade)
  const cfg = { gapPct: setting("flow.autoGapPct"), rvol: setting("flow.autoRvol") };
  const ideas: IdeaView[] = [];
  for (const [ticker, { mark, checks }] of marks) {
    const s = mark.setupId != null ? byId.get(mark.setupId) ?? null : null;
    let checklist: IdeaView["checklist"] = null;
    if (s && s.items.length) {
      const pre = prefillChecks(s.items, facts.get(ticker) ?? { gapPct: null, rvol: null, catalystStrong: false, analyst: false }, cfg);
      const merged = { ...pre, ...checks };
      checklist = {
        items: s.items.map((i) => ({ ...i, weight: weightOf(i), checked: !!merged[i.id], prefilled: !!pre[i.id] && checks[i.id] === undefined })),
        score: scoreOf(s.items, merged, s.threshold),
      };
    }
    const limited = isLimited(mark);
    ideas.push({
      ...mark, setupName: s?.name ?? null, checklist,
      risk: { ...suggestedRisk(oneR, checklist?.score ?? null, setting("flow.checklistRiskFactor")), factor: setting("flow.checklistRiskFactor") },
      limits: { limited, maxLossUsd: limited ? ideaCap(daily, setting("flow.ideaStopShare")) : null, noReentry: limited },
    });
  }
  const suggest: DayIdeas["suggest"] = {};
  for (const t of all) if (!marks.has(t)) suggest[t] = { authored: !desk.has(t) };
  return { trader, day, ideas, setups, suggest };
}

export type IdeaInput = {
  side?: "long" | "short" | null;
  tier?: 1 | 2 | 3 | null;
  authored?: boolean;
  setupId?: number | null;
  checks?: Record<string, boolean>;
  source?: "plan" | "watchlist";
};

/** Upserts one idea. A first tier comes from the setup's edge verdict when the trader picked a setup but no tier. */
export async function saveIdea(trader: string, day: string, ticker: string, input: IdeaInput, db: Queryable = pool): Promise<IdeaMark> {
  const cur = (await stored(trader, day, db)).get(ticker);
  const setupId = input.setupId !== undefined ? input.setupId : cur?.mark.setupId ?? null;
  let tier = input.tier !== undefined ? input.tier : cur?.mark.tier ?? null;
  if (tier == null && input.tier === undefined && setupId != null) {
    const pb = await playbookToday(trader).catch(() => null);
    tier = tierOfVerdict(pb?.setups.find((s) => s.id === setupId)?.myEdge?.verdict);
  }
  const checks = { ...(cur?.checks ?? {}), ...(input.checks ?? {}) };
  const s = setupId != null ? (await setupsById([setupId], db)).get(setupId) ?? null : null;
  let score: Score | null = null;
  if (s && s.items.length) {
    const facts = (await dayFacts(trader, day, [ticker], db)).get(ticker)!;
    const pre = prefillChecks(s.items, facts, { gapPct: setting("flow.autoGapPct"), rvol: setting("flow.autoRvol") });
    score = scoreOf(s.items, { ...pre, ...checks }, s.threshold);
  }
  const { rows } = await db.query(
    `INSERT INTO plan_idea_marks (trader, day, ticker, side, tier, authored, setup_id, checks, score, max_score, threshold, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
     ON CONFLICT (trader, day, ticker) DO UPDATE SET side = EXCLUDED.side, tier = EXCLUDED.tier, authored = EXCLUDED.authored,
       setup_id = EXCLUDED.setup_id, checks = EXCLUDED.checks, score = EXCLUDED.score, max_score = EXCLUDED.max_score,
       threshold = EXCLUDED.threshold, source = EXCLUDED.source, updated_at = now()
     RETURNING trader, day, ticker, side, tier, authored, setup_id, score::float8 AS score, max_score::float8 AS max_score, threshold::float8 AS threshold`,
    [
      trader, day, ticker, input.side !== undefined ? input.side : cur?.mark.side ?? null, tier,
      input.authored ?? cur?.mark.authored ?? false, setupId, JSON.stringify(checks),
      score?.score ?? null, score?.max ?? null, score?.threshold ?? null, input.source ?? "plan",
    ],
  );
  return toIdea(rows[0]);
}

export type IdeaStats = { trader: string; from: string; to: string; tiers: TierRow[]; authored: UsdStats; bands: BandRow[]; missed: MissedIdea[]; marked: number };

export async function ideaStats(trader: string, from: string, to: string, db: Queryable = pool): Promise<IdeaStats> {
  const [marks, trades] = await Promise.all([ideaMarksOf([trader], from, to, db), flowTrades(trader, from, to)]);
  const traded = new Set(trades.map((t) => tradedKey(t.trader, t.day, t.ticker)));
  const moves = new Map<string, number>();
  const byDay = new Map<string, string[]>();
  for (const m of marks) if ((m.tier === 1 || m.tier === 2) && !traded.has(tradedKey(m.trader, m.day, m.ticker))) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m.ticker]);
  for (const [day, tickers] of byDay) for (const [t, v] of await dayMoves(day, tickers, db)) if (v.move != null) moves.set(`${day}|${t}`, v.move);
  const s = tierStats(trades.filter((t) => t.result !== "open"), marks);
  return { trader, from, to, ...s, missed: missedIdeas(marks, traded, moves, setting("flow.missedMovePct")).slice(0, 10), marked: marks.length };
}
