/**
 * Волна 2 п. 2.13 — «Готово» on a curator task (routes/curatorTasks.ts + lib/gamification/taskDone.ts), route × role
 * over an in-memory pool that honours the two writes (the once-per-task stamp, the quest_events primary key):
 *  - the trader reports his own manual task: the assigning curator is notified, 5 discipline points once per NY day;
 *  - the same task again → { already }, a second task the same day → no points, the next day → points again;
 *  - someone else's task / a curator pressing it → 404, an auto-tracked curator quest → QUEST_NOT_MANUAL, a finished
 *    one → QUEST_NOT_ACTIVE;
 *  - the points fold into the discipline / season sums like a done quest's bonus.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 5, name: "Kirill", role: "trader" };
const OTHER: Who = { id: 6, name: "Maxim", role: "trader" };
const CURATOR: Who = { id: 3, name: "Olga", role: "curator" };
let who: Who = TRADER;
let today = "2026-10-20";

type Q = { id: number; trader: string; scope: string; template: string; params: Record<string, unknown>; status: string; assignedBy: string | null; note: string | null };
let quests = new Map<number, Q>();
let events = new Set<string>();
const task = (id: number, over: Partial<Q> = {}): Q => ({ id, trader: "Kirill", scope: "curator", template: "curator_task", params: {}, status: "active", assignedBy: "Olga", note: "Разбери три входа", ...over });

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/^UPDATE quest_instances SET params/.test(sql.trim())) {
        const [id, trader, day] = params as [number, string, string];
        const q = quests.get(id);
        if (!q || q.trader !== trader || q.scope !== "curator" || q.template !== "curator_task" || q.status !== "active" || "traderDoneOn" in q.params) return { rows: [], rowCount: 0 };
        q.params = { ...q.params, traderDoneOn: day };
        return { rows: [], rowCount: 1 };
      }
      if (/^INSERT INTO quest_events/.test(sql.trim())) {
        const key = (params as string[]).slice(0, 3).join("|");
        if (events.has(key)) return { rows: [], rowCount: 0 };
        events.add(key);
        return { rows: [], rowCount: 1 };
      }
      if (/FROM quest_events WHERE trader = \$1 AND kind = \$2/.test(sql)) {
        return { rows: [...events].map((k) => k.split("|")).filter(([t, k]) => t === params[0] && k === params[1]).map(([, , d]) => ({ day: d })) };
      }
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.role === "curator" ? ["Kirill"] : [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});
vi.mock("../../lib/quests/store", () => ({ questById: vi.fn(async (id: number) => (quests.has(id) ? { ...quests.get(id)!, params: { ...quests.get(id)!.params } } : null)) }));
const service = vi.hoisted(() => ({
  forgetQuests: vi.fn(),
  isManual: vi.fn((q: { scope: string; template: string }) => q.scope === "curator" && q.template === "curator_task"),
}));
vi.mock("../../lib/quests/service", () => service);
vi.mock("../../lib/tradingDate", async (orig) => ({ ...(await orig<typeof import("../../lib/tradingDate")>()), nyDate: () => today }));
vi.mock("../../i18n", async (orig) => ({ ...(await orig<typeof import("../../i18n")>()), localeOfUser: vi.fn(async () => "en") }));
const notify = vi.hoisted(() => ({ notifyUser: vi.fn(async (_opts: Record<string, unknown>) => 1) }));
vi.mock("../../lib/notifyUtils", () => notify);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../curatorTasks");
const { errorMiddleware } = await import("../../lib/http");
const { bonusRows, taskDoneBonuses, TASK_DONE_POINTS } = await import("../../lib/gamification/taskDone");
const { questPoints } = await import("../../lib/quests/engine");
const { seasonScore } = await import("../../lib/gamification/season");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = TRADER;
  today = "2026-10-20";
  quests = new Map([[7, task(7)], [8, task(8)], [9, task(9)], [10, task(10, { template: "review_days" })], [11, task(11, { status: "done" })], [12, task(12, { trader: "Maxim" })]]);
  events = new Set();
  vi.clearAllMocks();
});

const done = async (id: number) => {
  const r = await fetch(`${base}/api/curator/tasks/${id}/done`, { method: "POST" });
  return { status: r.status, json: (await r.json()) as any };
};

describe("POST /curator/tasks/:id/done", () => {
  it("the trader reports his task: 5 points, the curator is notified in his language with the task note", async () => {
    const r = await done(7);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, reportedOn: "2026-10-20", points: TASK_DONE_POINTS, already: false });
    expect(TASK_DONE_POINTS).toBe(5);
    expect(quests.get(7)!.params.traderDoneOn).toBe("2026-10-20");
    expect(service.forgetQuests).toHaveBeenCalledWith("Kirill");
    expect(notify.notifyUser).toHaveBeenCalledTimes(1);
    expect(notify.notifyUser.mock.calls[0]![0]).toMatchObject({
      userName: "Olga", actor: "Kirill", type: "curator_request", title: "Kirill: the curator task is done — please confirm",
      message: "Task: Разбери три входа", link: "/curator?trader=Kirill",
    });
  });

  it("points once: the same task again → already; another task the same day → no points; the next day → points", async () => {
    expect((await done(7)).json.points).toBe(5);
    const again = await done(7);
    expect(again.json).toMatchObject({ already: true, points: 0, reportedOn: "2026-10-20" });
    expect(notify.notifyUser).toHaveBeenCalledTimes(1);
    const second = await done(8);
    expect(second.json).toMatchObject({ already: false, points: 0 });
    expect(notify.notifyUser).toHaveBeenCalledTimes(2); // the curator still hears about every task
    today = "2026-10-21";
    expect((await done(9)).json.points).toBe(5);
    expect(await taskDoneBonuses("Kirill")).toEqual([
      { status: "done", completedOn: "2026-10-20", rewardPoints: 5 },
      { status: "done", completedOn: "2026-10-21", rewardPoints: 5 },
    ]);
  });

  it("someone else's task, a curator pressing it, an unknown id → 404; auto quest → QUEST_NOT_MANUAL; finished → QUEST_NOT_ACTIVE", async () => {
    expect((await done(12)).json.code).toBe("QUEST_NOT_FOUND");
    expect((await done(999)).status).toBe(404);
    who = CURATOR;
    expect((await done(7)).status).toBe(404);
    who = OTHER;
    expect((await done(7)).status).toBe(404);
    who = TRADER;
    expect((await done(10)).json.code).toBe("QUEST_NOT_MANUAL");
    expect((await done(11)).json.code).toBe("QUEST_NOT_ACTIVE");
    expect(events.size).toBe(0);
    expect(notify.notifyUser).not.toHaveBeenCalled();
  });
});

describe("task-done points fold into the discipline and season sums", () => {
  it("one bonus per day, counted like a done quest's points", () => {
    const bonus = bonusRows(["2026-10-20", "2026-10-20", "2026-10-21", "2026-09-30"]);
    expect(bonus).toHaveLength(3);
    const quests = [{ status: "done", rewardPoints: 10, completedOn: "2026-10-19" }, { status: "active", rewardPoints: 10, completedOn: null }] as const;
    expect(questPoints([...quests, ...bonus], "2026-10-01")).toEqual({ total: 25, recent: 20 });
    expect(seasonScore("2026-10", { ledger: [], quests: [...quests, ...bonus] })).toMatchObject({ quests: 20, points: 20, active: true });
  });
});
