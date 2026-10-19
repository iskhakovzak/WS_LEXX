/**
 * lib/gamification flows over mocks: recognition stored once and posted to the Telegram group only in production with
 * the switch on and the trader sharing (never from a development API); the feed shows aliases to traders, names to staff
 * and leaves hidden users out (but not for themselves); a season is finalized once (top 3 recognised once); reward
 * eligibility notified once; grant / decline notify the trader, a grant is recognised, a decided grant changes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "vitest-only-secret";

const db = vi.hoisted(() => ({
  inserted: new Set<string>(),
  hidden: new Set<string>(),
  nextId: 1,
}));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT INTO recognition_events")) {
        const k = `${params[0]}|${params[1]}|${params[2]}`;
        if (db.inserted.has(k)) return { rows: [], rowCount: 0 };
        db.inserted.add(k);
        return { rows: [{ id: db.nextId++, created_at: new Date("2026-10-16T21:00:00Z") }], rowCount: 1 };
      }
      if (sql.includes("shareAchievements' = 'false'")) {
        const names = (params[0] as string[] | null) ?? [...db.hidden];
        return { rows: names.filter((n) => db.hidden.has(n)).map((name) => ({ name })), rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
  },
}));
const tg = vi.hoisted(() => ({ sendMessage: vi.fn(async () => true), escHtml: (s: string) => s }));
vi.mock("../telegramBot", () => tg);
const notify = vi.hoisted(() => ({ notifyUser: vi.fn(async () => 1), notifyUsers: vi.fn(async (names: string[]) => names) }));
vi.mock("../notifyUtils", () => notify);
// Same rule as the real guard; the production test switches it on (config is a lazy proxy, NODE_ENV stays development).
const guard = vi.hoisted(() => ({ dailyTelegramEnabled: vi.fn((c: { isProduction: boolean; telegram: { botToken: string } }) => c.isProduction && !!c.telegram.botToken.trim()) }));
vi.mock("../daily/telegramGuard", () => guard);

const { config } = await import("../../config");
const { __loadSettingsCache } = await import("../settings/registry");
const rec = await import("../gamification/recognition");
import type { StoredRecognition } from "../gamification/recognition";

beforeEach(() => {
  db.inserted.clear(); db.hidden.clear(); db.nextId = 1;
  vi.clearAllMocks();
  __loadSettingsCache({});
});

describe("recognition", () => {
  const ev = { trader: "Кирилл Б.", kind: "achievement" as const, ref: "contract_streak:gold", params: { line: "contract_streak", tier: "gold", target: 20 }, day: "2026-10-16" };
  const now = new Date("2026-10-16T22:00:00Z");

  it("stored once; no Telegram post from a development API even with the switch on", async () => {
    __loadSettingsCache({ "gamification.telegramGroup": true });
    expect(await rec.recordRecognition(ev, now)).toBe(true);
    expect(await rec.recordRecognition(ev, now)).toBe(false);
    expect(tg.sendMessage).not.toHaveBeenCalled();
    expect(rec.groupPostEnabled({ isProduction: false, telegram: { botToken: "x", groupChatId: "-100" } })).toBe(false);
  });

  it("group post: production + token + chat + switch; off by default", () => {
    const prod = { isProduction: true, telegram: { botToken: "x", groupChatId: "-100" } };
    expect(rec.groupPostEnabled(prod)).toBe(false); // gamification.telegramGroup default off
    __loadSettingsCache({ "gamification.telegramGroup": true });
    expect(rec.groupPostEnabled(prod)).toBe(true);
    expect(rec.groupPostEnabled({ ...prod, telegram: { botToken: "x", groupChatId: null } })).toBe(false);
    expect(rec.groupPostEnabled({ ...prod, telegram: { botToken: "", groupChatId: "-100" } })).toBe(false);
  });

  it("posts once in production, never for a trader who hides achievements, never stale history", async () => {
    __loadSettingsCache({ "gamification.telegramGroup": true });
    const saved = { token: config.telegram.botToken, chat: (config.telegram as { groupChatId?: string | null }).groupChatId };
    guard.dailyTelegramEnabled.mockImplementation(() => true);
    Object.assign(config.telegram, { botToken: "x", groupChatId: "-100" });
    try {
      await rec.recordRecognition(ev, now);
      await rec.recordRecognition(ev, now);
      expect(tg.sendMessage).toHaveBeenCalledTimes(1);
      expect(String((tg.sendMessage.mock.calls[0] as unknown[])[1])).toContain("Кирилл Б.: достижение «Серия контракта» — золото");
      db.hidden.add("Максим Р.");
      await rec.recordRecognition({ ...ev, trader: "Максим Р." }, now);
      await rec.recordRecognition({ ...ev, ref: "old", day: "2026-09-01" }, now);
      expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      guard.dailyTelegramEnabled.mockImplementation((c) => c.isProduction && !!c.telegram.botToken.trim());
      Object.assign(config.telegram, { botToken: saved.token, groupChatId: saved.chat });
    }
  });

  it("feed: aliases for traders when names are hidden, names for staff and for oneself; hidden users left out", () => {
    const events: StoredRecognition[] = [
      { ...ev, id: 1, at: "2026-10-16T21:00:00Z" },
      { ...ev, id: 2, trader: "Максим Р.", kind: "streak" as const, ref: "25:2026-10-16", params: { days: 25 }, at: "2026-10-16T21:01:00Z" },
      { ...ev, id: 3, trader: "Анна С.", kind: "season_top" as const, ref: "2026-09", params: { season: "2026-09", rank: 1, points: 80 }, at: "2026-10-16T21:02:00Z" },
    ];
    const hidden = new Set(["Анна С."]);
    const trader = rec.recognitionItems(events, { name: "Кирилл Б.", staff: false }, "ru", { hidden, hideNames: true });
    expect(trader.map((i) => [i.id, i.trader])).toEqual([["recognition:1", "Кирилл Б."], ["recognition:2", null]]);
    expect(trader[1]!.title).toMatch(/^Трейдер \d: контракт соблюдён 25 дней подряд$/);
    expect(trader[1]!.meta).toMatchObject({ alias: expect.any(Number), text: { key: "recognition.streak", params: { days: 25 } } });
    expect(trader[0]).toMatchObject({ kind: "recognition", cats: ["desk", "achievement"], visibility: "public" });
    const staff = rec.recognitionItems(events, { name: "Ольга Н.", staff: true }, "en", { hidden, hideNames: true });
    expect(staff.map((i) => i.trader)).toEqual(["Кирилл Б.", "Максим Р."]);
    const self = rec.recognitionItems(events, { name: "Анна С.", staff: false }, "ru", { hidden, hideNames: true });
    expect(self.find((i) => i.id === "recognition:3")!.title).toBe("Анна С.: 1 место в сезоне «сентябрь 2026 г.»");
  });

  it("texts per kind", () => {
    expect(rec.recognitionText({ kind: "mastery", params: { level: 4, name: "1.3 ORB" } }, "en", "Kirill")).toBe("Kirill: level “Master” in the setup 1.3 ORB");
    expect(rec.recognitionText({ kind: "reward", params: { title: "Худи" } }, "uz", "Kirill")).toBe("Kirill «Худи» mukofotini oladi");
    expect(rec.recognitionText({ kind: "achievement", params: { line: "nope", tier: "gold" } }, "ru", "X")).toBeNull();
  });
});

describe("season finalization and rewards (stores mocked)", () => {
  it("finalized once: top 3 recognised once", async () => {
    vi.resetModules();
    const final = vi.fn().mockResolvedValueOnce([{ trader: "A", points: 50, rank: 1 }, { trader: "B", points: 40, rank: 2 }, { trader: "C", points: 40, rank: 2 }, { trader: "D", points: 9, rank: 4 }]).mockResolvedValue(null);
    vi.doMock("../gamification/seasonStore", () => ({ finalizeSeason: final, finalRanking: vi.fn(), seasonPlaces: vi.fn(), seasonRows: vi.fn() }));
    const recordRecognition = vi.fn(async () => true);
    vi.doMock("../gamification/recognition", () => ({ recordRecognition }));
    const svc = await import("../gamification/service");
    const people = ["A", "B", "C", "D"].map((name) => ({ name, curator: null, share: true }));
    expect(await svc.finalizePreviousSeason(people, new Date("2026-11-02T22:00:00Z"))).toBe("2026-10");
    expect(await svc.finalizePreviousSeason(people, new Date("2026-11-03T22:00:00Z"))).toBeNull();
    expect(final).toHaveBeenCalledWith("2026-10", ["A", "B", "C", "D"]);
    expect(recordRecognition.mock.calls.map((c) => [(c as unknown[])[0]])).toEqual([
      [expect.objectContaining({ trader: "A", kind: "season_top", ref: "2026-10", params: { season: "2026-10", rank: 1, points: 50 } })],
      [expect.objectContaining({ trader: "B", params: expect.objectContaining({ rank: 2 }) })],
      [expect.objectContaining({ trader: "C", params: expect.objectContaining({ rank: 2 }) })],
    ]);
    vi.doUnmock("../gamification/seasonStore");
    vi.doUnmock("../gamification/recognition");
  });

  it("eligibility notified once; grant notifies and is recognised; a decided grant changes nothing", async () => {
    vi.resetModules();
    const grant = { id: 9, itemId: 3, trader: "Кирилл Б.", status: "eligible" as const, at: "x", by: null, title: "Книга" };
    const insertEligible = vi.fn().mockResolvedValueOnce(grant).mockResolvedValue(null);
    const decideGrant = vi.fn().mockResolvedValueOnce({ ok: true, grant: { ...grant, status: "granted" } }).mockResolvedValue({ ok: false, code: "REWARD_GRANT_DECIDED" });
    const markGrantNoticesRead = vi.fn(async () => undefined);
    vi.doMock("../gamification/rewardsStore", () => ({
      insertEligible, decideGrant, listItems: vi.fn(async () => []), requestGrant: vi.fn(), grantsOf: vi.fn(async () => []),
      revokeGrants: vi.fn(async () => []), eligibleGrantsOfItem: vi.fn(async () => []), markGrantNoticesRead,
    }));
    const recordRecognition = vi.fn(async () => true);
    vi.doMock("../gamification/recognition", () => ({ recordRecognition }));
    const { notifyUser } = await import("../notifyUtils");
    const rs = await import("../gamification/rewardsService");
    const item = { id: 3, title: "Книга", description: null, active: true, stock: null, condition: { kind: "level" as const, ref: "1" } };
    const input = { achievements: [], level: 2, seasons: [], mastery: [] };
    expect(await rs.syncRewards("Кирилл Б.", input, [item])).toHaveLength(1);
    expect(await rs.syncRewards("Кирилл Б.", input, [item])).toHaveLength(0);
    expect(await rs.syncRewards("Кирилл Б.", input, [{ ...item, active: false }])).toHaveLength(0);
    expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyUser).mock.calls[0]![0]).toMatchObject({ userName: "Кирилл Б.", type: "reward_eligible", link: "/ratings?tab=quests&rewards=1" });
    vi.mocked(notifyUser).mockClear();
    expect((await rs.decideReward(grant, "granted", "Ольга Н.", "молодец")).ok).toBe(true);
    expect(vi.mocked(notifyUser).mock.calls[0]![0]).toMatchObject({ type: "reward_granted", params: expect.objectContaining({ title: "Книга", note: "молодец" }) });
    expect(recordRecognition).toHaveBeenCalledWith(expect.objectContaining({ kind: "reward", ref: "grant:9" }), expect.any(Date));
    // The staff «просит награду» notification of a decided grant is marked read (OLGA-16).
    expect(markGrantNoticesRead).toHaveBeenCalledWith("reward_requested", [9]);
    vi.mocked(notifyUser).mockClear();
    expect(await rs.decideReward(grant, "declined", "Ольга Н.", null)).toEqual({ ok: false, code: "REWARD_GRANT_DECIDED" });
    expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    vi.doUnmock("../gamification/rewardsStore");
    vi.doUnmock("../gamification/recognition");
  });

  it("stale eligibility is revoked: inactive item or condition no longer met; an item edit re-checks (ILYA-17)", async () => {
    vi.resetModules();
    const open = { id: 16, itemId: 3, trader: "Денис Ф.", status: "eligible" as const, at: "x", by: null, ref: "", title: "Разбор 1:1" };
    const revokeGrants = vi.fn(async (ids: readonly number[]) => ids.map((id) => ({ id, trader: "Денис Ф." })));
    const markGrantNoticesRead = vi.fn(async () => undefined);
    const eligibleGrantsOfItem = vi.fn(async () => [open]);
    vi.doMock("../gamification/rewardsStore", () => ({
      insertEligible: vi.fn(async () => null), decideGrant: vi.fn(), listItems: vi.fn(async () => []), requestGrant: vi.fn(),
      grantsOf: vi.fn(async () => [open]), revokeGrants, eligibleGrantsOfItem, markGrantNoticesRead,
    }));
    vi.doMock("../gamification/recognition", () => ({ recordRecognition: vi.fn(async () => true) }));
    const rs = await import("../gamification/rewardsService");
    const master = { id: 3, title: "Разбор 1:1", description: null, active: true, stock: null, condition: { kind: "mastery" as const, ref: "", tier: "4" } };
    const expert = { achievements: [], level: 1, seasons: [], mastery: [{ setupId: 205, code: "1.3", level: 3 }] };
    // Mastery «Мастер» needed, the trader is «Эксперт» → the old eligible row is revoked, its notification read.
    await rs.syncRewards("Денис Ф.", expert, [master]);
    expect(revokeGrants).toHaveBeenCalledWith([16]);
    expect(markGrantNoticesRead).toHaveBeenCalledWith("reward_eligible", [16]);
    revokeGrants.mockClear();
    // Still a master → kept.
    await rs.syncRewards("Денис Ф.", { ...expert, mastery: [{ setupId: 205, code: "1.3", level: 4 }] }, [master]);
    expect(revokeGrants).not.toHaveBeenCalled();
    // Deactivated by the admin → revoked at once, nobody re-checked.
    const inputOf = vi.fn(async () => expert);
    await rs.recheckItem(master, { ...master, active: false }, inputOf);
    expect(revokeGrants).toHaveBeenCalledWith([16]);
    expect(inputOf).not.toHaveBeenCalled();
    revokeGrants.mockClear();
    // Same condition, other text → nothing to re-check.
    await rs.recheckItem(master, { ...master, title: "Разбор 1:1 с сеньором" }, inputOf);
    expect(inputOf).not.toHaveBeenCalled();
    // Condition edited (Эксперт → Мастер) → each eligible trader re-checked in the background.
    await rs.recheckItem({ ...master, condition: { ...master.condition, tier: "3" } }, master, inputOf);
    await vi.waitFor(() => expect(revokeGrants).toHaveBeenCalledWith([16]));
    expect(inputOf).toHaveBeenCalledWith("Денис Ф.");
    vi.doUnmock("../gamification/rewardsStore");
    vi.doUnmock("../gamification/recognition");
  });
});
