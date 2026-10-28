/**
 * Library of analogues — storage and reads (table playbook_cases, migration 0286; pure ranking in ./model.ts).
 *
 *   casesOf / insertCase / updateCase / deleteCase   example cases of a setup (ticker + day, optional times, note)
 *   profilesFor(pairs)        what each ticker-day looked like: gap (candle archive), catalyst kind / direction /
 *                             strength (catalyst marks of the desk, else the events page and earnings), regime
 *   candidatesFor(viewer, …)  the desk's past ticker-days: trades (grouped per ticker-day-setup, R and counts only),
 *                             trade examples and cases of the setups the viewer may read
 *   analoguesOf(…)            the ranked similar past cases of one ticker-day
 * Only setups the viewer may read are named (playbookAccess visibleSql); other traders' $ never leave here.
 * GET never writes.
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import { closedSql, resultSql, signedRSql } from "../tradeMath";
import { visibleSql, type PlaybookViewer } from "../playbookAccess";
import { regimeDaysMap } from "../marketRegime/store";
import { eventDirection, kindOfEventType, normTicker, type Direction, type Kind, type Strength } from "../catalyst/model";
import { parseBands, rankAnalogues, type Profile, type Scored, type Weights } from "./model";
import type { Queryable } from "../interventions/log";

export type CaseRow = {
  id: number; playbookId: number; ticker: string; day: string; entryTime: string | null; exitTime: string | null;
  side: "long" | "short" | null; note: string | null; addedBy: string; createdAt: string;
};
const CASE_COLS = `id, playbook_id, ticker, day, entry_time, exit_time, side, note, added_by, created_at`;
const toCase = (r: any): CaseRow => ({
  id: Number(r.id), playbookId: Number(r.playbook_id), ticker: String(r.ticker), day: String(r.day), entryTime: r.entry_time ?? null,
  exitTime: r.exit_time ?? null, side: r.side ?? null, note: r.note ?? null, addedBy: String(r.added_by),
  createdAt: new Date(r.created_at).toISOString(),
});

export async function casesOf(setupId: number, db: Queryable = pool): Promise<CaseRow[]> {
  const { rows } = await db.query(`SELECT ${CASE_COLS} FROM playbook_cases WHERE playbook_id = $1 AND deleted_at IS NULL ORDER BY day DESC, id DESC`, [setupId]);
  return rows.map(toCase);
}

export async function caseById(id: number, db: Queryable = pool): Promise<CaseRow | null> {
  const { rows } = await db.query(`SELECT ${CASE_COLS} FROM playbook_cases WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0] ? toCase(rows[0]) : null;
}

export type CaseInput = { ticker: string; day: string; entryTime: string | null; exitTime: string | null; side: "long" | "short" | null; note: string | null };

export async function insertCase(setupId: number, x: CaseInput, by: string, db: Queryable = pool): Promise<CaseRow> {
  const { rows } = await db.query(
    `INSERT INTO playbook_cases (playbook_id, ticker, day, entry_time, exit_time, side, note, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${CASE_COLS}`,
    [setupId, x.ticker, x.day, x.entryTime, x.exitTime, x.side, x.note, by],
  );
  return toCase(rows[0]);
}

export async function updateCase(id: number, x: Partial<CaseInput>, db: Queryable = pool): Promise<CaseRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const col: Record<keyof CaseInput, string> = { ticker: "ticker", day: "day", entryTime: "entry_time", exitTime: "exit_time", side: "side", note: "note" };
  for (const [k, v] of Object.entries(x) as [keyof CaseInput, unknown][]) {
    if (v === undefined || !col[k]) continue;
    params.push(v);
    sets.push(`${col[k]} = $${params.length}`);
  }
  if (!sets.length) return caseById(id, db);
  const { rows } = await db.query(`UPDATE playbook_cases SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING ${CASE_COLS}`, params);
  return rows[0] ? toCase(rows[0]) : null;
}

export async function deleteCase(id: number, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(`UPDATE playbook_cases SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return (rowCount ?? 0) > 0;
}

// ─── profiles ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Pair = { ticker: string; day: string };
const pairKey = (t: string, d: string) => `${t}|${d}`;
type Facts = Omit<Profile, "ticker" | "day" | "setupId">;

function majority<T extends string>(xs: readonly (T | null)[]): T | null {
  const n = new Map<T, number>();
  for (const x of xs) if (x) n.set(x, (n.get(x) ?? 0) + 1);
  let best: T | null = null;
  let top = 0;
  for (const [k, v] of n) if (v > top) { best = k; top = v; }
  return best;
}

/** Gap, catalyst and regime of each ticker-day (batched; at most a few thousand pairs). */
export async function profilesFor(pairs: readonly Pair[], db: Queryable = pool): Promise<Map<string, Facts>> {
  const out = new Map<string, Facts>();
  if (!pairs.length) return out;
  const tickers = pairs.map((p) => p.ticker);
  const days = pairs.map((p) => p.day);
  const prevDays = pairs.map((p) => addDays(p.day, -1));
  const sorted = [...days].sort();
  const [gaps, marks, events, earnings, regimes] = await Promise.all([
    db.query(
      `SELECT DISTINCT ON (a.symbol, a.day) a.symbol, a.day::text AS day, a.rth_open::float8 AS o, a.prev_close::float8 AS p
         FROM candle_archive a JOIN unnest($1::text[], $2::date[]) AS q(t, d) ON a.symbol = q.t AND a.day = q.d
        WHERE a.prev_close > 0 ORDER BY a.symbol, a.day, a.extended, a.tf`,
      [tickers, days],
    ),
    db.query(
      `SELECT m.ticker, m.day, m.direction, m.strength, m.kind FROM catalyst_marks m
         JOIN unnest($1::text[], $2::text[]) AS q(t, d) ON m.ticker = q.t AND m.day = q.d`,
      [tickers, days],
    ),
    db.query(
      `SELECT UPPER(TRIM(e.ticker)) AS ticker, substring(e.date, 1, 10) AS day, e.event_type, e.reaction, e.percent_move::float8 AS move
         FROM market_events e JOIN unnest($1::text[], $2::text[]) AS q(t, d) ON UPPER(TRIM(e.ticker)) = q.t AND substring(e.date, 1, 10) = q.d
        WHERE e.deleted_at IS NULL`,
      [tickers, days],
    ),
    db.query(
      `SELECT UPPER(f.ticker) AS ticker, q.d AS day FROM finviz_earnings f
         JOIN unnest($1::text[], $2::date[], $3::date[]) AS q(t, d, p) ON UPPER(f.ticker) = q.t
          AND ((f.date = q.d AND COALESCE(f.timing, 'bmo') <> 'amc') OR (f.date = q.p AND f.timing = 'amc'))
        WHERE f.superseded_at IS NULL`,
      [tickers, days, prevDays],
    ).catch(() => ({ rows: [] as any[] })),
    regimeDaysMap(sorted[0], sorted[sorted.length - 1]).catch(() => new Map<string, string>()),
  ]);
  const gap = new Map<string, number>();
  for (const r of gaps.rows) gap.set(pairKey(String(r.symbol), String(r.day)), Math.round(((Number(r.o) - Number(r.p)) / Number(r.p)) * 10_000) / 100);
  const mk = new Map<string, any[]>();
  for (const r of marks.rows) mk.set(pairKey(String(r.ticker), String(r.day)), [...(mk.get(pairKey(String(r.ticker), String(r.day))) ?? []), r]);
  const ev = new Map<string, { kind: Kind; direction: Direction | null }>();
  for (const r of events.rows) {
    const k = pairKey(String(r.ticker), String(r.day));
    if (!ev.has(k)) ev.set(k, { kind: kindOfEventType(r.event_type), direction: eventDirection({ type: r.event_type, reaction: r.reaction, movePct: r.move == null ? null : Number(r.move) }) });
  }
  const er = new Set(earnings.rows.map((r) => pairKey(String(r.ticker), String(r.day).slice(0, 10))));
  for (const p of pairs) {
    const k = pairKey(p.ticker, p.day);
    const m = mk.get(k) ?? [];
    const e = ev.get(k);
    out.set(k, {
      kind: majority<Kind>(m.map((x) => x.kind ?? null)) ?? e?.kind ?? (er.has(k) ? "earnings" : null),
      direction: majority<Direction>(m.map((x) => x.direction ?? null)) ?? e?.direction ?? null,
      strength: majority<Strength>(m.map((x) => x.strength ?? null)),
      gapPct: gap.get(k) ?? null,
      regime: (regimes as Map<string, string>).get(p.day) ?? null,
    });
  }
  return out;
}

