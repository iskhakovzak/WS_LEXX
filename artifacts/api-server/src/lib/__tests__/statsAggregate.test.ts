/**
 * lib/stats/aggregate.ts (Волна 2 п. 2.5): the staff view of /stats and /analytics sums on the server.
 *  - values equal a plain computation over the raw rows (net = Σ(pnl − |fees|), W / (W + L), end-of-day drawdown, …);
 *  - the snapshot `fixtures/stats-aggregate-expected.json` is what the browser test (edge-tracker
 *    components/stats/aggregate.test.ts) turns into KPI cards and compares with its own maths over the same trades;
 *  - a desk of 50 traders × 90 days (~10 000 trades) answers in ≤ 300 KB.
 * Regenerate the snapshot after an intended change: UPDATE_AGG_FIXTURE=1 npx vitest run src/lib/__tests__/statsAggregate.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUCKET_FIELDS, buildAggregate, bucketIndex as F, redactAggregateMoney, TICKERS_MAX, type AggTradeRow, type Bucket,
} from "../stats/aggregate";
import { maxDrawdownByDay, netPnl, normResult, num, signedR } from "../tradeMath";

const DIR = path.join(__dirname, "fixtures");
type WebTrade = Record<string, any>;
const trades = JSON.parse(fs.readFileSync(path.join(DIR, "stats-aggregate-trades.json"), "utf8")) as WebTrade[];

/** Browser trade shape → the row routes/stats-aggregate.ts selects. */
function toRow(t: WebTrade): AggTradeRow {
  return {
    id: t.id, trader: t.trader, ticker: t.ticker, date: t.date, exit_date: t.exitDate, result: t.result, side: t.side,
    entry: t.entry, exit: t.exit, stop: t.stop, r_multiple: t.rMultiple, pnl: t.pnl, fees: t.fees, risk_usd: t.riskUsd,
    horizon: t.horizon, setup: t.setup, event_type: t.eventType, sector: t.sector, session: t.session, conviction: t.conviction,
    broker_account: t.brokerAccount, source: t.source, created_at: t.createdAt, opened_at: t.contextSnapshot?.openedAt ?? null,
  };
}
const rows = trades.map(toRow);
const get = (b: Bucket, k: (typeof BUCKET_FIELDS)[number]) => b[F[k]]!;
const closedRows = rows.filter((r) => ["win", "loss", "be"].includes(normResult(r.result) ?? ""));
const dayOf = (r: AggTradeRow) => String(r.exit_date || r.date).slice(0, 10);

describe("buildAggregate — values vs the raw rows", () => {
  const a = buildAggregate(rows);
  it("counts, win rate parts, R and money sums", () => {
    expect(get(a.total, "n")).toBe(rows.length);
    expect(get(a.total, "closed")).toBe(closedRows.length);
    expect(get(a.total, "wins")).toBe(closedRows.filter((r) => normResult(r.result) === "win").length);
    expect(get(a.total, "losses")).toBe(closedRows.filter((r) => normResult(r.result) === "loss").length);
    const nets = closedRows.map(netPnl).filter((v): v is number => v != null);
    expect(get(a.total, "pnlN")).toBe(nets.length);
    expect(get(a.total, "net")).toBeCloseTo(nets.reduce((s, v) => s + v, 0), 4);
    const gross = closedRows.map((r) => num(r.pnl)).filter((v): v is number => v != null);
    expect(get(a.total, "gross")).toBeCloseTo(gross.reduce((s, v) => s + v, 0), 4);
    expect(get(a.total, "fees")).toBeCloseTo(get(a.total, "gross") - get(a.total, "net"), 4);
    const rs = closedRows.map(signedR).filter((v): v is number => v != null);
    expect(get(a.total, "rN")).toBe(rs.length);
    expect(get(a.total, "r")).toBeCloseTo(rs.reduce((s, v) => s + v, 0), 4);
    expect(a.best.net).toBe(Math.max(...nets));
    expect(a.worst.r).toBe(Math.min(...rs));
  });
  it("the daily curve gives the canonical end-of-day drawdown", () => {
    const fromDays = maxDrawdownByDay(a.days.map((d) => ({ day: d.key, value: get(d.b, "pnlN") ? get(d.b, "net") : null })));
    const raw = maxDrawdownByDay(closedRows.map((r) => ({ day: dayOf(r), value: netPnl(r) })));
    expect(fromDays).toBeCloseTo(raw!, 4);
    expect(a.days.map((d) => d.key)).toEqual([...new Set(rows.map(dayOf))].sort());
  });
  it("breakdowns add up to the total and use the page keys", () => {
    for (const dim of ["trader", "setup", "ticker", "weekday", "hour", "horizon", "session"] as const) {
      const sum = a.groups![dim].reduce((s, g) => s + get(g.b, "n"), 0);
      expect(sum, dim).toBe(rows.length);
    }
    const setupKeys = a.groups!.setup.map((g) => g.key).sort();
    expect(setupKeys).toEqual(["Fade", "ORB", "Pullback", "~ev:earnings", "—"].sort());
    expect(a.groups!.ticker.find((g) => g.key === "AAPL")!.b[F.n]).toBe(3); // «aapl» folds into AAPL
    expect(a.groups!.hour.find((g) => g.key === "pre")!.b[F.n]).toBe(1); // snapshot openedAt 08:15
    expect(a.groups!.hour.find((g) => g.key === "post")!.b[F.n]).toBe(1);
    expect(a.groups!.session.map((g) => g.key).sort()).toEqual(["afterhours", "none", "premarket", "regular"]);
  });
  it("streaks and extremes follow the browser order", () => {
    expect(a.streaks.longestWin).toBeGreaterThanOrEqual(1);
    expect(a.extremes!.net.best[0]).toBe(3); // +300 − 4 fees
    expect(a.extremes!.net.worst[0]).toBe(5);
    expect(a.trades!.map((t) => t.id).sort((x, y) => x - y)).toEqual([...new Set(a.trades!.map((t) => t.id))].sort((x, y) => x - y));
  });
  it("filters like the analytics FilterBar; horizonAll ignores the horizon filter", () => {
    const f = buildAggregate(rows, { horizon: "intraday", setup: "ORB" });
    expect(get(f.total, "n")).toBe(rows.filter((r) => (r.horizon === "overnight" || r.horizon === "swing" ? r.horizon : "intraday") === "intraday" && r.setup === "ORB").length);
    expect(f.horizonAll!.map((g) => g.key).sort()).toEqual(["intraday", "swing"]);
    const none = buildAggregate(rows, { setup: "__none__" });
    expect(get(none.total, "n")).toBe(rows.filter((r) => !r.setup).length);
  });
  it("lite = totals, days and streaks only", () => {
    const l = buildAggregate(rows, {}, { lite: true });
    expect(l.groups).toBeUndefined();
    expect(l.total).toEqual(a.total);
  });
  it("redaction zeroes every money sum", () => {
    const r = redactAggregateMoney(a);
    expect(get(r.total, "net")).toBe(0);
    expect(get(r.total, "rN")).toBe(get(a.total, "rN"));
    expect(r.best.net).toBeNull();
    expect(r.trades!.every((t) => t.pnl == null)).toBe(true);
  });
  it("matches the snapshot the browser test reads", () => {
    const file = path.join(DIR, "stats-aggregate-expected.json");
    if (process.env.UPDATE_AGG_FIXTURE) fs.writeFileSync(file, `${JSON.stringify(a, null, 1)}\n`);
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
  });
});

