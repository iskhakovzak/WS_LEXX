/**
 * Phase 2 RISK-LIVE: PropReports open positions → live unrealized in the daily stop, the positions tick step, and the
 * `risk.alert` outbox flow (claim once → enqueue → handler). No DB, no PropReports host: the pool and the client are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Q = { sql: string; params: unknown[] };
const calls: Q[] = [];
/** SQL → rows responder (first match wins); default = no rows. */
let responders: Array<[RegExp, (params: unknown[]) => unknown[]]> = [];
const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  calls.push({ sql, params });
  for (const [re, fn] of responders) if (re.test(sql)) { const rows = fn(params); return { rows, rowCount: rows.length }; }
  return { rows: [], rowCount: 0 };
});
const release = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query, connect: vi.fn(async () => ({ query, release })) } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const notifyUser = vi.fn(async () => 1);
vi.mock("../notifyUtils", async (orig) => ({ ...(await orig<typeof import("../notifyUtils")>()), notifyUser, assignedStaffOf: vi.fn(async () => ["Куратор К."]) }));
const claimOnce = vi.fn(async () => true);
vi.mock("../notifyEvents", async (orig) => ({ ...(await orig<typeof import("../notifyEvents")>()), claimOnce, staffOrFallback: vi.fn(async () => ["Куратор К."]) }));

const { computeMetrics, liveRisk, LIVE_MAX_AGE_MIN } = await import("../riskMetrics");
const { parsePositionsTable, buildAccountSnapshots, saveLiveSnapshots } = await import("../livePositions");
const { parseCsvTable } = await import("../propreports/csv");
const { stopAlertOf, parseRiskAlertPayload, riskAlertHandler, RISK_ALERT_KIND } = await import("../riskAlerts");
const { claimAndQueue, recordStopAlerts } = await import("../riskAlertQueue");
const { riskNotice } = await import("../notifyEventsCore");
const { positionsStep, positionsDue, inLiveWindow } = await import("../propreports/steps/positions");
const { resetConfigForTests } = await import("../../config");
type DayRow = import("../riskMetrics").DayRow;
type Limits = import("../riskMetrics").Limits;
type AccountMapping = import("../propreports/sync").AccountMapping;

const T = "Денис Ф.";
const TODAY = "2026-10-19"; // Monday
const limits = (over: Partial<Limits> = {}): Limits => ({
  trader: T, accountSize: 25_000, dailyLossLimit: 300, weeklyLossLimit: 900, maxDrawdown: 2_000, maxRiskPerTrade: null,
  maxPositionUsd: null, maxOvernightExposure: null, maxOpenPositions: null, allowOvernight: true, allowSwing: true, tier: null,
  notes: null, updatedBy: null, updatedAt: null, ...over,
});
const day = (date: string, pnl: number | null): DayRow => ({ trader: T, date, pnl, source: "propreports", trades: 2, brokerTrades: 2, r: 0, fees: 0 });
const mapping = (account: string, trader: string | null, over: Partial<AccountMapping> = {}): AccountMapping => ({
  id: 1, account, accountId: null, accountName: null, trader, active: true, notes: null, aliases: [], lastSyncedAt: null, lastFillAt: null, ...over,
});
const at = (iso: string) => new Date(iso);
// 11:00 ET on Monday Oct 19 2026 (EDT, UTC−4).
const NOW = at("2026-10-19T15:00:00Z");

beforeEach(() => {
  calls.length = 0;
  responders = [];
  query.mockClear();
  notifyUser.mockClear();
  claimOnce.mockClear();
  claimOnce.mockImplementation(async () => true);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TELEGRAM_BOT_TOKEN;
  resetConfigForTests();
});

