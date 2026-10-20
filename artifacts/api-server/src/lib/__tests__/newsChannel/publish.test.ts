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

type Board = import("../../themes/logic").ThemesResponse;

/** `now`: the run's NY time (default 08:30); the themes board follows a fake clock that starts there. */
function harness(o: { closed?: boolean; sendOk?: boolean; busy?: boolean; now?: Date; board?: (now: Date) => Board } = {}) {
  const marks = new Set<string>();
  const sent: string[] = [];
  const lock = vi.fn(async (_n: string, fn: () => Promise<unknown>) => (o.busy ? "busy" : fn()));
  const start = o.now ?? F.ny(8, 30);
  const fc = F.fakeClock(start);
  const themes = vi.fn(async () => (o.board ?? ((n: Date) => F.boardAt(n)))(new Date(fc.now())));
  const deps = {
    now: () => start,
    isClosed: vi.fn(async () => !!o.closed),
    data: F.fixtureDeps({ themes, now: fc.now, sleep: fc.sleep }),
    send: vi.fn(async (text: string) => {
      sent.push(text);
      return o.sendOk === false ? { ok: false as const, status: 403, description: "Forbidden: bot is not a member", attempts: 1 } : { ok: true as const, messageId: 7, attempts: 1 };
    }),
    wasSent: vi.fn(async (k: string) => marks.has(k)),
    markSent: vi.fn(async (k: string) => { if (marks.has(k)) return false; marks.add(k); return true; }),
    withLock: lock as unknown as PublishDeps["withLock"],
  };
  return { deps, marks, sent, lock, clock: fc.clock, themes };
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
    const h = harness({ now: F.ny(10) });
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
    const h = harness({ now: F.ny(10) });
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
    const h = harness({ now: F.ny(16, 15) });
    await publishNewsPost("close", { trigger: "schedule", now: F.ny(16, 15) }, h.deps);
    const tomorrow = new Date(F.ny(16, 15).getTime() + 86_400_000);
    expect(await publishNewsPost("close", { trigger: "schedule", now: tomorrow }, h.deps)).toMatchObject({ status: "sent", date: "2026-10-21" });
  });

  it("a failed send is not marked (the next run retries); nothing to say is not marked either", async () => {
    const bad = harness({ sendOk: false });
    expect(await publishNewsPost("premarket", { trigger: "schedule" }, bad.deps)).toMatchObject({ status: "failed", reason: "Forbidden: bot is not a member" });
    expect(bad.marks.size).toBe(0);
    const empty = harness({ now: F.ny(10), board: (n) => F.boardAt(n, { themes: [] }) });
    expect(await publishNewsPost("open", { trigger: "schedule" }, empty.deps)).toMatchObject({ status: "skipped", reason: "no data", retryable: true });
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

describe("freshness: «open» / «close» wait for the board of their session", () => {
  it("stale themes: polls up to 60 s, then skips with the reason, sends and marks nothing", async () => {
    const h = harness({ now: F.ny(10), board: (n) => F.boardAt(n, { stale: true }) });
    const r = await publishNewsPost("open", { trigger: "schedule" }, h.deps);
    expect(r).toMatchObject({ status: "skipped", retryable: true });
    expect(r.reason).toMatch(/^stale/);
    expect(h.clock.t - F.ny(10).getTime()).toBe(60_000);
    expect(h.themes.mock.calls.length).toBe(13); // 0, 5, … 60 s
    expect(h.deps.send).not.toHaveBeenCalled();
    expect(h.marks.size).toBe(0);
  });

  it("numbers older than 2 × TTL are stale even when the flag is not set", async () => {
    const h = harness({ now: F.ny(10), board: (n) => F.boardAt(n, { ageMs: 5 * 60_000 }) });
    expect((await publishNewsPost("open", { trigger: "schedule" }, h.deps)).reason).toMatch(/^stale/);
  });

  it("session mismatch: rth numbers for the close post, or post numbers fetched before 16:00, are never posted", async () => {
    const rth = harness({ now: F.ny(16, 15), board: (n) => ({ ...F.boardAt(n), session: "rth" }) });
    const r = await publishNewsPost("close", { trigger: "schedule" }, rth.deps);
    expect(r).toMatchObject({ status: "skipped", reason: "session mismatch: rth, need post", retryable: true });
    expect(rth.deps.send).not.toHaveBeenCalled();
    // the session flag says "post", but the refresh was stamped at 16:00:30 (it started in rth)
    const early = harness({ now: F.ny(16, 5), board: () => ({ ...F.boardAt(F.ny(16, 1)), asOf: new Date(F.ny(16).getTime() + 30_000).toISOString() }) });
    expect((await publishNewsPost("close", { trigger: "manual", force: true }, early.deps)).reason).toBe("session mismatch: numbers from before the post session");
    expect(early.deps.send).not.toHaveBeenCalled();
    // premarket numbers at the open post
    const pre = harness({ now: F.ny(9, 40), board: () => ({ ...F.THEMES, session: "rth" }) });
    expect((await publishNewsPost("open", { trigger: "schedule" }, pre.deps)).reason).toBe("session mismatch: numbers from before the rth session");
  });

  it("fresh: waits for the refresh to land (stale for 12 s), then sends once and marks", async () => {
    const t0 = F.ny(10).getTime();
    const h = harness({ now: F.ny(10), board: (n) => (n.getTime() - t0 < 12_000 ? F.boardAt(n, { ageMs: 90_000, stale: true }) : F.boardAt(n)) });
    expect(await publishNewsPost("open", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "sent" });
    expect(h.clock.t - t0).toBe(15_000);
    expect(h.sent[0]).toContain("NVDA");
    expect(h.marks.has(newsKey("open", F.DAY))).toBe(true);
  });

  it("the premarket post does not wait for the board", async () => {
    const h = harness({ board: (n) => F.boardAt(n, { stale: true }) });
    expect(await publishNewsPost("premarket", { trigger: "schedule" }, h.deps)).toMatchObject({ status: "sent" });
    expect(h.themes.mock.calls.length).toBe(1);
  });
});

describe("retry scheduling", () => {
  afterEach(() => schedule.resetRetries());

  it("a retryable scheduled run is tried again 5 min later until the cutoff; the cron getter answers the retry minute", () => {
    const at = (hh: number, mm: number) => F.ny(hh, mm);
    const cron = schedule.postCron("open", () => at(10, 1));
    expect(schedule.planRetry("open", true, at(10, 0), at(10, 1))).toBe("10:05");
    expect(cron()).toBe("5 10 * * 1-5");
    expect(schedule.planRetry("open", true, at(10, 5), at(10, 6))).toBe("10:10");
    expect(cron()).toBe("10 10 * * 1-5");
    // a run longer than the spacing: the next free minute, never one already gone
    expect(schedule.planRetry("open", true, at(10, 10), at(10, 16))).toBe("10:17");
    expect(schedule.planRetry("open", true, at(10, 55), at(10, 56))).toBe("11:00"); // cutoff inclusive
    expect(schedule.planRetry("open", true, at(11, 0), at(11, 1))).toBeNull(); // 11:05 is past 11:00
    expect(cron()).toBe("0 10 * * 1-5"); // back to the post's time
    expect(schedule.planRetry("close", true, at(18, 55), at(18, 56))).toBe("19:00");
    expect(schedule.planRetry("close", true, at(19, 0), at(19, 0))).toBeNull();
    expect(schedule.planRetry("premarket", true, at(8, 30), at(8, 31))).toBeNull(); // not retried
  });

  it("a success (or any non-retryable end) drops the pending retry; yesterday's pending retry is ignored", () => {
    expect(schedule.planRetry("close", true, F.ny(16, 15), F.ny(16, 16))).toBe("16:20");
    expect(schedule.retryMinutes("close", F.ny(16, 17))).toBe(16 * 60 + 20);
    expect(schedule.retryMinutes("close", new Date(F.ny(16, 17).getTime() + 86_400_000))).toBeNull();
    expect(schedule.planRetry("close", false, F.ny(16, 20))).toBeNull();
    expect(schedule.retryMinutes("close", F.ny(16, 21))).toBeNull();
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
