/**
 * «Автоотчёт за сезон» — reads and the one write (pure rules in ./seasonReport.ts; table season_reports, migration
 * 0290). The trader writes only the conclusions; they are saved into the trader's Playbook as a note entry (source
 * «season_report»), so they live where the setups do and are edited there like any other note.
 *
 *   seasonWindow(q, today)          the period asked for: the current / previous season (./seasonReport seasonOfDay on
 *                                   season.primeStartDay), or an explicit from / to (≤ MAX_DAYS)
 *   seasonReportOf(trader, from, to) the report: trades + families + plan marks + the daily limit → ./seasonReport,
 *                                   the «where the money was» link to «лёгкие деньги» (the season's clean moves and the
 *                                   trader's status on them), and the saved conclusions
 *   groupReports(traders, from, to) the curator's group: per trader the totals and whether conclusions are written
 *   saveConclusions(...)            upserts the season row and its Playbook note
 * GET never writes.
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { addDays, isWeekend, nyDate } from "../tradingDate";
import { limiter } from "../swr";
import { computeUsdStats, type UsdStats } from "../playbookEdge";
import type { Queryable } from "../interventions/log";
import { flowTrades, groupBy } from "../sessionFlow/load";
import { ideaMarksOf } from "../sessionFlow/gates";
import { dailyLimitOf, givebackCfg, greenToRedCfg } from "../sessionFlow/stats";
import { robustEdge } from "../sessionFlow/flow";
import type { FlowTrade } from "../sessionFlow/types";
import { familiesOf } from "./store";
import { easyMovesOf } from "./easyStore";
import { matchMove, type EasyMove, type EasyStatus } from "./easyMoney";
import { previousSeason, seasonOfDay, seasonReport, type Season, type SeasonReport } from "./seasonReport";

/** A custom period longer than this is cut to its last part. */
export const MAX_DAYS = 200;
/** «Where the money was» checks at most this many trading days of the period (the newest). */
const EASY_MAX_DAYS = 70;

export type SeasonWindow = { from: string; to: string; season: Season | null; current: Season; previous: Season };

export function seasonWindow(q: { season?: "current" | "previous"; from?: string; to?: string }, today: string = nyDate()): SeasonWindow {
  const start = setting("season.primeStartDay");
  const current = seasonOfDay(today, start);
  const previous = previousSeason(current, start);
  if (q.from && q.to && !q.season) {
    const to = q.to > today ? today : q.to;
    const floor = addDays(to, -MAX_DAYS);
    return { from: q.from < floor ? floor : q.from > to ? to : q.from, to, season: null, current, previous };
  }
  const s = q.season === "previous" ? previous : current;
  return { from: s.from, to: s.to > today ? today : s.to, season: s, current, previous };
}

// ─── where the money was: the season's clean moves ────────────────────────────────────────────────────────────────

export type EasySeason = {
  /** Trading days checked (the newest EASY_MAX_DAYS of the period) and whether the period was longer. */
  days: number;
  capped: boolean;
  moves: number;
  took: { n: number; net: number | null };
  against: { n: number; net: number | null };
  skipped: number;
  missed: number;
  /** The biggest moves the trader had in the plan and skipped, or missed — one line per ticker and family (its days). */
  top: (Pick<EasyMove, "day" | "ticker" | "side" | "family" | "timing" | "movePct"> & { status: EasyStatus; days: number })[];
};

function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = to; d >= from && out.length <= EASY_MAX_DAYS; d = addDays(d, -1)) if (!isWeekend(d)) out.push(d);
  return out;
}

async function easySeason(trader: string, from: string, to: string, trades: readonly FlowTrade[], db: Queryable): Promise<EasySeason> {
  const all = weekdays(from, to);
  const days = all.slice(0, EASY_MAX_DAYS);
  const { rows } = await db.query(
    `SELECT day, ticker FROM plan_idea_marks WHERE trader = $1 AND day BETWEEN $2 AND $3
     UNION SELECT day, ticker FROM catalyst_marks WHERE trader = $1 AND day BETWEEN $2 AND $3 AND (direction IS NOT NULL OR strength IS NOT NULL)`,
    [trader, from, to],
  );
  const planned = new Set((rows as any[]).map((r) => `${r.day}|${String(r.ticker).toUpperCase()}`));
  const byKey = groupBy(trades.filter((t) => t.result !== "open"), (t) => `${t.day}|${t.ticker.toUpperCase()}`);
  const limit = limiter(3);
  const perDay = await Promise.all(days.map((d) => limit(() => easyMovesOf(d).catch(() => null))));
  const out: EasySeason = { days: days.length, capped: all.length > days.length, moves: 0, took: { n: 0, net: null }, against: { n: 0, net: null }, skipped: 0, missed: 0, top: [] };
  const tookTrades: FlowTrade[] = [];
  const againstTrades: FlowTrade[] = [];
  const open = new Map<string, EasySeason["top"][number]>();
  for (const d of perDay) {
    for (const m of d?.moves ?? []) {
      const k = `${m.day}|${m.ticker}`;
      const mine = byKey.get(k) ?? [];
      const r = matchMove(m, { trader, planned: planned.has(k), trades: mine });
      out.moves++;
      if (r.status === "took") { out.took.n++; tookTrades.push(...mine); }
      else if (r.status === "against") { out.against.n++; againstTrades.push(...mine); }
      else {
        if (r.status === "skipped") out.skipped++; else out.missed++;
        const key = `${m.ticker}|${m.family}`;
        const cur = open.get(key);
        if (!cur) open.set(key, { day: m.day, ticker: m.ticker, side: m.side, family: m.family, timing: m.timing, movePct: m.movePct, status: r.status, days: 1 });
        else {
          cur.days++;
          if (r.status === "skipped") cur.status = "skipped";
          if (m.movePct > cur.movePct) Object.assign(cur, { day: m.day, timing: m.timing, movePct: m.movePct });
        }
      }
    }
  }
  out.took.net = computeUsdStats(tookTrades).net;
  out.against.net = computeUsdStats(againstTrades).net;
  // Skipped (it was in the plan) before missed, then by size.
  out.top = [...open.values()].sort((a, b) => Number(b.status === "skipped") - Number(a.status === "skipped") || b.movePct - a.movePct).slice(0, 5);
  return out;
}