const CSV = [
  "Date,Account,Qty,Symbol,Avg,Close,Unrealized Delta,Unrealized,Qty Traded,Realized,Comm,Ecn Fee",
  "10/19/2026,DEN001,200,AAPL,180.50,179.00,-300.00,-300.00,200,0,1.00,0.20",
  "10/19/2026,DEN001,-100,TSLA,250,251.2,(120.00),(120.00),100,15.5,0.5,0.1",
  "10/19/2026,DEN001,0,NVDA,0,0,0,0,400,85,2,0.4",
  "10/19/2026,OLG002,50,AMD,150,152,100,100,50,0,0.5,0",
  "10/19/2026,UNKNOWN9,10,SPY,500,499,-10,-10,10,0,0,0",
  "Page 1/1",
].join("\n");

describe("parsePositionsTable", () => {
  it("keeps open rows only (Qty 0 = closed), parses (x) negatives, upper-cases symbols", () => {
    const rows = parsePositionsTable(parseCsvTable(CSV));
    expect(rows.map((r) => `${r.account}:${r.symbol}:${r.qty}`)).toEqual(["DEN001:AAPL:200", "DEN001:TSLA:-100", "OLG002:AMD:50", "UNKNOWN9:SPY:10"]);
    expect(rows[1].unrealized).toBe(-120);
    expect(rows[1].realized).toBe(15.5);
    expect(rows[0].avg).toBe(180.5);
  });
  it("degrades to [] without Account / Qty columns", () => {
    expect(parsePositionsTable(parseCsvTable("Foo,Bar\n1,2"))).toEqual([]);
  });
});

describe("buildAccountSnapshots", () => {
  it("sums per account, resolves aliases, keeps unmapped / inactive rows without a trader, and empties flat mapped accounts", () => {
    const rows = parsePositionsTable(parseCsvTable(CSV));
    const snaps = buildAccountSnapshots(rows, [
      mapping("DEN-1", T, { aliases: ["DEN001"] }),
      mapping("OLG002", "Ольга О.", { active: false }),
      mapping("UMI003", "Умид У."),
    ]);
    const by = Object.fromEntries(snaps.map((s) => [s.account, s]));
    expect(by["DEN-1"]).toMatchObject({ trader: T, openCount: 2, unrealized: -420 });
    expect(by["OLG002"]).toMatchObject({ trader: null, openCount: 1, unrealized: 100 });
    expect(by["UNKNOWN9"]).toMatchObject({ trader: null, openCount: 1 });
    expect(by["UMI003"]).toMatchObject({ trader: "Умид У.", openCount: 0, unrealized: 0, positions: [] });
  });
});

