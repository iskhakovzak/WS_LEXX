/**
 * Daily loop Telegram jobs: they skip when the bot is not configured (and in development), the registry knows them,
 * and contract alerts / evening cards are sent once per trader+kind+day — also after a «restart» (markers live in
 * the DB, here an in-memory notification_dedup). lib/telegramBot is mocked: nothing goes to Telegram.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EveningCard } from "../daily/types";

const dedup = new Set<string>();
type Member = { name: string; chat_id: string; locale: string; role: string; last_trade: string | null; stage?: string };
const BASE: Member[] = [
  { name: "Кирилл Б.", chat_id: "111", locale: "ru", role: "trader", last_trade: "2026-10-15" },
  { name: "Ольга Н.", chat_id: "222", locale: "en", role: "curator", last_trade: "2026-10-15" },
];
let recipients: Member[] = BASE;
/** trader → NY dates with trades (the «вчера не разобран» read). */
let tradedOn: Record<string, string[]> = {};

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/academy_trader_stage/.test(sql)) {
        const rows = recipients.filter((r) => r.stage).map((r) => ({ user_name: r.name, stage: r.stage, since: "2026-09-01" }));
        return { rows, rowCount: rows.length };
      }
      if (/SELECT DISTINCT t\.trader FROM trades t/.test(sql)) {
        const [names, date] = params as [string[], string];
        const rows = names.filter((n) => tradedOn[n]?.includes(date)).map((trader) => ({ trader }));
        return { rows, rowCount: rows.length };
      }
      if (/last_trade/.test(sql)) return { rows: recipients, rowCount: recipients.length };
      if (/FROM users u/.test(sql)) {
        const names = params[0] as string[] | null;
        const rows = recipients.filter((r) => !names || names.includes(r.name));
        return { rows, rowCount: rows.length };
      }
      if (/SELECT key FROM notification_dedup/.test(sql)) {
        const keys = (params[0] as string[]).filter((k) => dedup.has(k));
        return { rows: keys.map((key) => ({ key })), rowCount: keys.length };
      }
      if (/DELETE FROM notification_dedup/.test(sql)) { dedup.delete(String(params[0])); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 }; // holiday_calendar, trader_plans
    }),
  },
}));
vi.mock("../notifyEvents", () => ({
  claimOnce: vi.fn(async (key: string) => { if (dedup.has(key)) return false; dedup.add(key); return true; }),
}));
const tg = vi.hoisted(() => ({ sendMessage: vi.fn(async (): Promise<boolean> => true) }));
vi.mock("../telegramBot", async (orig) => ({ ...(await orig<typeof import("../telegramBot")>()), ...tg }));
const guard = vi.hoisted(() => ({ on: true, sync: true }));
vi.mock("../daily/telegramGuard", () => ({
  dailyTelegramEnabled: () => guard.on,
  intradayAlertsEnabled: () => guard.on && guard.sync,
}));
const card = (trader: string): EveningCard => ({
  trader, date: "2026-10-16", trades: 3, netPnl: 120, focus: null, tradeToReview: null, deskSameTicker: null, contract: null, reviewed: false, reviewNote: null,
});
const svc = vi.hoisted(() => ({
  focusFor: vi.fn(async (trader: string, date: string) => ({ trader, date, mistake: null, window: { from: date, to: date }, costNet: null, count: 0, source: "none" as const, text: { key: "focus.none", params: { days: 10 } } })),
  eveningFor: vi.fn(async (_t: string, _d: string): Promise<EveningCard | null> => null),
  markReviewed: vi.fn(async () => undefined),
  isDayClosed: vi.fn(async (_t: string, _d: string) => false),
}));
vi.mock("../daily/service", () => svc);

const jobs = await import("../daily/telegramJobs");

