/**
 * Plan against execution on the trade chart (Волна 2, item 2.12): the morning plan's levels of the trade's ticker (the
 * «В игре» row of the trader's own day plan — PDH / PDL / PMH… put there by «В план» — else the desk plan of that day)
 * and the trade's setup label, for /chart-lab and the trade sheet chart.
 *
 *   GET /api/chart/plan-overlay?trade=<id>            the trade's owner plan (owner, or staff who may review them)
 *   GET /api/chart/plan-overlay?ticker=AAPL&date=…    the viewer's own plan of that day
 *   → { ticker, date, source: "own" | "desk" | null, levels: [{ price, kind: support | resistance }], setup: string | null }
 */
import { pool } from "@workspace/db";

export type PlanLevel = { price: number; kind: "support" | "resistance" };
export type PlanOverlay = { ticker: string; date: string; source: "own" | "desk" | null; levels: PlanLevel[]; setup: string | null };

const MAX_LEVELS = 8;

/** Levels of `ticker` from a plan's «В игре» list (a stored doc or game_plans.in_play). Pure; junk is skipped. */
export function levelsFromInPlay(inPlay: unknown, ticker: string): PlanLevel[] | null {
  if (!Array.isArray(inPlay)) return null;
  const want = ticker.trim().toUpperCase();
  const item = inPlay.find((x) => x && typeof x === "object" && String((x as { ticker?: unknown }).ticker ?? "").trim().toUpperCase() === want) as
    | { levels?: { support?: unknown; resistance?: unknown } }
    | undefined;
  if (!item) return null;
  const out: PlanLevel[] = [];
  const seen = new Set<number>();
  for (const kind of ["support", "resistance"] as const) {
    const list = Array.isArray(item.levels?.[kind]) ? (item.levels![kind] as unknown[]) : [];
    for (const v of list) {
      const p = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (!Number.isFinite(p) || p <= 0 || seen.has(p)) continue;
      seen.add(p);
      out.push({ price: p, kind });
    }
  }
  return out.slice(0, MAX_LEVELS);
}

/** Own plan first; the desk plan when the ticker is not in it. */
export function pickOverlay(ticker: string, ownDoc: unknown, deskInPlay: unknown): Pick<PlanOverlay, "source" | "levels"> {
  const own = levelsFromInPlay((ownDoc as { inPlay?: unknown } | null)?.inPlay, ticker);
  if (own) return { source: "own", levels: own };
  const desk = levelsFromInPlay(deskInPlay, ticker);
  if (desk) return { source: "desk", levels: desk };
  return { source: null, levels: [] };
}

const none = { rows: [] as any[] };

export async function loadPlanOverlay(trader: string | null, ticker: string, date: string, setup: string | null): Promise<PlanOverlay> {
  const [own, desk] = await Promise.all([
    trader
      ? pool.query(`SELECT doc FROM trader_plans WHERE trader = $1 AND date = $2 AND deleted_at IS NULL LIMIT 1`, [trader, date]).catch(() => none)
      : none,
    pool.query(`SELECT in_play FROM game_plans WHERE date = $1 AND deleted_at IS NULL LIMIT 1`, [date]).catch(() => none),
  ]);
  return { ticker, date, setup, ...pickOverlay(ticker, own.rows[0]?.doc ?? null, desk.rows[0]?.in_play ?? null) };
}

/** The trade's owner, ticker, day and setup label (the office setup's name when linked, else the free text). */
export async function tradeForOverlay(tradeId: number): Promise<{ trader: string | null; ticker: string; date: string; setup: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT t.trader, t.ticker, LEFT(t.date, 10) AS date, COALESCE(p.name, NULLIF(TRIM(t.setup), '')) AS setup
       FROM trades t LEFT JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
      WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [tradeId],
  );
  const r = rows[0];
  return r ? { trader: r.trader ?? null, ticker: String(r.ticker).toUpperCase(), date: String(r.date), setup: r.setup ?? null } : null;
}
