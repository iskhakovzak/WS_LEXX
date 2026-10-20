import { describe, expect, it } from "vitest";
import { CARD_PAGE, cardPage, cardSignal, nextPageCount } from "../card-model";
import type { Row } from "../rows";

describe("analyst feed phone cards (2.11)", () => {
  it("pages of CARD_PAGE with what is left", () => {
    const rows = Array.from({ length: 95 }, (_, i) => i);
    expect(cardPage(rows, CARD_PAGE)).toMatchObject({ rest: 55 });
    expect(cardPage(rows, CARD_PAGE).shown).toHaveLength(40);
    expect(nextPageCount(55)).toBe(40);
    expect(nextPageCount(15)).toBe(15);
    expect(cardPage(rows, 200)).toMatchObject({ rest: 0 });
    expect(cardPage([], 40)).toEqual({ shown: [], rest: 0 });
  });
  it("gap: the premarket move first, else the gap; RVOL highlighted from 2× like the table", () => {
    const q = (over: Record<string, unknown>) => ({ quote: { price: 10, relativeVolume: 2.4, gapPct: 1.5, preMarketChange: null, ...over } as unknown as Row["quote"] });
    expect(cardSignal(q({}))).toEqual({ gap: 1.5, rvol: 2.4, rvolStrong: true });
    expect(cardSignal(q({ preMarketChange: -4.2, relativeVolume: 1.1 }))).toEqual({ gap: -4.2, rvol: 1.1, rvolStrong: false });
    expect(cardSignal({ quote: null })).toEqual({ gap: null, rvol: null, rvolStrong: false });
    expect(cardSignal(q({ relativeVolume: Number.NaN })).rvol).toBeNull();
  });
});
