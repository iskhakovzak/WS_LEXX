/**
 * Recent rule scan (lib/rulesScanWindow): for every day ≥ the window start, the drafts evaluated on the trades the window
 * loads are exactly the drafts of the whole history — for every rule kind, with swings closing inside the window and
 * loss streaks reaching back before it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { evalRule, NO_LIMITS } = await import("../rulesEval");
const { sortTrades } = await import("../rulesTrades");
const { inLoadedSet, inScanWindow, planScanWindow, STREAK_KINDS } = await import("../rulesScanWindow");
const { RULE_CATALOG } = await import("../rulesCatalog");
type Trade = import("../rulesEval").TradeForRule;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

function book(seed: number, days = 120): Trade[] {
  const r = rng(seed);
  const out: Trade[] = [];
  let id = 1;
  for (let d = 0; d < days; d++) {
    const n = Math.floor(r() * 6);
    for (let k = 0; k < n; k++) {
      const hold = r() < 0.1 ? Math.floor(r() * 40) : 0; // some swings, up to 40 days
      const res = r() < 0.55 ? "loss" : r() < 0.85 ? "win" : "be";
      const net = res === "loss" ? -Math.round(r() * 900) : res === "win" ? Math.round(r() * 900) : 0;
      const entryAt = Date.UTC(2026, 0, 1 + d, 14, 30) + Math.floor(r() * 6 * 3600_000);
      out.push({
        id: id++, trader: "x", date: day(d), closeDate: day(d + hold), result: res as Trade["result"], pnl: net, netPnl: net, signedR: net / 300,
        entry: 10, stop: 9.5, qty: Math.round(r() * 1500), riskUsd: Math.round(r() * 600), horizon: hold ? (hold > 5 ? "swing" : "overnight") : "intraday",
        source: r() < 0.5 ? "propreports" : null, playbookId: null, setupScore: null, maxNotional: Math.round(r() * 30000), checklistRuns: 0,
        ticker: ["AAA", "BBB", "CCC"][Math.floor(r() * 3)], side: r() < 0.5 ? "long" : "short", entryAt, exitAt: entryAt + Math.floor(r() * 3600_000),
        entryMin: 560 + Math.floor(r() * 420), holdSec: Math.floor(r() * 600), execFills: 1, avgDownShare: r() < 0.1 ? 0.3 : null,
      });
    }
  }
  return sortTrades(out);
}

/** The SQL of resolveRecentWindow, in JS. */
function windowOf(all: Trade[], from: string, needsStreak: boolean) {
  const loaded = all.filter((t) => t.date >= from || t.closeDate >= from);
  const minDay = loaded.reduce<string | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
  const before = minDay !== null && minDay < from ? minDay : from;
  const lastWin = all.filter((t) => t.result === "win" && t.date < before).reduce<string | null>((m, t) => (m === null || t.date > m ? t.date : m), null);
  return planScanWindow(from, lastWin, needsStreak);
}

const kinds = RULE_CATALOG.map((k) => k.kind).filter((k) => k !== "self_check");
const thresholds: Record<string, Record<string, unknown>> = {
  max_daily_loss_usd: { usd: 800 }, max_risk_per_trade_usd: { usd: 400 }, max_position_usd: { usd: 20000 },
  max_loss_per_trade_usd: { usd: 500 }, banned_tickers: { tickers: ["BBB"] }, max_consecutive_losses: { n: 3 },
};

describe("recent scan window = full scan for the days it judges", () => {
  for (const seed of [1, 7, 42, 2026]) {
    for (const kind of kinds) {
      it(`${kind} (seed ${seed})`, () => {
        const all = book(seed);
        const from = day(100);
        const w = windowOf(all, from, STREAK_KINDS.includes(kind));
        const subset = all.filter((t) => inLoadedSet(t, w));
        const rule = { id: 1, trader: "x", name: kind, kind, threshold: thresholds[kind] ?? {}, enabled: true };
        const full = evalRule(rule, all, NO_LIMITS).filter((d) => inScanWindow(d.day, w.from));
        const part = evalRule(rule, subset, NO_LIMITS).filter((d) => inScanWindow(d.day, w.from));
        expect(part).toEqual(full);
        if (!STREAK_KINDS.includes(kind)) expect(subset.length).toBeLessThan(all.length / 2);
      });
    }
  }

  it("a full scan (from = null) judges every day", () => {
    expect(inScanWindow("2020-01-01", null)).toBe(true);
    expect(inScanWindow("2026-10-14T10:00:00", "2026-10-14")).toBe(true);
    expect(inScanWindow("2026-10-13", "2026-10-14")).toBe(false);
  });

  it("a streak rule without a win before the window loads the whole history", () => {
    expect(planScanWindow("2026-10-14", null, true)).toEqual({ from: "2026-10-14", loadFrom: null });
    expect(planScanWindow("2026-10-14", "2026-09-30", true)).toEqual({ from: "2026-10-14", loadFrom: "2026-09-30" });
    expect(planScanWindow("2026-10-14", "2026-09-30", false)).toEqual({ from: "2026-10-14", loadFrom: "2026-10-14" });
  });
});