// Friday 2026-10-16 in New York: 10:00 (session), 08:45 (premarket), 16:30 (after the close).
const AT = { session: new Date("2026-10-16T14:00:00Z"), morning: new Date("2026-10-16T12:45:00Z"), evening: new Date("2026-10-16T20:30:00Z"), saturday: new Date("2026-10-17T14:00:00Z") };
const breach = { trader: "Кирилл Б.", kind: "max_loss" as const, limit: 300, actual: -310 };

beforeEach(() => {
  dedup.clear();
  vi.clearAllMocks();
  guard.on = true;
  guard.sync = true;
  tg.sendMessage.mockImplementation(async () => true);
  svc.eveningFor.mockImplementation(async () => null);
  svc.isDayClosed.mockImplementation(async () => false);
  recipients = BASE;
  tradedOn = {};
});

describe("guards", () => {
  it("every job skips without sending when the bot is not configured", async () => {
    guard.on = false;
    const check = vi.fn(async () => [breach]);
    expect(await jobs.runMorningFocus({ now: AT.morning })).toMatchObject({ skipped: expect.any(String) });
    expect(await jobs.runEveningCards({ now: AT.evening })).toMatchObject({ skipped: expect.any(String) });
    expect(await jobs.runContractAlerts({ now: AT.session, check })).toMatchObject({ skipped: expect.any(String) });
    expect(check).not.toHaveBeenCalled();
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it("intraday alerts need the scheduled PropReports sync", async () => {
    guard.sync = false;
    const check = vi.fn(async () => [breach]);
    expect(await jobs.runContractAlerts({ now: AT.session, check })).toMatchObject({ skipped: expect.any(String) });
    expect(check).not.toHaveBeenCalled();
  });

  it("weekend, before the close, outside the session → skipped", async () => {
    expect(await jobs.runMorningFocus({ now: AT.saturday })).toMatchObject({ skipped: "market closed" });
    expect(await jobs.runEveningCards({ now: AT.session })).toMatchObject({ skipped: "before the close" });
    expect(await jobs.runContractAlerts({ now: AT.evening, check: async () => [breach] })).toMatchObject({ skipped: "outside the session" });
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it("the real guard: production AND a bot token", async () => {
    const { dailyTelegramEnabled } = await vi.importActual<typeof import("../daily/telegramGuard")>("../daily/telegramGuard");
    expect(dailyTelegramEnabled({ isProduction: true, telegram: { botToken: "123:abc" } })).toBe(true);
    expect(dailyTelegramEnabled({ isProduction: true, telegram: { botToken: " " } })).toBe(false);
    expect(dailyTelegramEnabled({ isProduction: false, telegram: { botToken: "123:abc" } })).toBe(false);
  });
});

describe("desk settings (admin → «Настройки деска»)", () => {
  it("a switch turned off skips the send; the evening waits for the configured time", async () => {
    const { __loadSettingsCache } = await import("../settings/registry");
    try {
      svc.eveningFor.mockImplementation(async (t: string) => card(t));
      __loadSettingsCache({ "telegram.morningEnabled": false, "telegram.contractAlertsEnabled": false, "telegram.eveningTime": "18:00" });
      expect(await jobs.runMorningFocus({ now: AT.morning })).toMatchObject({ skipped: "off in desk settings" });
      expect(await jobs.runContractAlerts({ now: AT.session, check: async () => [breach] })).toMatchObject({ skipped: "off in desk settings" });
      expect(await jobs.runEveningCards({ now: AT.evening })).toMatchObject({ skipped: "before the evening time" });
      expect(tg.sendMessage).not.toHaveBeenCalled();
      // 18:05 NY: the evening time passed → the cards go (a sync after the time sends them too)
      expect(await jobs.runEveningCards({ now: new Date("2026-10-16T22:05:00Z") })).toMatchObject({ sent: 2 });
      __loadSettingsCache({ "telegram.eveningEnabled": false });
      expect(await jobs.runEveningCards({ now: new Date("2026-10-16T22:10:00Z") })).toMatchObject({ skipped: "off in desk settings" });
    } finally {
      __loadSettingsCache({});
    }
  });
});

describe("once per trader + kind + day", () => {
  it("a contract alert is sent once, also across later syncs and a restart", async () => {
    const check = vi.fn(async () => [breach, { ...breach, kind: "max_trades" as const, limit: 10, actual: 11 }]);
    expect(await jobs.runContractAlerts({ now: AT.session, check })).toMatchObject({ sent: 2 });
    expect(await jobs.runContractAlerts({ now: AT.session, check })).toMatchObject({ sent: 0, dup: 2 });
    vi.resetModules(); // «restart»: fresh module state, the DB markers stay
    const again = await import("../daily/telegramJobs");
    expect(await again.runContractAlerts({ now: AT.session, check })).toMatchObject({ sent: 0, dup: 2 });
    expect(tg.sendMessage).toHaveBeenCalledTimes(2);
    expect((tg.sendMessage.mock.calls[0] as unknown[])[0]).toBe("111");
  });

  it("a send Telegram rejected is retried by the next run", async () => {
    tg.sendMessage.mockImplementationOnce(async () => false);
    const check = async () => [breach];
    expect(await jobs.runContractAlerts({ now: AT.session, check })).toMatchObject({ failed: 1 });
    expect(await jobs.runContractAlerts({ now: AT.session, check })).toMatchObject({ sent: 1 });
  });

  it("a breach of a trader without a linked / opted-in chat is skipped", async () => {
    const r = await jobs.runContractAlerts({ now: AT.session, check: async () => [{ ...breach, trader: "Нет Чата" }] });
    expect(r).toMatchObject({ skipped: 1, sent: 0 });
  });

  it("evening cards: only traders with a card, once per day; the card marker enables the buttons", async () => {
    svc.eveningFor.mockImplementation(async (t: string) => (t === "Кирилл Б." ? card(t) : null));
    expect(await jobs.runEveningCards({ now: AT.evening })).toMatchObject({ sent: 1, skipped: 1 });
    expect(await jobs.runEveningCards({ now: AT.evening })).toMatchObject({ sent: 0, dup: 1 });
    expect(dedup.has(jobs.dailyKey.card("2026-10-16", "Кирилл Б.", "111"))).toBe(true);
    const kb = (tg.sendMessage.mock.calls[0] as unknown as [string, string, { reply_markup: { inline_keyboard: { callback_data?: string }[][] } }])[2].reply_markup.inline_keyboard;
    expect(kb.flat().some((b) => b.callback_data === "daily:rev:2026-10-16")).toBe(true);
  });

  it("morning focus once per day, in each user's language", async () => {
    expect(await jobs.runMorningFocus({ now: AT.morning })).toMatchObject({ sent: 2 });
    expect(await jobs.runMorningFocus({ now: AT.morning })).toMatchObject({ sent: 0, dup: 2 });
    const [ru, en] = tg.sendMessage.mock.calls.map((c) => String((c as unknown[])[1]));
    expect(ru).not.toBe(en);
  });
});

describe("registry", () => {
  it("registers the three jobs; disabled when the bot is not configured", async () => {
    vi.resetModules();
    guard.on = false;
    const { listJobs, clearJobs, cronOf } = await import("../../jobs/registry");
    const { registerAllJobs } = await import("../../jobs/definitions");
    clearJobs();
    registerAllJobs();
    const byName = new Map(listJobs().map((j) => [j.name, j]));
    for (const n of ["telegram.daily-morning", "telegram.daily-evening", "telegram.contract-alerts"]) {
      expect(byName.has(n)).toBe(true);
      expect(byName.get(n)!.enabled?.()).toBe(false);
    }
    expect(cronOf(byName.get("telegram.daily-morning")!)).toBe("45 8 * * 1-5"); // desk-settings defaults
    expect(cronOf(byName.get("telegram.daily-evening")!)).toBe("30 16 * * 1-5");
    expect(byName.get("telegram.daily-evening")!.on).toContain("propreports.synced");
    expect(byName.get("telegram.contract-alerts")!.on).toContain("propreports.synced");
    expect(await byName.get("telegram.daily-morning")!.run({ signal: new AbortController().signal, trigger: "manual", logger: console, runId: null })).toMatchObject({ skipped: expect.any(String) });
    clearJobs();
  });
});

describe("morning recipients (Волна 0, item 0.7)", () => {
  const TODAY = "2026-10-16";
  it("traded in 14 days → active; a Стажёр / Джун → learner; a trader idle > 3 days or never → idle; staff only when trading", () => {
    expect(jobs.morningReason({ role: "trader", stage: "senior", lastTrade: "2026-10-15" }, TODAY)).toBe("active");
    expect(jobs.morningReason({ role: "curator", stage: null, lastTrade: "2026-10-03" }, TODAY)).toBe("active");
    expect(jobs.morningReason({ role: "trader", stage: "trainee", lastTrade: null }, TODAY)).toBe("learner");
    expect(jobs.morningReason({ role: "trader", stage: "junior", lastTrade: "2026-09-01" }, TODAY)).toBe("learner");
    expect(jobs.morningReason({ role: "trader", stage: "trader", lastTrade: "2026-09-20" }, TODAY)).toBe("idle");
    expect(jobs.morningReason({ role: "trader", stage: "senior", lastTrade: null }, TODAY)).toBe("idle");
    expect(jobs.morningReason({ role: "curator", stage: null, lastTrade: null }, TODAY)).toBeNull();
    expect(jobs.morningReason({ role: "admin", stage: "trainee", lastTrade: "2026-09-01" }, TODAY)).toBeNull();
    // A trade of today itself (premarket) is not «traded recently» — the window ends yesterday, as before.
    expect(jobs.morningReason({ role: "curator", stage: null, lastTrade: TODAY }, TODAY)).toBeNull();
  });

  it("the job: the newcomer without trades and the trader who stopped trading get it, idle staff does not", async () => {
    recipients = [
      { name: "Новичок", chat_id: "301", locale: "uz", role: "trader", last_trade: null }, // no stage → DEFAULT_STAGE («Джун») → learner
      { name: "Вернулся", chat_id: "302", locale: "ru", role: "trader", last_trade: "2026-09-25", stage: "trader" },
      { name: "Сеньор", chat_id: "303", locale: "ru", role: "trader", last_trade: "2026-10-15", stage: "senior" },
      { name: "Админ", chat_id: "304", locale: "ru", role: "admin", last_trade: null },
    ];
    const r = await jobs.runMorningFocus({ now: AT.morning });
    expect(r).toMatchObject({ recipients: 3, sent: 3, reasons: { learner: 1, idle: 1, active: 1 } });
    expect(tg.sendMessage.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(["301", "302", "303"]);
  });

  it("«вчера не разобран»: the previous trading day had trades and is not closed → one extra line", async () => {
    tradedOn = { "Кирилл Б.": ["2026-10-15"], "Ольга Н.": ["2026-10-15"] };
    svc.isDayClosed.mockImplementation(async (t: string) => t === "Ольга Н.");
    expect(await jobs.runMorningFocus({ now: AT.morning })).toMatchObject({ sent: 2, unreviewed: 1 });
    const text = (chat: string) => String((tg.sendMessage.mock.calls.find((c) => (c as unknown[])[0] === chat) as unknown[])[1]);
    expect(text("111")).toContain("Не разобран день");
    expect(text("222")).not.toMatch(/not reviewed yet/);
    expect(svc.isDayClosed).toHaveBeenCalledWith("Кирилл Б.", "2026-10-15");
  });

  it("Monday morning looks at Friday", async () => {
    expect(await jobs.prevOpenDay("2026-10-19")).toBe("2026-10-16");
  });
});