describe("liveRisk + computeMetrics: unrealized in the daily stop", () => {
  const snap = (unrealizedUsd: number, fetchedAt = "2026-10-19T14:57:00Z", openPositions = 2) => ({ date: TODAY, unrealizedUsd, openPositions, fetchedAt });

  it("a fresh snapshot is counted; a snapshot older than LIVE_MAX_AGE_MIN or of another day is not", () => {
    expect(liveRisk(snap(-100), TODAY, NOW)).toMatchObject({ ageMin: 3, counted: true });
    const old = new Date(NOW.getTime() - (LIVE_MAX_AGE_MIN + 1) * 60_000).toISOString();
    expect(liveRisk(snap(-100, old), TODAY, NOW)).toMatchObject({ counted: false });
    expect(liveRisk({ ...snap(-100), date: "2026-10-16" }, TODAY, NOW)).toBeNull();
    expect(liveRisk(null, TODAY, NOW)).toBeNull();
  });

  it("today's P&L = realized + unrealized: «до стопа осталось» shrinks and the stop trips on open positions", () => {
    const days = [day("2026-10-16", 500), day(TODAY, -120)];
    const realized = computeMetrics(T, days, [], limits(), TODAY);
    expect(realized.today.pnlNet).toBe(-120);
    expect(realized.stop.state).toBe("ok");
    expect(realized.stop.dailyRemainingUsd).toBe(180);

    const near = computeMetrics(T, days, [], limits(), TODAY, "ru", null, liveRisk(snap(-100), TODAY, NOW));
    expect(near.today).toMatchObject({ pnlNet: -220, realizedNet: -120, unrealizedUsd: -100 });
    expect(near.stop.state).toBe("warn");
    expect(near.stop.dailyRemainingUsd).toBe(80);

    const stopped = computeMetrics(T, days, [], limits(), TODAY, "ru", null, liveRisk(snap(-200), TODAY, NOW));
    expect(stopped.stop.state).toBe("stop");
    expect(stopped.halted).toBe(true);
    expect(stopped.week.pnlNet).toBe(-320); // the week starts on Monday Oct 19: −120 − 200 (Friday's +500 is last week)
    expect(stopped.live).toMatchObject({ counted: true, unrealizedUsd: -200 });
  });

  it("a stale snapshot is shown but not counted", () => {
    const old = new Date(NOW.getTime() - 45 * 60_000).toISOString();
    const m = computeMetrics(T, [day(TODAY, -120)], [], limits(), TODAY, "ru", null, liveRisk(snap(-500, old), TODAY, NOW));
    expect(m.today.pnlNet).toBe(-120);
    expect(m.today.unrealizedUsd).toBeNull();
    expect(m.live).toMatchObject({ counted: false, ageMin: 45 });
    expect(m.stop.state).toBe("ok");
  });

  it("the drawdown uses equity incl. unrealized, but the peak only moves on realized days", () => {
    const days = [day("2026-10-14", 1_000), day("2026-10-15", -500)];
    const m = computeMetrics(T, days, [], limits({ dailyLossLimit: null, weeklyLossLimit: null }), TODAY, "ru", null, liveRisk(snap(-1_600), TODAY, NOW));
    expect(m.drawdown.currentUsd).toBe(2_100);
    expect(m.drawdown.peakNet).toBe(1_000);
    expect(m.stop.state).toBe("drawdown");
    const up = computeMetrics(T, days, [], limits(), TODAY, "ru", null, liveRisk(snap(900), TODAY, NOW));
    expect(up.drawdown.currentUsd).toBe(0);
    expect(up.drawdown.peakNet).toBe(1_000);
  });

  it("a flat fresh snapshot keeps «no trades today» as null, not $0", () => {
    const m = computeMetrics(T, [day("2026-10-16", 50)], [], limits(), TODAY, "ru", null, liveRisk(snap(0, "2026-10-19T14:58:00Z", 0), TODAY, NOW));
    expect(m.today.pnlNet).toBeNull();
    expect(m.today.unrealizedUsd).toBeNull();
    expect(m.live?.counted).toBe(true);
  });
});

describe("risk.alert payload and notice", () => {
  const metrics = (u: number) => computeMetrics(T, [day(TODAY, -150)], [], limits(), TODAY, "ru", null, liveRisk({ date: TODAY, unrealizedUsd: u, openPositions: 1, fetchedAt: "2026-10-19T14:59:00Z" }, TODAY, NOW));

  it("stopAlertOf: null when ok, warn / stop with the live unrealized; the payload survives a JSON round trip", () => {
    expect(stopAlertOf(computeMetrics(T, [day(TODAY, -10)], [], limits(), TODAY), limits(), TODAY)).toBeNull();
    const warn = stopAlertOf(metrics(-70), limits(), TODAY)!;
    expect(warn).toMatchObject({ state: "warn", halted: false, todayLoss: 220, unrealized: -70 });
    const stop = stopAlertOf(metrics(-200), limits(), TODAY)!;
    expect(stop).toMatchObject({ state: "stop", halted: true, used: 350, limit: 300 });
    expect(parseRiskAlertPayload(JSON.parse(JSON.stringify(stop)))).toEqual(stop);
    expect(parseRiskAlertPayload({ trader: T, date: TODAY, state: "ok" })).toBeNull();
    expect(parseRiskAlertPayload(null)).toBeNull();
  });

  it("the notice says the stop counts open positions (RU / EN / UZ)", () => {
    const base = { trader: T, state: "stop", halted: true, todayLoss: 350, weekLoss: 350, currentDd: 0, dailyLimit: 300, weeklyLimit: 900, maxDrawdown: 2000, dailyPct: 116.7, weeklyPct: 38.9, drawdownPct: 0, warnPct: 70 };
    expect(riskNotice({ ...base, unrealized: -200 }, "ru")!.core).toContain("с учётом открытых позиций −$200");
    expect(riskNotice({ ...base, unrealized: -200 }, "en")!.core).toContain("including open positions −$200");
    expect(riskNotice({ ...base, unrealized: -200 }, "uz")!.core).toContain("ochiq pozitsiyalar bilan −$200");
    expect(riskNotice(base, "ru")!.core).not.toContain("открытых");
    expect(riskNotice({ ...base, unrealized: -200 }, "ru")!.params.unrealized).toBe(-200);
  });
});

