/**
 * lib/newsChannel publish / schedule / send — gating (env + desk switch + post switch + production), holiday skip,
 * once per post and NY day (force re-sends), a failed send is not marked, the lock, the three jobs, and the Telegram
 * retry policy. Everything is injected: no DB, no network, nothing reaches Telegram.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const { resetConfigForTests } = await import("../../../config");
const { __loadSettingsCache } = await import("../../settings/registry");
const { newsKey, previewNewsPost, publishNewsPost } = await import("../../newsChannel/publish");
const schedule = await import("../../newsChannel/schedule");
const { MAX_ATTEMPTS, retryDelayMs, sendChannelMessage } = await import("../../newsChannel/send");
const { logger } = await import("../../logger");
const F = await import("./fixtures");
type PublishDeps = import("../../newsChannel/publish").PublishDeps;

const ENV = { NEWS_CHANNEL_BOT_TOKEN: "123:secret-token", NEWS_CHANNEL_CHAT_ID: "-100200300" };
const setEnv = (on: boolean) => {
  for (const [k, v] of Object.entries(ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
  resetConfigForTests();
};

function harness(o: { closed?: boolean; sendOk?: boolean; busy?: boolean } = {}) {
  const marks = new Set<string>();
  const sent: string[] = [];
  const lock = vi.fn(async (_n: string, fn: () => Promise<unknown>) => (o.busy ? "busy" : fn()));
  const deps = {
    now: () => F.ny(8, 30),
    isClosed: vi.fn(async () => !!o.closed),
    data: F.fixtureDeps(),
    send: vi.fn(async (text: string) => {
      sent.push(text);
      return o.sendOk === false ? { ok: false as const, status: 403, description: "Forbidden: bot is not a member", attempts: 1 } : { ok: true as const, messageId: 7, attempts: 1 };
    }),
    wasSent: vi.fn(async (k: string) => marks.has(k)),
    markSent: vi.fn(async (k: string) => { if (marks.has(k)) return false; marks.add(k); return true; }),
    withLock: lock as unknown as PublishDeps["withLock"],
  };
  return { deps, marks, sent, lock };
}

beforeEach(() => {
  setEnv(true);
  __loadSettingsCache({ "newsChannel.enabled": true });
});
afterEach(() => {
  setEnv(false);
  __loadSettingsCache({});
});

describe("gating", () => {
  it("off without both env vars or with the desk switch off (the default)", async () => {
    const h = harness();
    setEnv(false);
    expect(await publishNewsPost("premarket", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "skipped", reason: "not configured" });
    process.env.NEWS_CHANNEL_BOT_TOKEN = ENV.NEWS_CHANNEL_BOT_TOKEN; // chat id still missing
    resetConfigForTests();
    expect(schedule.newsChannelConfigured()).toBe(false);
    setEnv(true);
    __loadSettingsCache({});
    expect(await publishNewsPost("premarket", { trigger: "manual" }, h.deps)).toMatchObject({ status: "skipped", reason: "off in desk settings" });
    expect(h.deps.send).not.toHaveBeenCalled();
  });

  it("a scheduled run needs the post's switch; a manual push does not", async () => {
    __loadSettingsCache({ "newsChannel.enabled": true, "newsChannel.openEnabled": false });
    const h = harness();
    expect(await publishNewsPost("open", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "skipped", reason: "post off in desk settings" });
    expect(await publishNewsPost("open", { trigger: "manual" }, h.deps)).toMatchObject({ status: "sent" });
  });

  it("jobs are scheduled with everything on (dev API included: the env vars are the opt-in)", () => {
    const env = (isProduction: boolean, botToken = "t", chatId = "c") => ({ isProduction, newsChannel: { botToken, chatId } });
    expect(schedule.postScheduled("premarket", env(true))).toBe(true);
    expect(schedule.postScheduled("premarket", env(false))).toBe(true);
    expect(schedule.postScheduled("premarket", env(false, ""))).toBe(false);
    expect(schedule.postScheduled("premarket", env(true, "t", " "))).toBe(false);
    __loadSettingsCache({ "newsChannel.enabled": true, "newsChannel.closeEnabled": false });
    expect(schedule.postScheduled("close", env(true))).toBe(false);
  });

  it("times come from the desk settings, clamped to each post's window", () => {
    expect(["premarket", "open", "close"].map((p) => schedule.postCron(p as "open")())).toEqual(["30 8 * * 1-5", "0 10 * * 1-5", "15 16 * * 1-5"]);
    __loadSettingsCache({ "newsChannel.premarketTime": "09:45", "newsChannel.openTime": "09:00", "newsChannel.closeTime": "15:00" });
    expect(["premarket", "open", "close"].map((p) => schedule.postCron(p as "open")())).toEqual(["25 9 * * 1-5", "35 9 * * 1-5", "5 16 * * 1-5"]);
  });
});

describe("calendar and once a day", () => {
  it("a weekend / NYSE holiday is skipped without rendering or sending", async () => {
    const h = harness({ closed: true });
    expect(await publishNewsPost("premarket", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "skipped", reason: "market closed", date: F.DAY });
    expect(h.lock).not.toHaveBeenCalled();
    expect(h.deps.send).not.toHaveBeenCalled();
  });

  it("each post goes out once per NY day; a manual push respects it unless force", async () => {
    const h = harness();
    expect(await publishNewsPost("premarket", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "sent", attempts: 1 });
    expect(h.marks.has(newsKey("premarket", F.DAY))).toBe(true);
    expect(await publishNewsPost("premarket", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "dup" });
    expect(await publishNewsPost("premarket", { trigger: "manual" }, h.deps)).toMatchObject({ status: "dup" });
    expect(await publishNewsPost("open", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "sent" }); // another post
    expect(await publishNewsPost("premarket", { trigger: "manual", force: true }, h.deps)).toMatchObject({ status: "sent" });
    expect(h.sent.length).toBe(3);
    expect(h.sent[0]).toContain("Премаркет");
  });

  it("the next NY day is a new day", async () => {
    const h = harness();
    await publishNewsPost("close", { trigger: "schedule", now: F.ny(16, 15) }, h.deps);
    const tomorrow = new Date(F.ny(16, 15).getTime() + 86_400_000);
    expect(await publishNewsPost("close", { trigger: "schedule", now: tomorrow }, h.deps)).toMatchObject({ status: "sent", date: "2026-10-21" });
  });

  it("a failed send is not marked (the next run retries); nothing to say is not marked either", async () => {
    const bad = harness({ sendOk: false });
    expect(await publishNewsPost("premarket", { trigger: "schedule" }, bad.deps)).toMatchObject({ status: "failed", reason: "Forbidden: bot is not a member" });
    expect(bad.marks.size).toBe(0);
    const empty = harness();
    expect(await publishNewsPost("open", { trigger: "schedule" }, { ...empty.deps, data: F.EMPTY_DEPS })).toMatchObject({ status: "skipped", reason: "no data" });
    expect(empty.deps.send).not.toHaveBeenCalled();
    expect(empty.marks.size).toBe(0);
  });

  it("a second send of the same post while one runs is refused", async () => {
    const h = harness({ busy: true });
    expect(await publishNewsPost("premarket", { trigger: "manual" }, h.deps)).toMatchObject({ status: "busy" });
    expect(h.deps.send).not.toHaveBeenCalled();
  });

  it("preview renders without sending or marking", async () => {
    setEnv(false);
    const h = harness({ closed: true });
    const p = await previewNewsPost("open", {}, h.deps);
    expect(p).toMatchObject({ post: "open", date: F.DAY, configured: false, enabled: false, marketClosed: true, alreadySent: false });
    expect(p.text).toContain("От открытия");
    expect(p.chars).toBe(p.text!.length);
    expect(h.deps.send).not.toHaveBeenCalled();
    expect(h.deps.markSent).not.toHaveBeenCalled();
  });
});

describe("jobs", () => {
  it("three jobs, schedules from the settings, off without the env vars", async () => {
    delete process.env.NEWS_CHANNEL_BOT_TOKEN;
    delete process.env.NEWS_CHANNEL_CHAT_ID;
    resetConfigForTests();
    const { clearJobs, cronOf, listJobs } = await import("../../../jobs/registry");
    const { registerAllJobs } = await import("../../../jobs/definitions");
    clearJobs();
    registerAllJobs();
    const byName = new Map(listJobs().map((j) => [j.name, j]));
    expect(cronOf(byName.get("news-channel.premarket")!)).toBe("30 8 * * 1-5");
    expect(cronOf(byName.get("news-channel.open")!)).toBe("0 10 * * 1-5");
    expect(cronOf(byName.get("news-channel.close")!)).toBe("15 16 * * 1-5");
    for (const n of Object.values(schedule.NEWS_JOBS)) expect(byName.get(n)!.enabled!()).toBe(false); // no NEWS_CHANNEL_* env
    clearJobs();
  });
});

describe("Telegram send", () => {
  const answer = (status: number, body: object) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
  const noSleep = vi.fn(async () => undefined);

  it("HTML parse mode, the chat id, the message id back", async () => {
    const fetchMock = vi.fn(async () => answer(200, { ok: true, result: { message_id: 42 } }));
    const r = await sendChannelMessage({ token: "T", chatId: "-100", text: "<b>x</b>" }, { fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });
    expect(r).toEqual({ ok: true, messageId: 42, attempts: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botT/sendMessage");
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "-100", text: "<b>x</b>", parse_mode: "HTML" });
  });

  it("retries 429 after retry_after and 5xx / network errors with backoff; 4xx is final; the token is never logged", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    noSleep.mockClear();
    const seq = [answer(429, { ok: false, description: "Too Many Requests", parameters: { retry_after: 3 } }), answer(502, { ok: false }), "throw", answer(200, { ok: true, result: { message_id: 1 } })];
    const fetchMock = vi.fn(async () => {
      const next = seq.shift();
      if (next === "throw") throw new TypeError("fetch failed https://api.telegram.org/botSECRET");
      return next as Response;
    });
    expect(await sendChannelMessage({ token: "SECRET", chatId: "c", text: "x" }, { fetch: fetchMock as unknown as typeof fetch, sleep: noSleep })).toMatchObject({ ok: true, attempts: 4 });
    expect(noSleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([3000, 2000, 4000]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");

    const bad = vi.fn(async () => answer(400, { ok: false, description: "Bad Request: can't parse entities" }));
    expect(await sendChannelMessage({ token: "SECRET", chatId: "c", text: "<b" }, { fetch: bad as unknown as typeof fetch, sleep: noSleep })).toMatchObject({ ok: false, status: 400, attempts: 1 });
    const down = vi.fn(async () => answer(503, { ok: false }));
    expect(await sendChannelMessage({ token: "SECRET", chatId: "c", text: "x" }, { fetch: down as unknown as typeof fetch, sleep: noSleep })).toMatchObject({ ok: false, status: 503, attempts: MAX_ATTEMPTS });
    expect(retryDelayMs(1, 120)).toBe(60_000);
    expect(retryDelayMs(10, null)).toBe(30_000);
    warn.mockRestore();
  });
});

describe("send-now error", () => {
  it("NEWS_CHANNEL_NOT_CONFIGURED is a 503 with RU / EN / UZ text", async () => {
    const { AppError, errorMessage } = await import("../../http/errors");
    expect(new AppError("NEWS_CHANNEL_NOT_CONFIGURED").status).toBe(503);
    for (const lang of ["ru", "en", "uz"] as const) expect(errorMessage("NEWS_CHANNEL_NOT_CONFIGURED", lang)).toContain("NEWS_CHANNEL_BOT_TOKEN");
    expect(errorMessage("NEWS_CHANNEL_NOT_CONFIGURED", "en")).not.toBe(errorMessage("NEWS_CHANNEL_NOT_CONFIGURED", "ru"));
  });
});
