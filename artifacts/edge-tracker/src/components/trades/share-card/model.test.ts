import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import {
  DEFAULT_PREFS, canShareTrade, cardPrice, cardDate, cardFileName, cardHold, cardSeries, cardStats, cardTexts, chartPoints, ellipsize,
  fallbackSeries, fitFontSize, initials, parsePrefs, pctOfPosition, pickMode, pillBox, resultModes, shareTradeOf, sharePolicy,
  toneOf, type ShareTrade,
} from "./model";
import { OLYMP_ART, artOf, stepArt } from "./themes";

const trade = (o: Partial<Trade> = {}): Trade => ({
  id: 7, ticker: "nvda", date: "2026-10-14T00:00:00.000Z", side: "Long", entry: 120.5, exit: 122.0, qty: 400, pnl: 600, fees: 4,
  result: "win", rMultiple: 1.21, trader: "Zakir I.", createdAt: "2026-10-14T20:00:00Z", setup: "ORB", ...o,
}) as Trade;

const st = (o: Partial<ShareTrade> = {}): ShareTrade => ({
  id: 1, ticker: "NVDA", side: "long", day: "2026-10-14", entry: 100, exit: 101.5, qty: 200, net: 296, r: 1.21, holdSec: 750, setup: "ORB", ...o,
});

describe("shareTradeOf", () => {
  it("keeps only what a card may show: net P&L (fees folded in), R, size, hold, setup", () => {
    const s = shareTradeOf(trade());
    expect(s).toMatchObject({ ticker: "NVDA", side: "long", day: "2026-10-14", entry: 120.5, exit: 122, qty: 400, net: 596, r: 1.21, setup: "ORB" });
    expect(Object.keys(s)).not.toContain("fees");
    expect(Object.keys(s)).not.toContain("brokerAccount");
    expect(shareTradeOf(trade({ side: "SHORT" })).side).toBe("short");
    expect(shareTradeOf(trade({ setup: null, strategy: "MOC" })).setup).toBe("MOC");
  });
});

describe("who may share", () => {
  const perms = (enabled: boolean, money: "usd" | "r_only" = "usd") => ({ shareCards: { enabled, money } });
  it("own closed trades only, while the desk switch is on", () => {
    expect(canShareTrade(trade(), "Zakir I.", perms(true))).toBe(true);
    expect(canShareTrade(trade(), "Someone Else", perms(true))).toBe(false);
    expect(canShareTrade(trade(), null, perms(true))).toBe(false);
    expect(canShareTrade(trade(), "Zakir I.", perms(false))).toBe(false);
    expect(canShareTrade(trade({ result: "open" }), "Zakir I.", perms(true))).toBe(false);
    expect(canShareTrade({ ...trade(), redacted: true } as Trade, "Zakir I.", perms(true))).toBe(false);
  });
  it("an older API without the field: on, $ allowed", () => {
    expect(sharePolicy({})).toEqual({ enabled: true, money: "usd" });
    expect(sharePolicy({ shareCards: { enabled: true, money: "r_only" } })).toEqual({ enabled: true, money: "r_only" });
  });
});

describe("R / % / $ result", () => {
  it("% of the position = net / (entry × size)", () => {
    expect(pctOfPosition({ net: 296, entry: 100, qty: 200 })).toBeCloseTo(1.48, 6);
    expect(pctOfPosition({ net: -50, entry: 25, qty: -100 })).toBeCloseTo(-2, 6); // size sign does not matter
    expect(pctOfPosition({ net: 10, entry: null, qty: 100 })).toBeNull();
    expect(pctOfPosition({ net: 10, entry: 0, qty: 100 })).toBeNull();
  });
  it("modes in switch order; missing R / prices drop their mode", () => {
    expect(resultModes(st(), "usd")).toEqual(["usd", "r", "pct"]);
    expect(resultModes(st({ r: null }), "usd")).toEqual(["usd", "pct"]);
    expect(resultModes(st({ entry: null }), "usd")).toEqual(["usd", "r"]);
  });
  it("saved mode wins when available, else the first one", () => {
    expect(pickMode("pct", ["usd", "r", "pct"])).toBe("pct");
    expect(pickMode("usd", ["r", "pct"])).toBe("r");
    expect(pickMode("r", [])).toBeNull();
  });
  it("tone follows net, else R", () => {
    expect(toneOf({ net: 10, r: -1 })).toBe("profit");
    expect(toneOf({ net: -432, r: null })).toBe("loss");
    expect(toneOf({ net: null, r: -0.5 })).toBe("loss");
    expect(toneOf({ net: 0, r: null })).toBeNull();
  });
});

