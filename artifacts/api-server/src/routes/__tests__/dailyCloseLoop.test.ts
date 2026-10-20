/**
 * One day closure (Волна 0, items 0.4 / 0.5 / 0.7): «Разобрал» (POST /api/daily/review — the dashboard; the Telegram
 * button calls the same markReviewed) closes the day for the curator: an eod_days row with closed_at, the day in the
 * curator queue WITH the trader's note, one «День закрыт» notice (mirrored to Telegram). The journal form after it
 * extends the day instead of failing, and nothing is counted twice. Today closes only after 16:00 NY.
 * The DB is a small in-memory fake (eod_days, daily_reviews, notification_dedup); notifications are spied, nothing is sent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards: string[] };
const TRADER: Who = { id: 5, name: "Кирилл Б.", role: "trader", wards: [] };
const CURATOR: Who = { id: 3, name: "Ольга Н.", role: "curator", wards: ["Кирилл Б."] };
let who: Who = TRADER;
const whoRef = vi.hoisted(() => ({ current: { id: 5, name: "", role: "trader", wards: [] as string[] } }));

type Day = {
  id: number; trader: string; date: string; closedAt: Date | null; discipline: number | null; summary: Record<string, unknown>;
  reviewedBy: string | null; reviewedAt: Date | null; curatorComment: string | null; curatorScore: number | null; createdAt: Date; updatedAt: Date;
};
const state = vi.hoisted(() => ({
  days: new Map<string, Day>(),
  reviews: new Map<string, { note: string | null; reviewedAt: Date }>(),
  dedup: new Set<string>(),
  nextId: 100,
}));
const key = (t: unknown, d: unknown) => `${t}|${d}`;
const newDay = (trader: string, date: string): Day => ({
  id: state.nextId++, trader, date, closedAt: null, discipline: null, summary: {}, reviewedBy: null, reviewedAt: null,
  curatorComment: null, curatorScore: null, createdAt: new Date(), updatedAt: new Date(),
});
const copy = (d: Day | undefined) => (d ? [{ ...d, summary: { ...d.summary } }] : []);

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const ok = (rows: unknown[]) => ({ rows, rowCount: rows.length });
      // lib/permissions resolveActor (requireCap) reads the role and the wards from the DB
      if (/FROM users WHERE id = \$1/.test(sql)) return ok([{ role: whoRef.current.role, name: whoRef.current.name }]);
      if (/assigned_curator = \$1 OR/.test(sql)) return ok(whoRef.current.wards.map((name) => ({ name })));
      if (/INSERT INTO notification_dedup/.test(sql)) {
        const k = String(params[0]);
        if (state.dedup.has(k)) return ok([]);
        state.dedup.add(k);
        return ok([{ key: k }]);
      }
      if (/INSERT INTO daily_reviews \(trader, date, reviewed_at, note/.test(sql)) {
        const k = key(params[0], params[1]);
        const prev = state.reviews.get(k);
        state.reviews.set(k, { note: params[5] ? (params[2] as string | null) : prev?.note ?? null, reviewedAt: prev?.reviewedAt ?? new Date() });
        return ok([]);
      }
      if (/SELECT note FROM daily_reviews WHERE trader = \$1 AND date = \$2/.test(sql)) {
        const r = state.reviews.get(key(params[0], params[1]));
        return ok(r ? [{ note: r.note }] : []);
      }
      // «Разобрал» close (closeEodDay via "daily")
      if (/INSERT INTO eod_days AS d \(trader, date, summary, closed_at/.test(sql)) {
        const k = key(params[0], params[1]);
        const d = state.days.get(k) ?? newDay(String(params[0]), String(params[1]));
        if (d.closedAt) return ok([]);
        d.closedAt = new Date();
        d.summary = { ...d.summary, via: "daily" };
        state.days.set(k, d);
        return ok(copy(d));
      }
      // journal draft / summary upsert
      if (/INSERT INTO eod_days AS d \(trader, date, discipline, summary/.test(sql)) {
        const k = key(params[0], params[1]);
        const d = state.days.get(k) ?? newDay(String(params[0]), String(params[1]));
        if (params[4]) d.discipline = params[2] as number | null;
        if (params[3] != null) d.summary = JSON.parse(String(params[3]));
        state.days.set(k, d);
        return ok(copy(d));
      }
      if (/UPDATE eod_days d SET closed_at = NOW\(\)/.test(sql)) {
        const d = [...state.days.values()].find((x) => x.id === params[0]);
        if (d) d.closedAt = new Date();
        return ok(copy(d));
      }
      if (/UPDATE eod_days d SET reviewed_by/.test(sql)) {
        const d = [...state.days.values()].find((x) => x.id === params[0]);
        if (d) Object.assign(d, { reviewedBy: params[1], reviewedAt: new Date(), curatorComment: params[2], curatorScore: params[3] });
        return ok(copy(d));
      }
      if (/FROM eod_days d WHERE d\.trader = \$1 AND d\.date = \$2/.test(sql)) return ok(copy(state.days.get(key(params[0], params[1]))));
      if (/FROM eod_days d WHERE d\.id = \$1/.test(sql)) return ok(copy([...state.days.values()].find((x) => x.id === params[0])));
      // curator queue (QUEUE_SQL): closed, not reviewed — with the trader's note
      if (/AS "hoursWaiting"/.test(sql) && /d\.reviewed_at IS NULL/.test(sql)) {
        const rows = [...state.days.values()]
          .filter((d) => d.closedAt && !d.reviewedAt)
          .map((d) => ({ ...d, hoursWaiting: 1, trades: 0, net: null, note: state.reviews.get(key(d.trader, d.date))?.note ?? null }));
        return ok(rows);
      }
      if (/SELECT date FROM eod_days WHERE trader = \$1 AND closed_at IS NOT NULL/.test(sql)) {
        return ok([...state.days.values()].filter((d) => d.trader === params[0] && d.closedAt).map((d) => ({ date: d.date })));
      }
      return ok([]); // trades, holiday_calendar, journal_days, …
    }),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});
const notify = vi.hoisted(() => ({
  notifyUser: vi.fn(async () => 1),
  notifyUsers: vi.fn(async (names: Iterable<string>) => [...names]),
  assignedStaffOf: vi.fn(async () => ["Ольга Н."]),
}));
vi.mock("../../lib/notifyUtils", () => notify);
vi.mock("../../lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("../../lib/eodQueue", () => ({
  queueRoster: vi.fn(async () => ({ scope: "desk", traders: null, wards: 0 })),
  sweepOverdue: vi.fn(),
}));
vi.mock("../../lib/curatorStore", () => ({ ensureCuratorTables: vi.fn(async () => undefined), marketClosedDays: vi.fn(async () => new Set<string>()) }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: dailyRouter } = await import("../daily");
const { default: eodRouter } = await import("../eod");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    whoRef.current = who;
    next();
  });
  app.use("/api", dailyRouter);
  app.use("/api", eodRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = TRADER;
  state.days.clear();
  state.reviews.clear();
  state.dedup.clear();
  vi.clearAllMocks();
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const settle = () => new Promise((r) => setTimeout(r, 40)); // the curator notice runs in the background (setImmediate)
const DATE = "2026-10-16";

describe("«Разобрал» closes the day for the curator", () => {
  it("creates the closed eod day, puts it in the curator queue with the note, pings the curator once (also in Telegram)", async () => {
    const r = await call("POST", "/api/daily/review", { date: DATE, note: "перебрал размер на втором входе" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ reviewed: true, closed: true });
    const day = state.days.get(key(TRADER.name, DATE))!;
    expect(day.closedAt).toBeInstanceOf(Date);
    expect(day.summary).toMatchObject({ via: "daily" });
    await settle();
    expect(notify.notifyUsers).toHaveBeenCalledTimes(1);
    expect(notify.notifyUsers).toHaveBeenCalledWith(["Ольга Н."], expect.objectContaining({ type: "eod_review_request", telegram: true }), TRADER.name);

    // The journal shows it closed («Разобрал» day) with the note.
    const j = await call("GET", `/api/eod/day?date=${DATE}`);
    expect(j.json).toMatchObject({ status: "closed", closedVia: "daily", traderNote: "перебрал размер на втором входе" });

    who = CURATOR;
    const q = await call("GET", "/api/eod/queue");
    expect(q.status).toBe(200);
    expect(q.json.items).toHaveLength(1);
    expect(q.json.items[0]).toMatchObject({ trader: TRADER.name, date: DATE, note: "перебрал размер на втором входе", via: "daily" });

    // The curator's review goes back to the trader — in the app and in Telegram.
    const rv = await call("POST", `/api/eod/days/${day.id}/review`, { comment: "ок", score: 4 });
    expect(rv.status).toBe(200);
    await settle();
    expect(notify.notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userName: TRADER.name, type: "eod_reviewed", telegram: true }));
  });

  it("idempotent: «Разобрал» twice, then the journal form — one row, one notice, closed_at kept, the form extends the day", async () => {
    expect((await call("POST", "/api/daily/review", { date: DATE })).status).toBe(200);
    const closedAt = state.days.get(key(TRADER.name, DATE))!.closedAt;
    expect((await call("POST", "/api/daily/review", { date: DATE, note: "вторая мысль" })).status).toBe(200);
    expect(state.days.size).toBe(1);
    const form = await call("POST", `/api/eod/day/${DATE}/close`, { discipline: 4, summary: { mood: 4, repeat: "входы по плану", stop: "", tomorrow: "" } });
    expect(form.status).toBe(200);
    const day = state.days.get(key(TRADER.name, DATE))!;
    expect(day.closedAt).toBe(closedAt);
    expect(day.summary).toMatchObject({ repeat: "входы по плану" });
    expect(day.summary.via).toBeUndefined(); // now a full journal close
    await settle();
    expect(notify.notifyUsers).toHaveBeenCalledTimes(1);
    expect(state.reviews.get(key(TRADER.name, DATE))?.note).toBe("вторая мысль");
    // A second journal close is the old «already closed».
    expect((await call("POST", `/api/eod/day/${DATE}/close`, {})).json.code).toBe("EOD_ALREADY_CLOSED");
  });

  it("the other way round: journal close first, then «Разобрал» — no error, no second notice", async () => {
    expect((await call("POST", `/api/eod/day/${DATE}/close`, { discipline: 3 })).status).toBe(200);
    expect((await call("POST", "/api/daily/review", { date: DATE, note: "ок" })).status).toBe(200);
    await settle();
    expect(notify.notifyUsers).toHaveBeenCalledTimes(1);
    expect(state.days.get(key(TRADER.name, DATE))!.summary.via).toBeUndefined();
  });
});

describe("today closes only after the market close (16:00 NY)", () => {
  it("10:00 NY → 422 EOD_TOO_EARLY with opensAt, nothing written; 16:05 → closed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-16T14:00:00Z")); // Friday 10:00 NY
      const early = await call("POST", "/api/daily/review", { date: DATE });
      expect(early.status).toBe(422);
      expect(early.status).toBe(422); expect(early.json).toMatchObject({ code: "EOD_TOO_EARLY", details: { opensAt: "16:00" } });
      expect((await call("POST", `/api/eod/day/${DATE}/close`, {})).status).toBe(422);
      expect((await call("GET", `/api/eod/day?date=${DATE}`)).json).toMatchObject({ canClose: false, closeOpensAt: "16:00" });
      expect(state.days.size).toBe(0);
      expect(state.reviews.size).toBe(0);

      vi.setSystemTime(new Date("2026-10-16T20:05:00Z")); // 16:05 NY
      expect((await call("GET", `/api/eod/day?date=${DATE}`)).json).toMatchObject({ closeOpensAt: null });
      expect((await call("POST", "/api/daily/review", { date: DATE })).status).toBe(200);
      expect(state.days.get(key(TRADER.name, DATE))!.closedAt).toBeInstanceOf(Date);
    } finally {
      vi.useRealTimers();
    }
  });
});