describe("claimAndQueue / recordStopAlerts", () => {
  const payload = () => stopAlertOf(computeMetrics(T, [day(TODAY, -400)], [], limits(), TODAY), limits(), TODAY)!;

  it("first claim enqueues `risk.alert` in the same transaction; a repeat claim rolls back and queues nothing", async () => {
    responders = [[/INSERT INTO risk_live_alerts/, () => [{ id: 1 }]]];
    expect(await claimAndQueue(payload())).toBe(true);
    const sqls = calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 3).join(" "));
    expect(sqls).toEqual(["BEGIN", "INSERT INTO risk_live_alerts", "INSERT INTO propreports_outbox", "COMMIT"]);
    expect(calls[2].params[0]).toBe(RISK_ALERT_KIND);

    calls.length = 0;
    responders = [[/INSERT INTO risk_live_alerts/, () => []]];
    expect(await claimAndQueue(payload())).toBe(false);
    expect(calls.some((c) => /propreports_outbox/.test(c.sql))).toBe(false);
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("recordStopAlerts on the live day claims once per process memo (a poll every minute does not re-claim)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    responders = [[/INSERT INTO risk_live_alerts/, () => []]]; // already claimed elsewhere
    const m = computeMetrics("Ольга О.", [{ ...day(TODAY, -400), trader: "Ольга О." }], [], { ...limits(), trader: "Ольга О." }, TODAY);
    await recordStopAlerts(m, { ...limits(), trader: "Ольга О." }, TODAY);
    const first = calls.filter((c) => /risk_live_alerts/.test(c.sql)).length;
    await recordStopAlerts(m, { ...limits(), trader: "Ольга О." }, TODAY);
    expect(first).toBe(1);
    expect(calls.filter((c) => /risk_live_alerts/.test(c.sql)).length).toBe(1);
  });
});