// ─── candidates ───────────────────────────────────────────────────────────────────────────────────────────────────

export type Candidate = Profile & {
  key: string;
  source: "trade" | "example" | "case";
  setupName: string | null;
  /** Trades of the desk that day on the ticker (for «trade» / «example»): counts and R only, never $ or names. */
  trades: number;
  wins: number;
  losses: number;
  avgR: number | null;
  caseId: number | null;
  note: string | null;
};

const CAND_LIMIT = 3000;

/** The desk's past ticker-days in [from, to] (trades, trade examples, cases), setups named only when readable. */
export async function candidatesFor(v: PlaybookViewer, from: string, to: string, db: Queryable = pool): Promise<Candidate[]> {
  const pTr: unknown[] = [from, to];
  const visT = visibleSql(v, pTr, "s");
  const pCs: unknown[] = [from, to];
  const visC = visibleSql(v, pCs, "s");
  const [tr, ex, cs] = await Promise.all([
    db.query(
      `WITH tr AS (
         SELECT UPPER(TRIM(t.ticker)) AS ticker, LEFT(t.date, 10) AS day, COALESCE(p.parent_id, p.id) AS top_id,
                ${resultSql("t")} AS res, ${signedRSql("t")} AS r
           FROM trades t LEFT JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
          WHERE t.deleted_at IS NULL AND ${closedSql("t")} AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(t.date, 10) BETWEEN $1 AND $2
            AND COALESCE(t.external_id, '') NOT LIKE 'DEMO|%'
       )
       SELECT tr.ticker, tr.day, s.id AS setup_id, s.name AS setup_name, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE tr.res = 'win')::int AS wins, COUNT(*) FILTER (WHERE tr.res = 'loss')::int AS losses,
              AVG(tr.r)::float8 AS avg_r
         FROM tr LEFT JOIN playbook s ON s.id = tr.top_id AND s.deleted_at IS NULL AND ${visT}
        GROUP BY tr.ticker, tr.day, s.id, s.name
        ORDER BY tr.day DESC
        LIMIT ${CAND_LIMIT}`,
      pTr,
    ),
    db.query(
      `SELECT DISTINCT UPPER(TRIM(t.ticker)) AS ticker, LEFT(t.date, 10) AS day, COALESCE(s.parent_id, s.id) AS setup_id
         FROM playbook_examples e JOIN trades t ON t.id = e.trade_id AND t.deleted_at IS NULL
         JOIN playbook s ON s.id = e.playbook_id AND s.deleted_at IS NULL
        WHERE e.deleted_at IS NULL AND e.tier < 3 AND LEFT(t.date, 10) BETWEEN $1 AND $2 AND ${visC}`,
      pCs,
    ),
    db.query(
      `SELECT c.id, c.ticker, c.day, c.note, COALESCE(s.parent_id, s.id) AS setup_id, COALESCE(ps.name, s.name) AS setup_name
         FROM playbook_cases c JOIN playbook s ON s.id = c.playbook_id AND s.deleted_at IS NULL
         LEFT JOIN playbook ps ON ps.id = s.parent_id
        WHERE c.deleted_at IS NULL AND c.day BETWEEN $1 AND $2 AND ${visC}`,
      pCs,
    ),
  ]);
  const examples = new Set(ex.rows.map((r) => `${r.ticker}|${r.day}|${r.setup_id}`));
  const base: Omit<Candidate, "kind" | "direction" | "strength" | "gapPct" | "regime">[] = [];
  for (const r of tr.rows) {
    const ticker = normTicker(r.ticker);
    if (!ticker) continue;
    const setupId = r.setup_id == null ? null : Number(r.setup_id);
    const isEx = setupId != null && examples.has(`${r.ticker}|${r.day}|${setupId}`);
    base.push({
      key: `${isEx ? "e" : "t"}:${ticker}:${r.day}:${setupId ?? ""}`, source: isEx ? "example" : "trade", ticker, day: String(r.day), setupId,
      setupName: r.setup_name ?? null, trades: Number(r.n), wins: Number(r.wins), losses: Number(r.losses),
      avgR: r.avg_r == null ? null : Math.round(Number(r.avg_r) * 100) / 100, caseId: null, note: null,
    });
  }
  for (const r of cs.rows) {
    base.push({
      key: `c:${r.id}`, source: "case", ticker: String(r.ticker), day: String(r.day), setupId: r.setup_id == null ? null : Number(r.setup_id),
      setupName: r.setup_name ?? null, trades: 0, wins: 0, losses: 0, avgR: null, caseId: Number(r.id), note: r.note ?? null,
    });
  }
  const facts = await profilesFor(dedupePairs(base), db);
  return base.map((b) => ({ ...b, ...(facts.get(pairKey(b.ticker, b.day)) ?? { kind: null, direction: null, strength: null, gapPct: null, regime: null }) }));
}