describe("buildAggregate — size of a desk answer", () => {
  it("50 traders × 63 trading days × ~3.3 trades ≤ 300 KB", () => {
    const big: AggTradeRow[] = [];
    let id = 1;
    for (let tr = 0; tr < 50; tr++) {
      for (let d = 0; d < 63; d++) {
        const day = new Date(Date.UTC(2026, 6, 1) + d * 86_400_000).toISOString().slice(0, 10);
        for (let k = 0; k < 3 + (d % 2); k++) {
          const pnl = ((id * 37) % 400) - 180 + 0.1234;
          big.push({
            id, trader: `Trader ${tr}`, ticker: `T${(id * 13) % 900}`, date: `${day}T${String(9 + (k % 7)).padStart(2, "0")}:${String((id * 7) % 60).padStart(2, "0")}:00`,
            exit_date: null, result: pnl > 0 ? "win" : "loss", side: k % 2 ? "short" : "long", entry: 10, exit: 11, stop: 9.5,
            r_multiple: null, pnl, fees: 1.2345, risk_usd: null, horizon: "intraday", setup: `Setup ${id % 16}`, event_type: null,
            sector: `S${id % 11}`, session: "regular", conviction: (id % 5) + 1, broker_account: `ACC${tr}`, source: "propreports",
            created_at: `${day}T20:00:00.000Z`, opened_at: null,
          });
          id++;
        }
      }
    }
    expect(big.length).toBeGreaterThan(10_000);
    const json = JSON.stringify(buildAggregate(big));
    expect(json.length).toBeLessThanOrEqual(300 * 1024);
    expect(JSON.parse(json).groups.ticker.length).toBeLessThanOrEqual(TICKERS_MAX);
  });
});

describe("buildAggregate — 200 000 closed trades", () => {
  it("best / worst without spreading the values into Math.max (call stack overflow past ~125k)", () => {
    const many: AggTradeRow[] = [];
    for (let id = 1; id <= 200_000; id++) {
      const pnl = ((id * 7919) % 20_001) - 10_000; // −10 000 … +10 000, both ends hit
      many.push({
        id, trader: "T", ticker: "AAA", date: "2026-07-01T10:00:00", exit_date: null, result: pnl > 0 ? "win" : "loss", side: "long",
        entry: 10, exit: 11, stop: 9, r_multiple: null, pnl, fees: 0, risk_usd: null, horizon: "intraday", setup: null, event_type: null,
        sector: null, session: null, conviction: null, broker_account: null, source: "propreports", created_at: "2026-07-01T20:00:00.000Z", opened_at: null,
      });
    }
    const a = buildAggregate(many, {}, { lite: true });
    expect(get(a.total, "closed")).toBe(200_000);
    expect(a.best.net).toBe(10_000);
    expect(a.worst.net).toBe(-10_000);
    expect(a.best.usd).toBe(10_000);
  });
});
