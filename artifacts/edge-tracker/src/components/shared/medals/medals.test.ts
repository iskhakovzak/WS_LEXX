// «Ступени как награды»: stage mapping, the once-per-promotion rule, and the coin SVG at small / large sizes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setLang, i18nReady } from "@/i18n";
import ruCommon from "@/i18n/locales/ru/common";
import { AwardCoin, StageMedal, medalStageOf } from ".";
import { REVEAL_MAX_AGE_DAYS, REVEAL_STORAGE_KEY, isPromotion, latestPromotion, markSeen, readSeen, shouldReveal } from "./reveal-model";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const NOW = Date.parse("2026-10-24T15:00:00Z");
const row = (id: number, fromStage: string | null, toStage: string, daysAgo = 1) =>
  ({ id, fromStage, toStage, createdAt: new Date(NOW - daysAgo * 86_400_000).toISOString() });

describe("medalStageOf", () => {
  it("maps keys, tier keys and the stored RU ladder names", () => {
    expect(medalStageOf("junior")).toBe("junior");
    expect(medalStageOf("trainee")).toBe("junior");
    expect(medalStageOf("lead")).toBe("senior");
    expect(medalStageOf(ruCommon.tiers.trader)).toBe("trader");
    expect(medalStageOf(` ${ruCommon.tiers.senior.toUpperCase()} `)).toBe("senior");
    expect(medalStageOf("Custom template")).toBeNull();
    expect(medalStageOf(null)).toBeNull();
  });
});

describe("promotion reveal: once per promotion", () => {
  it("only upward moves are promotions", () => {
    expect(isPromotion(row(1, "junior", "trader"))).toBe(true);
    expect(isPromotion(row(2, "trader", "senior"))).toBe(true);
    expect(isPromotion(row(3, null, "junior"))).toBe(false); // first assignment
    expect(isPromotion(row(4, "trainee", "junior"))).toBe(false); // legacy stage reads as junior
    expect(isPromotion(row(5, "senior", "trader"))).toBe(false); // demotion
  });

  it("picks the newest promotion", () => {
    expect(latestPromotion([row(3, "junior", "trader", 40), row(9, "trader", "senior"), row(12, "senior", "trader")])?.id).toBe(9);
    expect(latestPromotion([row(1, null, "junior")])).toBeNull();
  });

  it("reveals an unseen recent promotion and never the same one twice", () => {
    const p = row(7, "junior", "trader");
    expect(shouldReveal(p, null, NOW)).toBe(true);
    expect(shouldReveal(p, 7, NOW)).toBe(false);
    expect(shouldReveal(p, 6, NOW)).toBe(true);
    expect(shouldReveal(row(8, "junior", "trader", REVEAL_MAX_AGE_DAYS + 1), null, NOW)).toBe(false);
    expect(shouldReveal(null, null, NOW)).toBe(false);
  });

  it("remembers the seen id per user (and survives broken storage)", () => {
    const store = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    try {
      expect(readSeen("anna")).toBeNull();
      markSeen("anna", 5);
      markSeen("anna", 3); // never goes back
      markSeen("bob", 9);
      expect(readSeen("anna")).toBe(5);
      expect(readSeen("bob")).toBe(9);
      store.set(REVEAL_STORAGE_KEY, "{broken");
      expect(readSeen("anna")).toBeNull();
    } finally {
      g.localStorage = prev;
    }
  });
});

describe("coins", () => {
  it("a large stage medal carries the wreath and the rim legend in the UI language", async () => {
    const html = renderToStaticMarkup(createElement(StageMedal, { stage: "senior", size: 200 }));
    expect(html).toContain('role="img"');
    expect(html).toContain(ruCommon.tiers.senior.toUpperCase());
    expect(html).toContain("<textPath");
    await setLang("en", { source: "init" });
    await i18nReady();
    const en = renderToStaticMarkup(createElement(StageMedal, { stage: "trader", size: 120 }));
    expect(en).toContain("TRADER");
    expect(en).toContain("WS_LEXX ACADEMY");
  });

  it("a 24 px medal drops the legend; a decorative one is hidden from screen readers", () => {
    const html = renderToStaticMarkup(createElement(StageMedal, { stage: "junior", size: 24, decorative: true }));
    expect(html).not.toContain("<textPath");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="24"');
  });

  it("ids are unique per coin (gradients never bleed between coins on one page)", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(AwardCoin, { emblem: "shield", metal: "gold" }), createElement(AwardCoin, { emblem: "shield", metal: "gold" })));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an unearned token uses the theme tokens, no metal colours", () => {
    const html = renderToStaticMarkup(createElement(AwardCoin, { emblem: "lamp", metal: null, ring: 0.5 }));
    expect(html).toContain("hsl(var(--muted))");
    expect(html).toContain("hsl(var(--primary))");
    expect(html).not.toMatch(/#(?:e6a874|d6a432|b3bcc8)/i);
  });
});
