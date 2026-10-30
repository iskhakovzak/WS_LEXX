/** Live risk signals: the pure detectors, the restricted windows, the settings defaults and the «desk saved» estimate. */
import { describe, expect, it } from "vitest";
import {
  BASELINE_MIN_TRADES, bannedWindow, baselineOf, detectLive, lossStreak, offPlan, restAfter, revenge, stopProximity, stopProximityLive,
  timesInText, windowsOf,
} from "../riskSignals/detect";
import { estimateSaved, summarizeSaved } from "../riskSignals/saved";
import { signalConfig } from "../riskSignals/config";
import { SETTINGS, type SettingKey } from "../settings/registry";
import type { Baseline, SignalTrade } from "../riskSignals/types";
import { renderNotification } from "../notificationText";

const T0 = Date.UTC(2026, 9, 21, 13, 30); // 09:30 NY (EDT)
const min = (m: number) => T0 + m * 60_000;
let nextId = 1;
function trade(p: Partial<SignalTrade> & { net?: number | null; in?: number; out?: number | null }): SignalTrade {
  const net = p.net ?? null;
  const entryAt = p.in != null ? min(p.in) : null;
  return {
    id: nextId++, ticker: p.ticker ?? "AAPL", result: p.result ?? (net == null ? "open" : net > 0 ? "win" : net < 0 ? "loss" : "be"), net,
    qty: p.qty ?? 100, entry: p.entry ?? 10, entryAt, exitAt: p.out === null ? null : p.out != null ? min(p.out) : entryAt != null ? entryAt + 60_000 : null,
    entryMin: p.in != null ? 570 + p.in : null, playbookId: p.playbookId ?? null,
  };
}
const cfg = signalConfig((k: SettingKey) => SETTINGS[k].default, false);

describe("settings", () => {
  it("defaults: 70 / 90 % stop, 3-loss streak, Telegram only when the environment allows it", () => {
    expect(cfg.stopPcts).toEqual([70, 90]);
    expect(cfg.streakLosses).toBe(3);
    expect(cfg.telegram).toBe(false);
    expect(signalConfig((k: SettingKey) => SETTINGS[k].default, true).telegram).toBe(true);
    // A desk that sets both levels equal gets one level, not a duplicate alert.
    expect(signalConfig((k) => (k === "riskSignals.stopWarnPct" ? 90 : SETTINGS[k].default), false).stopPcts).toEqual([90]);
  });
});

describe("stop proximity", () => {
  const day = [trade({ net: -200, in: 0, out: 30 }), trade({ net: -160, in: 40, out: 60 }), trade({ net: -110, in: 70, out: 90 })];

  it("dates each level at the exit that reached it; the top level is critical", () => {
    const hits = stopProximity(day, 500, [70, 90]);
    expect(hits.map((h) => [h.level, h.severity, h.at])).toEqual([["70", "warn", min(60)], ["90", "critical", min(90)]]);
    expect(hits[1]!.stats.pct).toBe(94);
    expect(stopProximity(day, null, [70, 90])).toEqual([]);
  });

  it("live: the dashboard % decides, a level reached only on open positions is dated now", () => {
    expect(stopProximityLive(day, { dailyPct: 94, pnlNet: -470, dailyLimit: 500 }, [70, 90], min(95)).map((h) => h.at)).toEqual([min(60), min(90)]);
    const open = stopProximityLive([trade({ net: -50, in: 0, out: 5 })], { dailyPct: 75, pnlNet: -375, dailyLimit: 500 }, [70, 90], min(20));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ level: "70", at: min(20), tradeId: null });
  });
});

describe("loss streak", () => {
  it("fires once at the Nth loss in a row; a win resets the run", () => {
    const day = [trade({ net: -10, in: 0 }), trade({ net: -10, in: 5 }), trade({ net: 20, in: 10 }), trade({ net: -5, in: 15 }), trade({ net: -6, in: 20 }), trade({ net: -7, in: 25 }), trade({ net: -8, in: 30 })];
    const hits = lossStreak(day, 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ level: "3", at: day[5]!.exitAt, stats: { losses: 3, lossUsd: 18 } });
  });
});

