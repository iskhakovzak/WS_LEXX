import { describe, it, expect } from "vitest";
import { BASE_MULTS, baseQty, breakEvenStop, entryBracket, fakeClock, fillLabels, focusRange, halfQty, hhmm, keyAction, maxQtyFor, multOf, nextPace, nextSpeed, paceTick, parsePrice, positionAfter, presetQty, riskQty, roundPrice, stepErrorOf, stopFits, swingIndex } from "./model";

describe("sim model — orders and bracket", () => {
  it("position after an order mirrors the server", () => {
    expect(positionAfter(0, "buy", 100)).toBe(100);
    expect(positionAfter(100, "sell", 250)).toBe(-150);
    expect(positionAfter(-40, "flat", 0)).toBe(0);
  });

  it("sends a 1R stop (and 2R target) only when a position opens or flips", () => {
    const o = { autoStop: true, autoTarget: true };
    expect(entryBracket(0, 100, 50, 0.5, o)).toEqual({ stop: 49.5, target: 51 });
    expect(entryBracket(100, -100, 50, 0.5, o)).toEqual({ stop: 50.5, target: 49 });
    expect(entryBracket(100, 200, 50, 0.5, o)).toBeUndefined(); // add: keep the open bracket
    expect(entryBracket(100, 0, 50, 0.5, o)).toBeUndefined();
    expect(entryBracket(0, 100, 50, 0.5, { autoStop: false, autoTarget: false })).toBeUndefined();
    expect(entryBracket(0, 100, 0.8, 0.01234, { autoStop: true, autoTarget: false })).toEqual({ stop: 0.7877, target: null });
  });

  it("sizes, prices and buying power", () => {
    expect(presetQty(30, "half")).toBe(15);
    expect(presetQty(5, "half")).toBe(3);
    expect(presetQty(30, "double")).toBe(60);
    expect(maxQtyFor(100_000, 358.4)).toBe(279);
    expect(roundPrice(12.3456)).toBe(12.35);
    expect(parsePrice("12,5")).toBe(12.5);
    expect(parsePrice(" ")).toBeNull();
    expect(parsePrice("-1")).toBeNull();
  });
});

describe("sim model — keys, speed, clock, errors", () => {
  it("maps physical keys (any layout) and ignores modified ones", () => {
    expect(keyAction({ code: "KeyB", key: "и" })).toEqual({ a: "buy" });
    expect(keyAction({ code: "KeyX", key: "x" })).toEqual({ a: "flat" });
    expect(keyAction({ code: "BracketRight", key: "]" })).toEqual({ a: "faster" });
    expect(keyAction({ code: "KeyS", key: "s", ctrlKey: true })).toBeNull();
    expect(keyAction({ code: "KeyQ", key: "q" })).toBeNull();
  });

  it("maps playback, timeframe, size, skip and no-trade keys", () => {
    expect(keyAction({ code: "Space" })).toEqual({ a: "play" });
    expect(keyAction({ code: "KeyA" })).toEqual({ a: "play" });
    expect(keyAction({ code: "ArrowRight" })).toEqual({ a: "step" });
    expect(keyAction({ code: "ArrowRight", shiftKey: true })).toEqual({ a: "event" });
    expect(keyAction({ code: "Equal", key: "+", shiftKey: true })).toEqual({ a: "faster" });
    expect(keyAction({ code: "NumpadSubtract" })).toEqual({ a: "slower" });
    expect(keyAction({ code: "Digit1" })).toEqual({ a: "tf", n: 0 });
    expect(keyAction({ code: "Numpad4" })).toEqual({ a: "tf", n: 3 });
    expect(keyAction({ code: "Digit3", key: "#", shiftKey: true })).toEqual({ a: "size", n: 2 });
    expect(keyAction({ code: "Digit5" })).toBeNull();
    expect(keyAction({ code: "KeyN", key: "т" })).toEqual({ a: "skip" });
    expect(keyAction({ code: "KeyT", key: "е" })).toEqual({ a: "noTrade" });
    expect(keyAction({ code: "Digit2", altKey: true })).toBeNull();
  });

  it("playback pace: 1× / 5× / 30× and fractional carry between ticks", () => {
    expect(nextPace(30, 1)).toBe(30);
    expect(nextPace(1, 1)).toBe(5);
    expect(nextPace(5, -1)).toBe(1);
    const a = paceTick(30, 50, 0);
    expect(a.bars).toBe(1);
    const b = paceTick(30, 50, a.carry);
    expect(b.bars).toBe(2);
    expect(paceTick(1, 400, 0)).toEqual({ bars: 0, carry: 0.4 });
    expect(paceTick(30, 60_000, 0).bars).toBe(30); // a sleeping tab never floods
  });

  it("size in bases: ½ · 1 · 2 · 3, custom sizes match none", () => {
    expect(BASE_MULTS.map((m) => baseQty(340, m))).toEqual([170, 340, 680, 1020]);
    expect(baseQty(1, 0.5)).toBe(1);
    expect(multOf(680, 340)).toBe(2);
    expect(multOf(500, 340)).toBeNull();
  });

  it("speed steps stay within the list", () => {
    expect(nextSpeed(16, 1)).toBe(16);
    expect(nextSpeed(1, -1)).toBe(1);
    expect(nextSpeed(4, 1)).toBe(8);
  });

  it("reads the fake clock the server sends (New York wall time on fake days)", () => {
    const playDay930 = Date.UTC(2001, 0, 10, 14, 30) / 1000; // 9:30 EST
    expect(fakeClock(playDay930)).toEqual({ day: 0, min: 570 });
    expect(fakeClock(playDay930 - 86400 + 6 * 3600)).toEqual({ day: -1, min: 930 });
    expect(hhmm(570)).toBe("09:30");
    expect(swingIndex(Date.UTC(2001, 0, 1) / 1000 + 5 * 86400)).toBe(5);
  });

  it("turns the server's validation details into a reason", () => {
    expect(stepErrorOf({ body: { details: { reason: "buyingPower", maxQty: 279 } } })).toEqual({ reason: "buyingPower", maxQty: 279 });
    expect(stepErrorOf({ body: { details: { reason: "stop" } } })).toEqual({ reason: "stop" });
    expect(stepErrorOf(new Error("x"))).toEqual({ reason: "generic" });
  });
});