// ─── conclusions ──────────────────────────────────────────────────────────────────────────────────────────────────

export type Conclusions = { text: string; playbookId: number; updatedAt: string | null } | null;

export async function conclusionsOf(trader: string, from: string, to: string, db: Queryable = pool): Promise<Conclusions> {
  const { rows } = await db.query(
    `SELECT p.id, p.notes, p.updated_at FROM season_reports s JOIN playbook p ON p.id = s.playbook_id AND p.deleted_at IS NULL
      WHERE s.trader = $1 AND s.from_day = $2 AND s.to_day = $3`,
    [trader, from, to],
  );
  const r = rows[0];
  return r ? { text: String(r.notes ?? ""), playbookId: Number(r.id), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null } : null;
}

export const CONCLUSIONS_MAX = 5000;

/** Saves the trader's conclusions of a period into his Playbook (one note entry per period, updated in place). */
export async function saveConclusions(trader: string, w: { from: string; to: string }, v: { title: string; folder: string | null; text: string }): Promise<NonNullable<Conclusions>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [s] } = await client.query(
      `INSERT INTO season_reports (trader, from_day, to_day) VALUES ($1, $2, $3)
       ON CONFLICT (trader, from_day, to_day) DO UPDATE SET updated_at = now()
       RETURNING id, playbook_id`,
      [trader, w.from, w.to],
    );
    let id: number | null = null;
    if (s.playbook_id != null) {
      const { rows } = await client.query(
        `UPDATE playbook SET notes = $2, name = $3, updated_at = now() WHERE id = $1 AND trader = $4 AND deleted_at IS NULL RETURNING id`,
        [s.playbook_id, v.text, v.title, trader],
      );
      id = rows[0] ? Number(rows[0].id) : null;
    }
    if (id == null) {
      const { rows } = await client.query(
        `INSERT INTO playbook (name, folder, notes, trader, source_type, source_id, space, visibility, created_by, updated_at)
         VALUES ($1, $2, $3, $4, 'season_report', $5, 'personal', 'private', $4, now()) RETURNING id`,
        [v.title, v.folder, v.text, trader, s.id],
      );
      id = Number(rows[0].id);
      await client.query(`UPDATE season_reports SET playbook_id = $2 WHERE id = $1`, [s.id, id]);
    }
    await client.query("COMMIT");
    return { text: v.text, playbookId: id, updatedAt: new Date().toISOString() };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ─── the report ───────────────────────────────────────────────────────────────────────────────────────────────────

export type SeasonReportView = SeasonReport & { trader: string; from: string; to: string; minTrades: number; easy: EasySeason | null; conclusions: Conclusions };

export async function seasonReportOf(trader: string, from: string, to: string, db: Queryable = pool): Promise<SeasonReportView> {
  const [trades, marks, limit, conclusions] = await Promise.all([
    flowTrades(trader, from, to), ideaMarksOf([trader], from, to), dailyLimitOf(trader), conclusionsOf(trader, from, to, db),
  ]);
  const closed = trades.filter((t) => t.result !== "open");
  const [families, easy] = await Promise.all([familiesOf(closed), easySeason(trader, from, to, trades, db).catch(() => null)]);
  const minTrades = setting("pulse.reportMinTrades");
  const r = seasonReport({ trades, families, marks, dailyLimit: limit, minTrades, giveback: givebackCfg(), greenToRed: greenToRedCfg() });
  return { ...r, trader, from, to, minTrades, easy, conclusions };
}

export type GroupRow = { trader: string; totals: UsdStats; netExTop3: number | null; outliers: boolean; written: boolean };

/** The curator's group of a period: per trader the totals (shared $ math) and whether the conclusions are written. */
export async function groupReports(traders: readonly string[], from: string, to: string, db: Queryable = pool): Promise<GroupRow[]> {
  if (!traders.length) return [];
  const [trades, written] = await Promise.all([
    flowTrades(null, from, to, [...traders]),
    db.query(
      `SELECT s.trader FROM season_reports s JOIN playbook p ON p.id = s.playbook_id AND p.deleted_at IS NULL
        WHERE s.trader = ANY($1::text[]) AND s.from_day = $2 AND s.to_day = $3`,
      [[...traders], from, to],
    ).then((r) => new Set((r.rows as any[]).map((x) => String(x.trader)))),
  ]);
  const by = groupBy(trades.filter((t) => t.result !== "open"), (t) => t.trader);
  return traders.map((trader) => {
    const list = by.get(trader) ?? [];
    const totals = computeUsdStats(list);
    const rob = robustEdge(list.map((t) => computeUsdStats([t]).net).filter((v): v is number => v != null));
    return { trader, totals, netExTop3: totals.n ? rob.netExTop3 : null, outliers: totals.n ? rob.outliers : false, written: written.has(trader) };
  }).sort((a, b) => (b.totals.n ? 1 : 0) - (a.totals.n ? 1 : 0) || a.trader.localeCompare(b.trader, "ru"));
}