describe("riskAlertHandler", () => {
  const payload = () => stopAlertOf(computeMetrics(T, [day(TODAY, -400)], [], limits(), TODAY), limits(), TODAY)!;

  it("logs the breach and notifies trader + staff once; Telegram only when a bot token is configured", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    responders = [[/INSERT INTO risk_alert_log/, () => [{ id: 7 }]]];
    await riskAlertHandler(JSON.parse(JSON.stringify(payload())));
    expect(calls.some((c) => /INSERT INTO risk_alert_log/.test(c.sql))).toBe(true);
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser.mock.calls.map((c) => (c as unknown as [{ userName: string; type: string; telegram: boolean }])[0]))
      .toEqual([expect.objectContaining({ userName: T, type: "risk_breach", telegram: false }), expect.objectContaining({ userName: "Куратор К.", telegram: false })]);

    notifyUser.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    resetConfigForTests();
    await riskAlertHandler(payload());
    expect(notifyUser.mock.calls.every((c) => (c as unknown as [{ telegram: boolean }])[0].telegram === true)).toBe(true);
  });

  it("does not notify twice (claimOnce) and a payload of an earlier day is only logged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    claimOnce.mockImplementation(async () => false);
    await riskAlertHandler(payload());
    expect(notifyUser).not.toHaveBeenCalled();

    claimOnce.mockImplementation(async () => true);
    calls.length = 0;
    await riskAlertHandler({ ...payload(), date: "2026-10-16" });
    expect(calls.some((c) => /INSERT INTO risk_alert_log/.test(c.sql))).toBe(true);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("drops a malformed payload without throwing", async () => {
    await expect(riskAlertHandler({ nope: 1 })).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("positions tick step", () => {
  it("is due every tick inside 09:30–16:15 ET on weekdays (at most once a minute)", () => {
    expect(inLiveWindow(at("2026-10-19T13:29:00Z"))).toBe(false); // 09:29 ET
    expect(inLiveWindow(at("2026-10-19T13:30:00Z"))).toBe(true);
    expect(inLiveWindow(at("2026-10-19T20:15:00Z"))).toBe(true); // 16:15 ET
    expect(inLiveWindow(at("2026-10-19T20:20:00Z"))).toBe(false);
    expect(inLiveWindow(at("2026-10-17T15:00:00Z"))).toBe(false); // Saturday
    expect(positionsDue(NOW, null)).toBe(true);
    expect(positionsDue(NOW, new Date(NOW.getTime() - 30_000))).toBe(false);
    expect(positionsDue(NOW, new Date(NOW.getTime() - 5 * 60_000))).toBe(true);
  });

  it("run: positions(type=open) for today → snapshot upsert + empties stale accounts → alert scan", async () => {
    responders = [
      [/FROM propreports_accounts/, () => [{ id: 1, account: "DEN-1", trader: T, active: true, aliases: ["DEN001"] }]],
      [/FROM holiday_calendar/, () => []],
    ];
    const positions = vi.fn(async () => parseCsvTable(CSV));
    const ctx = {
      now: NOW, deadline: Date.now() + 40_000, client: { positions } as never, enqueue: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn() } as never,
    };
    const res = await positionsStep.run(ctx);
    expect(positions).toHaveBeenCalledWith(TODAY, TODAY, "open");
    const upsert = calls.find((c) => /INSERT INTO propreports_live_positions/.test(c.sql))!;
    const rows = JSON.parse(String(upsert.params[0])) as Array<{ account: string; trader: string | null; unrealized: number }>;
    expect(rows.find((r) => r.account === "DEN-1")).toMatchObject({ trader: T, unrealized: -420 });
    expect(upsert.params[1]).toBe(TODAY);
    const empty = calls.find((c) => /UPDATE propreports_live_positions/.test(c.sql))!;
    expect(empty.params[2]).toEqual(expect.arrayContaining(["DEN-1", "OLG002", "UNKNOWN9"]));
    expect(res.done).toBe(true);
    expect(res.note).toMatch(/4 open in 3\/3 accounts, 2 unmapped/);
  });

  it("run outside the window or on a holiday does nothing", async () => {
    const positions = vi.fn();
    const ctx = { now: at("2026-10-19T22:00:00Z"), deadline: Date.now() + 40_000, client: { positions } as never, enqueue: vi.fn(), log: { info: vi.fn() } as never };
    expect(await positionsStep.run(ctx)).toMatchObject({ done: true });
    responders = [[/FROM holiday_calendar/, () => [{ "?column?": 1 }]]];
    expect(await positionsStep.run({ ...ctx, now: at("2026-11-26T15:00:00Z") })).toMatchObject({ done: true, note: "market closed" });
    expect(positions).not.toHaveBeenCalled();
  });

  it("saveLiveSnapshots with no accounts still empties every stored row", async () => {
    await saveLiveSnapshots([], TODAY, NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/UPDATE propreports_live_positions/);
    expect(calls[0].params[2]).toEqual([]);
  });
});