describe("sim model — DAS-like keys, partial exits, risk sizing", () => {
  it("maps H / E / Esc", () => {
    expect(keyAction({ code: "KeyH", key: "р" })).toEqual({ a: "half" });
    expect(keyAction({ code: "KeyE", key: "у" })).toEqual({ a: "breakeven" });
    expect(keyAction({ code: "Escape", key: "Escape" })).toEqual({ a: "cancel" });
  });

  it("half closes half (rounded down), a single share closes it", () => {
    expect(halfQty(100)).toBe(50);
    expect(halfQty(-75)).toBe(37);
    expect(halfQty(1)).toBe(1);
    expect(halfQty(0)).toBe(0);
  });

  it("break-even stop only while in profit", () => {
    expect(breakEvenStop(100, 10.004, 10.5)).toBe(10);
    expect(breakEvenStop(100, 10, 9.9)).toBeNull();
    expect(breakEvenStop(-100, 10, 9.5)).toBe(10);
    expect(breakEvenStop(-100, 10, 10.2)).toBeNull();
    expect(breakEvenStop(0, null, 10)).toBeNull();
  });

  it("risk size = 1R / stop distance, capped by buying power", () => {
    expect(riskQty(50, 20, 19.5, 1000)).toBe(100);
    expect(riskQty(50, 20, 20.25, 1000)).toBe(200);
    expect(riskQty(50, 20, 19.99, 1000)).toBe(1000);
    expect(riskQty(50, 20, null, 1000)).toBeNull();
    expect(riskQty(50, 20, 20, 1000)).toBeNull();
    expect(stopFits("buy", 20, 19.5)).toBe(true);
    expect(stopFits("sell", 20, 19.5)).toBe(false);
    expect(stopFits("sell", 20, 20.5)).toBe(true);
  });
});

describe("fills log labels (MAKSIM-41)", () => {
  it("a buy that reduces or closes a short reads «cover»; a flip, a stop and a long exit keep their reason", () => {
    expect(fillLabels([
      { qty: -40, reason: "sell" }, { qty: 20, reason: "buy" }, { qty: 20, reason: "flat" },
      { qty: 10, reason: "buy" }, { qty: -10, reason: "flat" },
      { qty: -5, reason: "sell" }, { qty: 5, reason: "stop" },
      { qty: -5, reason: "sell" }, { qty: 8, reason: "buy" },
    ])).toEqual(["sell", "cover", "cover", "buy", "flat", "sell", "stop", "sell", "buy"]);
  });
});

describe("«Найди вход» view on a narrow chart (ILYA-07)", () => {
  it("phones: ~40 bars of lead-in + the window + 3, bars ≥ 7 px — a 12-bar window is ≥ 60 px at 375 px", () => {
    const r = focusRange({ from: 161, to: 172 }, 338)!;
    expect(r.to).toBe(175);
    const bars = r.to - r.from;
    expect(bars).toBeLessThanOrEqual(Math.floor((338 - 64) / 7));
    expect(((338 - 64) / bars) * 12).toBeGreaterThanOrEqual(60);
    expect(r.from).toBeLessThan(161);
  });
  it("a short window gets wider bars; wide charts keep the default view", () => {
    const r = focusRange({ from: 50, to: 53 }, 340)!;
    expect(((340 - 64) / (r.to - r.from)) * 4).toBeGreaterThanOrEqual(60);
    expect(focusRange({ from: 161, to: 172 }, 1100)).toBeNull();
    expect(focusRange({ from: 161, to: 172 }, 0)).toBeNull();
  });
});
