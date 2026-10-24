/**
 * Roadmap R3 — alert budget, curator digest, reward batching, full reviews (acceptance tests; no Telegram, no network:
 * the pool is an in-memory fake and the Telegram sender is a spy).
 *  - the budget cap holds across event types (3 pushes a day, 1 coaching; risk exempt but deduplicated);
 *  - the dedupe window: a contract alert waits while a risk alert is fresher than 30 min;
 *  - the curator digest sends exactly once a day;
 *  - quest_done / achievement_earned batch into one in-app notice; rewards count only full EOD reviews.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  pushLog: [] as Row[],
  dedup: new Set<string>(),
  notifications: [] as Row[],
  batch: [] as Row[],
  eod: { closed: 0, unreviewed: 0 },
}));

vi.mock("@workspace/db", () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/FROM telegram_push_log WHERE user_name/.test(sql)) {
      return { rows: db.pushLog.filter((r) => r.user_name === params[0] && r.ny_date === params[1]) };
    }
    if (/INSERT INTO telegram_push_log/.test(sql)) {
      const row = { id: db.pushLog.length + 1, user_name: params[0], ny_date: params[1], kind: params[2], category: params[3], dedup_key: params[4], sent_at: params[5] };
      db.pushLog.push(row);
      return { rows: [{ id: String(row.id) }] };
    }
    if (/DELETE FROM telegram_push_log/.test(sql)) { db.pushLog = db.pushLog.filter((r) => r.id !== params[0]); return { rows: [] }; }
    if (/INSERT INTO notification_dedup/.test(sql)) {
      const k = String(params[0]);
      if (db.dedup.has(k)) return { rows: [] };
      db.dedup.add(k);
      return { rows: [{ key: k }] };
    }
    if (/FROM notification_prefs/.test(sql)) return { rows: [] };
    if (/INSERT INTO notifications/.test(sql)) { db.notifications.push({ user_name: params[0], type: params[1], params: params[11] }); return { rows: [{ id: db.notifications.length }] }; }
    if (/INSERT INTO notification_batch_items/.test(sql)) { db.batch.push({ id: db.batch.length + 1, user_name: params[0], type: params[1], params: JSON.parse(String(params[2])), flushed_at: null }); return { rows: [] }; }
    if (/FROM notification_batch_items WHERE flushed_at IS NULL/.test(sql)) return { rows: db.batch.filter((b) => !b.flushed_at) };
    if (/UPDATE notification_batch_items SET flushed_at/.test(sql)) {
      const ids = params[0] as number[];
      let n = 0;
      for (const b of db.batch) if (ids.includes(Number(b.id)) && !b.flushed_at) { b.flushed_at = new Date(); n++; }
      return { rows: [], rowCount: n };
    }
    if (/FROM eod_days WHERE trader = ANY/.test(sql)) return { rows: [db.eod] };
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  return { db: {}, pool: { query, connect: vi.fn(async () => client) } };
});

const { pushVerdict, pushCategory } = await import("../notificationCore");
const { claimPush } = await import("../pushBudget");
const { runCuratorDigest, digestParams } = await import("../curatorDigest");
const { batchNotice, enqueueBatch, flushBatches } = await import("../notificationBatch");
const { mirrorsToTelegram } = await import("../notifyEventsCore");
const { lineSeries } = await import("../quests/achievements");
const { isFullReview } = await import("../../routes/eod");

const BUDGET = { dailyPush: 3, coachingPush: 1, riskQuietMinutes: 30 };
const NOW = new Date("2026-03-10T15:00:00Z"); // 11:00 NY
const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000);

beforeEach(() => {
  db.pushLog = [];
  db.dedup.clear();
  db.notifications = [];
  db.batch = [];
  db.eod = { closed: 0, unreviewed: 0 };
});

describe("push budget (pure)", () => {
  it("categories", () => {
    expect(["risk_warn", "daily_contract_alert", "eod_reviewed", "idea_comment", "curator_digest"].map(pushCategory)).toEqual(["risk", "coaching", "standard", "exempt", "exempt"]);
  });

  it("caps across event types: 3 pushes a day, of them 1 coaching; risk never capped", () => {
    const log = [
      { kind: "daily_morning", category: "standard" as const, dedupKey: null, sentAt: at(300) },
      { kind: "daily_contract_alert", category: "coaching" as const, dedupKey: "contract:stop", sentAt: at(200) },
    ];
    expect(pushVerdict("daily_contract_alert", "contract:trades", log, BUDGET, NOW)).toEqual({ send: false, reason: "coaching_cap" });
    expect(pushVerdict("eod_reviewed", null, log, BUDGET, NOW)).toEqual({ send: true, category: "standard" });
    const full = [...log, { kind: "mention", category: "standard" as const, dedupKey: null, sentAt: at(100) }];
    expect(pushVerdict("eod_reviewed", null, full, BUDGET, NOW)).toEqual({ send: false, reason: "daily_cap" });
    expect(pushVerdict("risk_breach", "risk_breach:x", full, BUDGET, NOW)).toEqual({ send: true, category: "risk" });
    expect(pushVerdict("idea_comment", null, full, BUDGET, NOW)).toEqual({ send: true, category: "exempt" });
  });

  it("risk alerts are deduplicated", () => {
    const log = [{ kind: "risk_warn", category: "risk" as const, dedupKey: "risk_warn:T:2026-03-10", sentAt: at(5) }];
    expect(pushVerdict("risk_warn", "risk_warn:T:2026-03-10", log, BUDGET, NOW)).toEqual({ send: false, reason: "duplicate" });
  });

  it("dedupe window: a contract alert waits while a risk alert is fresher than 30 min", () => {
    const risk = (min: number) => [{ kind: "risk_breach", category: "risk" as const, dedupKey: "r", sentAt: at(min) }];
    expect(pushVerdict("daily_contract_alert", "contract:stop", risk(10), BUDGET, NOW)).toEqual({ send: false, reason: "risk_quiet" });
    expect(pushVerdict("daily_contract_alert", "contract:stop", risk(31), BUDGET, NOW)).toEqual({ send: true, category: "coaching" });
  });
});

describe("push budget (DB claim)", () => {
  it("logs pushes and holds back the 4th non-risk push of the day across types", async () => {
    expect((await claimPush("T", "daily_morning", null, NOW)).ok).toBe(true);
    expect((await claimPush("T", "risk_warn", "risk_warn:T", NOW)).ok).toBe(true);
    expect((await claimPush("T", "eod_reviewed", "eod_reviewed:1", NOW)).ok).toBe(true);
    expect((await claimPush("T", "mention", null, NOW)).ok).toBe(true);
    expect(await claimPush("T", "curator_request_done", null, NOW)).toEqual({ ok: false, reason: "daily_cap" });
    expect(await claimPush("T", "risk_warn", "risk_warn:T", NOW)).toEqual({ ok: false, reason: "duplicate" });
    expect((await claimPush("T", "risk_breach", "risk_breach:T", NOW)).ok).toBe(true);
    expect((await claimPush("Other", "mention", null, NOW)).ok).toBe(true);
    expect(db.pushLog.filter((r) => r.user_name === "T")).toHaveLength(5);
  });

  it("a closed day pings the curator in-app only (Telegram: the digest)", () => {
    expect(mirrorsToTelegram("eod_review_request")).toBe(false);
    expect(mirrorsToTelegram("eod_reviewed")).toBe(true);
  });
});

describe("curator digest", () => {
  const deps = (send: (c: string, h: string) => Promise<boolean>) => ({
    now: NOW,
    telegram: true,
    send,
    curators: async () => [{ curator: { name: "Curator A", chatId: "100", tgOn: true }, wards: ["T1", "T2", "T3"] }],
    rank: async () => [
      { trader: "T2", date: "2026-03-09", reason: "stop_breach", costNet: -150 },
      { trader: "T2", date: "2026-03-06", reason: "fees", costNet: -30 },
      { trader: "T1", date: "2026-03-09", reason: "loss_streak", costNet: -80 },
      { trader: "T3", date: "2026-03-09", reason: "giveback", costNet: null },
      { trader: "T4", date: "2026-03-09", reason: "rule", costNet: -5 },
    ],
  });

  it("sends exactly once a day (one Telegram + one in-app notice), with the top 3 distinct traders", async () => {
    db.eod = { closed: 2, unreviewed: 1 };
    const send = vi.fn(async (_chatId: string, _html: string) => true);
    const first = await runCuratorDigest(deps(send));
    const second = await runCuratorDigest(deps(send));
    expect(first).toMatchObject({ inApp: 1, telegram: 1, dup: 0 });
    expect(second).toMatchObject({ inApp: 0, telegram: 0, dup: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const html = send.mock.calls[0][1] as string;
    expect(html).toContain("T2");
    expect(html).toContain("T1");
    expect(html).toContain("T3");
    expect(html).not.toContain("T4");
    expect(db.notifications.filter((n) => n.type === "curator_digest")).toHaveLength(1);
  });

  it("no Telegram outside production / without a chat; nothing at all when there is nothing to say", async () => {
    const send = vi.fn(async (_chatId: string, _html: string) => true);
    db.eod = { closed: 1, unreviewed: 1 };
    expect(await runCuratorDigest({ ...deps(send), telegram: false })).toMatchObject({ inApp: 1, telegram: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(digestParams("2026-03-10", 0, 0, [], 3)).toBeNull();
  });
});

describe("reward pings batch nightly", () => {
  it("one notice per person: quests (+ achievements) → quest_done batch; achievements only → achievement_earned batch", async () => {
    await enqueueBatch("T", "quest_done", { points: 3 });
    await enqueueBatch("T", "quest_done", { points: 10 });
    await enqueueBatch("T", "achievement_earned", { line: "lessons", tier: "bronze" });
    await enqueueBatch("U", "achievement_earned", { line: "exams", tier: "bronze" });
    const r1 = await flushBatches();
    const r2 = await flushBatches();
    expect(r1).toMatchObject({ people: 2, items: 4, notified: 2 });
    expect(r2).toMatchObject({ items: 0, notified: 0 });
    expect(db.notifications.map((n) => [n.user_name, n.type, JSON.parse(String(n.params))])).toEqual([
      ["T", "quest_done", { variant: "batch", count: 2, points: 13, achievements: 1 }],
      ["U", "achievement_earned", { variant: "batch", count: 1 }],
    ]);
    expect(batchNotice([])).toBeNull();
  });
});

describe("rewards count only full EOD reviews", () => {
  const base = { asOf: "2026-03-13", ledger: [], focus: [], stops: [], cleanMonthMinDays: 15, games: [], plansBeforeOpen: [], promotions: [], lessons: [], exams: [], academy: false, onboarding: { done: 0, total: 0, doneOn: null } };
  const days = ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"];

  it("a one-tap «Разобрал» is «seen»: reviews_total / review_streak stay at 0", () => {
    const s = lineSeries({ ...base, reviews: days.map((d) => ({ date: d, reviewedOn: d })) });
    expect(s.reviews_total.current).toBe(0);
    expect(s.review_streak.current).toBe(0);
  });

  it("full reviews count", () => {
    const s = lineSeries({ ...base, reviews: days.map((d, i) => ({ date: d, reviewedOn: d, fullOn: i === 2 ? null : d })) });
    expect(s.reviews_total.current).toBe(4);
    expect(s.review_streak.current).toBe(2);
  });

  it("a full review = at least one trade review or mistake verdict", () => {
    expect(isFullReview([{ followedPlan: null, mistakes: [], lesson: "" }])).toBe(false);
    expect(isFullReview([{ followedPlan: true, mistakes: [], lesson: "" }])).toBe(true);
    expect(isFullReview([{ followedPlan: null, mistakes: ["fomo"], lesson: "" }])).toBe(true);
    expect(isFullReview([{ followedPlan: null, mistakes: [], lesson: "wait for the setup" }])).toBe(true);
  });
});