describe("revenge", () => {
  const baseline: Baseline = { trades: BASELINE_MIN_TRADES, medianNotional: 1000, entriesPerMin: 0.05 };
  const knobs = { revengeWindowMin: 10, revengeSizeRatio: 1.5, revengePaceRatio: 2 };

  it("size: an entry ≥ 1.5× the median within the window after a loss", () => {
    const day = [trade({ net: -50, in: 0, out: 5 }), trade({ net: 10, in: 7, qty: 200 })];
    const hits = revenge(day, baseline, knobs);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ level: "size", severity: "critical", tradeId: day[1]!.id, stats: { ratio: 2 } });
  });

  it("pace: max(3, 2 × usual) entries inside the window; outside the window it is not revenge", () => {
    const fast = [trade({ net: -50, in: 0, out: 5 }), trade({ net: 1, in: 6 }), trade({ net: 1, in: 8 }), trade({ net: 1, in: 11 })];
    expect(revenge(fast, baseline, knobs).map((h) => h.level)).toEqual(["pace"]);
    const slow = [trade({ net: -50, in: 0, out: 5 }), trade({ net: 1, in: 30, qty: 300 })];
    expect(revenge(slow, baseline, knobs)).toEqual([]);
  });

  it("without the trader's own history there is no «jump»", () => {
    const day = [trade({ net: -50, in: 0, out: 5 }), trade({ net: 10, in: 7, qty: 500 })];
    expect(revenge(day, { ...baseline, trades: BASELINE_MIN_TRADES - 1 }, knobs)).toEqual([]);
    expect(revenge(day, null, knobs)).toEqual([]);
  });

  it("baseline: median notional and entries per active minute", () => {
    const b = baselineOf([[trade({ net: 1, in: 0, out: 60, qty: 100 }), trade({ net: 1, in: 30, qty: 300 })]]);
    expect(b.medianNotional).toBe(2000);
    expect(b.entriesPerMin).toBeCloseTo(2 / 60, 6);
  });
});

describe("off plan", () => {
  it("only with a plan; one alert per ticker; a linked setup outside the picks counts", () => {
    const day = [trade({ ticker: "AAPL", net: 1, in: 0 }), trade({ ticker: "TSLA", net: 1, in: 5 }), trade({ ticker: "TSLA", net: 1, in: 9 }), trade({ ticker: "NVDA", net: 1, in: 12 })];
    expect(offPlan(day, { tickers: new Set(["AAPL"]), setups: new Set() }).map((h) => h.level)).toEqual(["TSLA", "NVDA"]);
    expect(offPlan(day, null)).toEqual([]);
    const picked = [trade({ ticker: "AAPL", net: 1, in: 0, playbookId: 7 }), trade({ ticker: "AAPL", net: 1, in: 5, playbookId: 8 })];
    expect(offPlan(picked, { tickers: new Set(["AAPL"]), setups: new Set([7]) }).map((h) => h.tradeId)).toEqual([picked[1]!.id]);
  });
});

describe("restricted windows", () => {
  const calendar = [
    { type: "cpi", name: "CPI Release", description: "8:30am ET — Consumer Price Index", importance: "high" },
    { type: "fomc", name: "FOMC Meeting (Decision Day)", description: "Statement 2pm ET, Powell presser 2:30pm ET", importance: "high" },
    { type: "holiday", name: "Christmas Eve", description: "Early close 1pm ET", importance: "high" },
    { type: "ppi", name: "PPI Release", description: "8:30am ET — Producer Price Index", importance: "medium" },
  ];

  it("parses event times; holidays and non-high events are not windows; high plan macro items are", () => {
    expect(timesInText("Statement 2pm ET, Powell presser 2:30pm ET")).toEqual([840, 870]);
    const w = windowsOf(calendar, [{ time: "10:00", title: "ISM", impact: "high" }, { time: "11:00", title: "x", impact: "low" }], 5, 5);
    expect(w.map((x) => x.key)).toEqual(["08:30", "10:00", "14:00", "14:30"]);
    expect(w[2]).toMatchObject({ startMin: 835, endMin: 845 });
  });

  it("an entry inside the window fires once per window", () => {
    const w = windowsOf(calendar, [], 5, 5);
    const day = [trade({ net: 1, in: 270 + 3 }), trade({ net: 1, in: 270 + 4 }), trade({ net: 1, in: 330 })]; // 14:03, 14:04, 15:00
    expect(bannedWindow(day, w).map((h) => h.level)).toEqual(["14:00"]);
  });
});

describe("detectLive", () => {
  it("does not double the stop levels (live numbers only) and keeps the other signals", () => {
    const day = [trade({ net: -200, in: 0, out: 10 }), trade({ net: -200, in: 12, out: 20 }), trade({ net: -100, in: 22, out: 30 })];
    const hits = detectLive({ trades: day, dailyLimit: 500, plan: null, windows: [], baseline: null }, cfg, { dailyPct: 100, pnlNet: -500 }, min(40));
    expect(hits.filter((h) => h.signal === "stop_proximity").map((h) => h.level)).toEqual(["70", "90"]);
    expect(hits.filter((h) => h.signal === "loss_streak")).toHaveLength(1);
  });
});