function dedupePairs(rows: readonly Pair[]): Pair[] {
  const seen = new Map<string, Pair>();
  for (const r of rows) seen.set(pairKey(r.ticker, r.day), { ticker: r.ticker, day: r.day });
  return [...seen.values()];
}

export function analogueWeights(): Weights {
  return {
    setup: setting("catalyst.analogueWeightSetup"), kind: setting("catalyst.analogueWeightKind"), gap: setting("catalyst.analogueWeightGap"),
    direction: setting("catalyst.analogueWeightDirection"), strength: setting("catalyst.analogueWeightStrength"), regime: setting("catalyst.analogueWeightRegime"),
  };
}

/** Similar past cases of `ticker` on `day` (the setup, when given, is what the trader plans to trade). */
export async function analoguesOf(v: PlaybookViewer, x: { ticker: string; day: string; setupId: number | null; own?: Partial<Pick<Profile, "kind" | "direction" | "strength">> }, db: Queryable = pool): Promise<{ query: Profile; analogues: Scored<Candidate>[]; weights: Weights; bands: number[] }> {
  const bands = parseBands(setting("catalyst.analogueGapBands"));
  const weights = analogueWeights();
  const facts = (await profilesFor([{ ticker: x.ticker, day: x.day }], db)).get(pairKey(x.ticker, x.day));
  const query: Profile = {
    ticker: x.ticker, day: x.day, setupId: x.setupId,
    kind: x.own?.kind ?? facts?.kind ?? null, direction: x.own?.direction ?? facts?.direction ?? null,
    strength: x.own?.strength ?? facts?.strength ?? null, gapPct: facts?.gapPct ?? null, regime: facts?.regime ?? null,
  };
  const from = addDays(x.day, -setting("catalyst.analogueLookbackDays"));
  const cands = await candidatesFor(v, from, addDays(x.day, -1), db);
  return {
    query, weights, bands,
    analogues: rankAnalogues(query, cands, { weights, bands, minScore: setting("catalyst.analogueMinScore"), limit: setting("catalyst.analogueLimit") }),
  };
}