describe("money-hidden rule (shareCards.money = r_only)", () => {
  const all = (t: ReturnType<typeof cardTexts>) => [t.ticker, t.subtitle, t.resultLabel, t.big, t.name ?? "", t.brand, ...t.stats.flatMap((c) => [c.label, c.value])].join(" | ");

  it("never offers $ and never prints a $ amount, whatever the saved mode", () => {
    expect(resultModes(st(), "r_only")).toEqual(["r", "pct"]);
    for (const mode of ["usd", "r", "pct"] as const) {
      for (const s of [st(), st({ r: null }), st({ entry: null }), st({ r: null, entry: null })]) {
        const texts = cardTexts(s, { mode, money: "r_only", showPrices: true, name: "Zakir I." });
        expect(all(texts)).not.toContain("$");
      }
    }
  });
  it("a stale $ choice falls back to R, then %", () => {
    expect(cardTexts(st(), { mode: "usd", money: "r_only", showPrices: false, name: null }).big).toBe("+1.21R");
    expect(cardTexts(st({ r: null }), { mode: "usd", money: "r_only", showPrices: false, name: null }).big).toBe("+1.48%");
  });
  it("with $ allowed the big number is the net in $", () => {
    expect(cardTexts(st(), { mode: "usd", money: "usd", showPrices: true, name: null }).big).toBe("+$296.00");
    expect(cardTexts(st({ net: -432 }), { mode: "usd", money: "usd", showPrices: true, name: null }).big).toBe("−$432.00");
  });
});

describe("card texts", () => {
  it("header: side and the date in English", () => {
    expect(cardTexts(st(), { mode: "usd", money: "usd", showPrices: true, name: null }).subtitle).toBe("LONG · OCT 14, 2026");
    expect(cardTexts(st({ side: "short", day: "2026-01-02" }), { mode: "usd", money: "usd", showPrices: true, name: null }).subtitle).toBe("SHORT · JAN 2, 2026");
    expect(cardDate("bad")).toBe("bad");
  });
  it("stats: prices only when shown, the other return figure, hold, setup; six at most", () => {
    const withPrices = cardStats(st(), { mode: "usd", money: "usd", showPrices: true });
    expect(withPrices.map((c) => c.label)).toEqual(["Entry", "Exit", "Size", "Return", "Hold", "Setup"]);
    expect(withPrices.find((c) => c.label === "Return")?.value).toBe("+1.21R");
    expect(withPrices.find((c) => c.label === "Size")?.value).toBe("200 sh");
    const noPrices = cardStats(st(), { mode: "r", money: "usd", showPrices: false });
    expect(noPrices.map((c) => c.label)).toEqual(["Size", "Return", "Hold", "Setup"]);
    expect(noPrices.find((c) => c.label === "Return")?.value).toBe("+1.48%");
    // Big % without R: the return cell falls back to $ only when $ is allowed.
    expect(cardStats(st({ r: null }), { mode: "pct", money: "usd", showPrices: false }).find((c) => c.label === "Return")?.value).toBe("+$296.00");
    expect(cardStats(st({ r: null }), { mode: "pct", money: "r_only", showPrices: false }).find((c) => c.label === "Return")).toBeUndefined();
  });
  it("prices: grouped from 1,000", () => {
    expect(cardPrice(30556.8)).toBe("30,556.80");
    expect(cardPrice(120.55)).toBe("120.55");
  });
  it("hold time in short English units", () => {
    expect(cardHold(45)).toBe("45s");
    expect(cardHold(450)).toBe("7m 30s");
    expect(cardHold(750)).toBe("12m");
    expect(cardHold(1800)).toBe("30m");
    expect(cardHold(4800)).toBe("1h 20m");
    expect(cardHold(2 * 86400 + 4 * 3600)).toBe("2d 4h");
    expect(cardHold(null)).toBeNull();
  });
  it("name, initials, file name", () => {
    expect(cardTexts(st(), { mode: "r", money: "usd", showPrices: true, name: "  " }).name).toBeNull();
    expect(initials("Zakir Ishakov")).toBe("ZI");
    expect(initials("Олег")).toBe("О");
    expect(cardFileName({ ticker: "BRK.B", day: "2026-10-14" })).toBe("WS_Desk-BRK.B-2026-10-14.png");
    expect(cardFileName({ ticker: "../x", day: "2026-10-14" })).toBe("WS_Desk-..x-2026-10-14.png");
  });
});