describe("entry-time signals on an open position", () => {
  const baseline: Baseline = { trades: BASELINE_MIN_TRADES, medianNotional: 1000, entriesPerMin: 0.05 };
  const plan = { tickers: new Set(["AAPL"]), setups: new Set<number>() };
  const windows = windowsOf([{ type: "fomc", name: "FOMC", description: "Statement 2pm ET", importance: "high" }], [], 5, 5);
  // 14:00 FOMC; a loss closed at 14:00, then an off-plan, oversized entry at 14:02 that is still OPEN (no exit, no P&L).
  const loss = trade({ ticker: "AAPL", net: -80, in: 260, out: 270 });
  const open = trade({ ticker: "TSLA", net: null, in: 272, out: null, qty: 300 });
  const keys = (hits: ReturnType<typeof detectLive>) => hits.map((h) => `${h.signal}|${h.level}`).sort();

  it("revenge / off-plan / restricted window fire from the opening fill (the open row), dated at the entry", () => {
    expect(open.result).toBe("open");
    const hits = detectLive({ trades: [loss, open], dailyLimit: null, plan, windows, baseline }, cfg, { dailyPct: null, pnlNet: null }, min(272));
    expect(keys(hits)).toEqual(["banned_window|14:00", "off_plan|TSLA", "revenge|size"]);
    expect(hits.every((h) => h.at === open.entryAt && h.tradeId === open.id)).toBe(true);
  });

  it("when the same row closes later the signals and their keys are the same (the stored alert dedups it)", () => {
    const atEntry = detectLive({ trades: [loss, open], dailyLimit: null, plan, windows, baseline }, cfg, { dailyPct: null, pnlNet: null }, min(272));
    const closed: SignalTrade = { ...open, result: "loss", net: -40, exitAt: min(290) };
    const atClose = detectLive({ trades: [loss, closed], dailyLimit: null, plan, windows, baseline }, cfg, { dailyPct: null, pnlNet: null }, min(291));
    expect(keys(atClose)).toEqual(keys(atEntry));
    expect(atClose.map((h) => h.at)).toEqual(atEntry.map((h) => h.at)); // the trigger stays the entry, not the exit
  });
});

describe("desk saved estimate", () => {
  it("rest of the session after the trigger", () => {
    const day = [trade({ net: -30, in: 0, out: 10 }), trade({ net: 50, in: 20, out: 40 }), trade({ net: -10, in: 50, out: 55 })];
    expect(restAfter(day, min(10))).toBe(40);
  });

  it("hidden below the minimum sample; can be negative; honest totals", () => {
    expect(estimateSaved(40, [-20, -40], 5)).toEqual({ rest: 40, baselineRest: -30, cases: 2, saved: null });
    expect(estimateSaved(40, [-20, -40, -30, -10, -50], 5)).toMatchObject({ baselineRest: -30, cases: 5, saved: 70 });
    expect(estimateSaved(-100, [10, 20, 30, 40, 50], 5).saved).toBe(-130);
    expect(estimateSaved(0, [], 5)).toEqual({ rest: 0, baselineRest: null, cases: 0, saved: null });
    const s = summarizeSaved([
      { day: "2026-10-20", signal: "loss_streak", settled: true, saved: 70, cases: 5 },
      { day: "2026-10-20", signal: "revenge", settled: true, saved: -20, cases: 8 },
      { day: "2026-10-21", signal: "revenge", settled: true, saved: null, cases: 2 },
      { day: "2026-10-21", signal: "off_plan", settled: false, saved: null, cases: null },
    ]);
    expect(s).toMatchObject({ alerts: 4, settled: 3, estimated: 2, hidden: 1, saved: 50, cases: 13 });
    expect(s.bySignal.find((b) => b.signal === "revenge")).toMatchObject({ estimated: 1, hidden: 1, saved: -20 });
  });
});

describe("staff notice", () => {
  it("renders the critical alert in the reader's language, with the numbers", () => {
    const en = renderNotification("risk_signal", { variant: "staff", trader: "Sig Trader", signal: "stop_proximity", level: "90", pct: 92, lossUsd: 120, limitUsd: 130 }, "en");
    expect(en?.title).toContain("92%");
    expect(en?.body).toContain("$120");
    const ru = renderNotification("risk_signal", { variant: "staff", trader: "Sig Trader", signal: "revenge", level: "pace", entries: 4, windowMin: 10, usual: 1.2, lossUsd: 50 }, "ru");
    expect(ru?.body).toContain("10");
    expect(renderNotification("risk_signal", { variant: "staff", trader: "Sig Trader", signal: "bogus" }, "en")).toBeNull();
  });
});
