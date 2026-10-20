/**
 * lib/newsChannel data selection + rendering from fixture data (no DB, no network): today's gappers only, shared theme
 * leaders / laggards, earnings by market cap with a cap, HTML escaping, empty sections dropped, ≤ 4096 chars.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const { gatherPost, isFundRow, pickEarnings, pickGaps, pickMovers, pickThemes } = await import("../../newsChannel/data");
const { compact, esc, fitMessage, renderPost, signedPct, TG_MAX_CHARS } = await import("../../newsChannel/render");
const F = await import("./fixtures");

const CAPS = { gappers: 5, earnings: 2, movers: 3 };
const SITE = "https://desk.example";

describe("formatting", () => {
  it("signed percent with 2 decimals, compact sizes, HTML escaping", () => {
    expect(signedPct(1.234)).toBe("+1.23%");
    expect(signedPct(-0.5)).toBe("-0.50%");
    expect(signedPct(-0.001)).toBe("0.00%");
    expect(compact(8_400_000)).toBe("8.4M");
    expect(compact(3_100_000_000_000)).toBe("3.1T");
    expect(compact(245_000_000_000)).toBe("245B");
    expect(compact(950)).toBe("950");
    expect(esc(`a<b> & "c"`)).toBe("a&lt;b&gt; &amp; &quot;c&quot;");
  });
});

describe("selection", () => {
  it("gappers: today's run only; ups from the gappers preset, downs from every run, one row per ticker", () => {
    const g = pickGaps(F.GAPPERS, [F.RELVOL], F.DAY);
    expect(g.up.map((r) => r.ticker)).toEqual(["ABCD", "XYZ", "MNO", "PQR", "STU", "VWX", "AAA", "BBB"]);
    expect(g.down.map((r) => r.ticker)).toEqual(["DOWN2", "DOWN1"]);
    expect(pickGaps(F.STALE_GAPPERS, [], F.DAY)).toEqual({ up: [], down: [] });
  });

  it("themes: 3 leaders best-first, 3 laggards worst-first, no overlap; themes without the value are left out", () => {
    const { leaders, laggards } = pickThemes(F.THEMES.themes, "premarket");
    expect(leaders.map((l) => l.name)).toEqual(["AI <Infra> & Chips", "Banks", "Nuclear"]);
    expect(leaders[0]!.top).toEqual({ ticker: "NVDA", pct: 3.1 });
    expect(laggards.map((l) => l.name)).toEqual(["Crypto", "Biotech", "Solar"]);
    expect(laggards[0]!.top).toEqual({ ticker: "COIN", pct: -4.2 });
    const few = pickThemes(F.THEMES.themes.slice(0, 3), "premarket");
    expect([few.leaders.length, few.laggards.length]).toEqual([2, 1]);
  });

  it("movers: by size of the move, one row per ticker with its first theme", () => {
    expect(pickMovers(F.THEMES.themes, "fromOpen").slice(0, 3)).toEqual([
      { ticker: "MSTR", pct: 6.75, theme: "Crypto" },
      { ticker: "MRNA", pct: -3.9, theme: "Biotech" },
      { ticker: "OKLO", pct: 3.3, theme: "Nuclear" },
    ]);
    expect(pickMovers(F.THEMES.themes, "afterHours").map((m) => m.ticker)).toEqual(["OKLO", "COIN", "NVDA"]);
  });

  it("earnings: today, before the open / after the close, biggest market cap first; untimed and other days left out", () => {
    const e = pickEarnings(F.EARNINGS, F.DAY);
    expect(e.bmo.map((x) => x.ticker)).toEqual(["BIG", "MID", "SMALL", "NOCAP"]);
    expect(e.amc.map((x) => x.ticker)).toEqual(["LATE"]);
  });
});

describe("rendered posts", () => {
  it("premarket: every section, caps, escaping, footer link", async () => {
    const text = renderPost(await gatherPost("premarket", F.DAY, F.fixtureDeps()), { caps: CAPS, siteUrl: SITE })!;
    expect(text.split("\n")[0]).toMatch(/^☀️ <b>Премаркет<\/b> · вт, 20 окт/);
    expect(text).toContain("🚀 <b>Гэпы вверх</b>\n$ABCD +42.50% · RVOL 12.3 · флоат 8.4M\n$XYZ +18.12% · RVOL 4.0");
    expect(text).not.toContain("$VWX"); // 6th gapper over the cap of 5
    expect(text).toContain("🔻 <b>Гэпы вниз</b>\n$DOWN2 -12.50% · RVOL 6.0 · флоат 40M\n$DOWN1 -7.25%");
    expect(text).toContain("🟢 AI &lt;Infra&gt; &amp; Chips <b>+2.30%</b> · $NVDA +3.10%");
    expect(text).toContain("🔴 Crypto <b>-3.50%</b> · $COIN -4.20%");
    expect(text).toContain("<i>До открытия:</i> $BIG (3.1T), $MID (245B) и ещё 2");
    expect(text).toContain("<i>После закрытия:</i> $LATE (50B)");
    expect(text).not.toContain("$TBD");
    expect(text).toContain("🗓 <b>Макро сегодня</b>\n• Публикация CPI — 8:30 ET — индекс потребительских цен");
    expect(text.endsWith(`🔗 <a href="${SITE}/themes">Темы рынка на сайте</a>`)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(TG_MAX_CHARS);
  });

  it("empty sections are dropped; no footer without a site URL", async () => {
    const deps = F.fixtureDeps({ screener: async (p) => ({ asOf: null, preset: p, rows: [] }), macro: async () => [], earnings: async () => [] });
    const text = renderPost(await gatherPost("premarket", F.DAY, deps), { caps: CAPS, siteUrl: null })!;
    expect(text).not.toMatch(/Гэпы|Отчёты|Макро|🔗/);
    expect(text).toContain("📈 <b>Темы: лидеры</b>");
  });

  it("nothing to say ⇒ null (a failing source only drops its own section)", async () => {
    expect(renderPost(await gatherPost("open", F.DAY, F.EMPTY_DEPS), { caps: CAPS })).toBeNull();
    const broken = { ...F.EMPTY_DEPS, themes: async () => { throw new Error("provider down"); }, macro: async () => F.MACRO };
    expect(renderPost(await gatherPost("premarket", F.DAY, broken), { caps: CAPS })).toContain("Макро сегодня");
  });

  it("open and close posts", async () => {
    const open = renderPost(await gatherPost("open", F.DAY, F.fixtureDeps()), { caps: CAPS })!;
    expect(open.split("\n")[0]).toMatch(/^🔔 <b>От открытия<\/b>/);
    expect(open).toContain("📉 <b>Темы: отстающие</b>\n🔴 Biotech <b>-3.90%</b> · $MRNA -3.90%\n🟢 AI &lt;Infra&gt; &amp; Chips <b>+0.35%</b>"); // dot = sign
    expect(open).toContain("⚡ <b>Сильнее всех от открытия</b>\n$MSTR <b>+6.75%</b> · Crypto\n$MRNA <b>-3.90%</b> · Biotech\n$OKLO <b>+3.30%</b> · Nuclear");
    const close = renderPost(await gatherPost("close", F.DAY, F.fixtureDeps()), { caps: CAPS })!;
    expect(close.split("\n")[0]).toMatch(/^🌆 <b>Итоги дня<\/b>/);
    expect(close).toContain("🌙 <b>Афтермаркет</b>\n$OKLO <b>+7.77%</b> · Nuclear");
  });

  it("a text over 4096 chars loses lines from the end, never the header", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `$T${i} +1.00% · padding padding padding`);
    const text = fitMessage("HEADER", [{ head: "A", lines: lines.slice(0, 10) }, { head: "B", lines }], "FOOT");
    expect(text.length).toBeLessThanOrEqual(TG_MAX_CHARS);
    expect(text.startsWith("HEADER\n\nA\n$T0")).toBe(true);
    expect(text.endsWith("FOOT")).toBe(true);
  });
});

describe("gap lists skip funds", () => {
  it("leveraged / country ETFs and cap-less Financial rows are funds; real companies are not", () => {
    expect(isFundRow({ company: "Direxion Daily MSCI South Korea Bull 3X ETF", sector: "Financial", marketCap: null })).toBe(true);
    expect(isFundRow({ company: "Leverage Shares 2X Long CRWV Daily", sector: "Financial", marketCap: null })).toBe(true);
    expect(isFundRow({ company: "Some Trust", sector: "Financial", marketCap: null })).toBe(true);
    expect(isFundRow({ company: "Exascale Labs Holdings Inc", sector: "Technology", marketCap: 174_990_000 })).toBe(false);
    expect(isFundRow({ company: "Fundamental Global Inc", sector: "Financial", marketCap: 50_000_000 })).toBe(false);
  });
});