describe("layout helpers", () => {
  const measure = (t: string, size: number) => t.length * size * 0.6; // fake: monospace-ish
  it("fitFontSize: the largest size that fits, the minimum when nothing does", () => {
    expect(fitFontSize("+$602.00", 936, 210, 90, measure)).toBe(194);
    expect(fitFontSize("+$12,345.67", 936, 210, 90, measure)).toBe(140);
    expect(fitFontSize("+$1,234,567,890.12", 936, 210, 90, measure)).toBe(90);
    for (const big of ["+$602.00", "+$12,345.67", "−$432.00", "+12.34R"]) {
      const s = fitFontSize(big, 936, 210, 90, measure);
      expect(measure(big, s) <= 936 || s === 90).toBe(true);
    }
  });
  it("ellipsize cuts with «…» until it fits", () => {
    const m = (t: string) => t.length * 10;
    expect(ellipsize("Opening range breakout", 100, m)).toBe("Opening r…");
    expect(ellipsize("Opening range", 90, m)).toBe("Opening…");
    expect(ellipsize("ORB", 100, m)).toBe("ORB");
  });
  it("pillBox: above the point, below near the top edge, clamped sideways, never on the other pill", () => {
    const bounds = { x: 0, y: 0, w: 1000, h: 500 };
    expect(pillBox({ x: 500, y: 300 }, 100, 40, bounds)).toEqual({ x: 450, y: 242, w: 100, h: 40 });
    expect(pillBox({ x: 500, y: 30 }, 100, 40, bounds).y).toBe(48);
    expect(pillBox({ x: 5, y: 300 }, 100, 40, bounds).x).toBe(0);
    expect(pillBox({ x: 995, y: 300 }, 100, 40, bounds).x).toBe(900);
    const first = pillBox({ x: 500, y: 300 }, 100, 40, bounds);
    const second = pillBox({ x: 520, y: 300 }, 100, 40, bounds, first);
    expect(second.y).toBeGreaterThan(300);
  });
});

describe("price line", () => {
  const bars = Array.from({ length: 400 }, (_, i) => ({ t: 1_000_000 + i * 60, c: 100 + Math.sin(i / 20) }));
  it("cuts the bars around the trade and maps the fills onto the sampled points", () => {
    const s = cardSeries(bars, 1_000_000 + 200 * 60 + 5, 1_000_000 + 260 * 60, 100.5, 101, 120)!;
    expect(s.synthetic).toBe(false);
    expect(s.closes.length).toBeLessThanOrEqual(120);
    expect(s.entryIdx).not.toBeNull();
    expect(s.exitIdx!).toBeGreaterThan(s.entryIdx!);
    expect(s.entryIdx!).toBeGreaterThan(0); // context before the entry
    expect(s.exitIdx!).toBeLessThan(s.closes.length - 1); // and after the exit
    expect(s.min).toBeLessThanOrEqual(100.5);
    expect(s.max).toBeGreaterThanOrEqual(101);
  });
  it("no bars or no entry time → null; the fallback is a clean entry → exit line", () => {
    expect(cardSeries([], 1, 2, 1, 2)).toBeNull();
    expect(cardSeries(bars, null, null, 1, 2)).toBeNull();
    expect(cardSeries(bars, 10, null, 1, 2)).toBeNull(); // before every bar
    const f = fallbackSeries(30556.8, 30617)!;
    expect(f.synthetic).toBe(true);
    expect(f.closes[f.entryIdx!]).toBe(30556.8);
    expect(f.closes[f.exitIdx!]).toBe(30617);
    expect(fallbackSeries(null, 2)).toBeNull();
  });
  it("chartPoints: inside the rect; a flat series sits in the middle", () => {
    const rect = { x: 80, y: 330, w: 920, h: 300 };
    const p = chartPoints(fallbackSeries(10, 12)!, rect);
    for (const q of p.line) {
      expect(q.x).toBeGreaterThanOrEqual(80);
      expect(q.x).toBeLessThanOrEqual(1000);
      expect(q.y).toBeGreaterThanOrEqual(330);
      expect(q.y).toBeLessThanOrEqual(630);
    }
    expect(p.entry!.y).toBe(630);
    expect(p.exit!.y).toBe(330);
    const flat = chartPoints(fallbackSeries(10, 10)!, rect);
    expect(flat.entry!.y).toBe(480);
  });
});

describe("remembered choices", () => {
  it("keeps valid fields, drops junk, never restores «own photo»", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ theme: "night", art: "zeus-ingres", mode: "pct", showName: false, showPrices: false }))
      .toEqual({ theme: "night", art: "zeus-ingres", mode: "pct", showName: false, showPrices: false });
    expect(parsePrefs({ theme: "photo", mode: "dollars", showName: "yes" })).toEqual(DEFAULT_PREFS);
  });
  it("artworks: unknown id → the first, prev / next wrap around", () => {
    expect(artOf("nope").id).toBe(OLYMP_ART[0]!.id);
    expect(stepArt(OLYMP_ART[0]!.id, -1).id).toBe(OLYMP_ART[OLYMP_ART.length - 1]!.id);
    expect(stepArt(OLYMP_ART[OLYMP_ART.length - 1]!.id, 1).id).toBe(OLYMP_ART[0]!.id);
    expect(OLYMP_ART.length).toBeGreaterThanOrEqual(6);
  });
});
