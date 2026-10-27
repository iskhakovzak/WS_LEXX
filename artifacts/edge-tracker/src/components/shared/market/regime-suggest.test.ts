import { describe, expect, it } from "vitest";
import { buildFrame, type Bar, type MarketData } from "./engine";
import { suggestRegime, suggestionIndex } from "./regime-suggest";

function dates(n: number, start = "2025-01-02"): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function series(ds: string[], f: (i: number) => number, wiggle = 0.004): Bar[] {
  return ds.map((d, i) => {
    const c = f(i);
    const o = i ? f(i - 1) * (1 + (i % 3 === 0 ? 0.002 : 0)) : c;
    return { d, o, h: Math.max(o, c) * (1 + wiggle), l: Math.min(o, c) * (1 - wiggle), c };
  });
}

const N = 300;
const ds = dates(N);
/** VIX that sat at 18–24 and ends low (14) — calm today against its own year. */
const calmVix = (i: number) => (i < N - 5 ? 18 + (i % 7) : 14);

function frame(over: Partial<Record<keyof MarketData, (i: number) => number>>) {
  const f = {
    spy: (i: number) => 500 * (1 + 0.0001 * Math.sin(i)),
    rsp: (i: number) => 170 * (1 + 0.0001 * Math.sin(i)),
    iwm: (i: number) => 220 * (1 + 0.0001 * Math.sin(i)),
    qqq: (i: number) => 450,
    vix: calmVix,
    vix3m: () => 22,
    tnx: () => 4.2,
    dxy: () => 103,
    ...over,
  };
  const data: MarketData = Object.fromEntries(Object.entries(f).map(([k, fn]) => [k, series(ds, fn, k === "spy" || k === "rsp" || k === "iwm" || k === "qqq" ? 0.004 : 0)]));
  return buildFrame(data);
}

const suggest = (rows: ReturnType<typeof buildFrame>) => suggestRegime(rows, rows.length - 1);

describe("desk regime suggestion", () => {
  it("a quiet tape with no trend → range", () => {
    const s = suggest(frame({}))!;
    expect(s.regime).toBe("range");
    expect(s.reasons.map((r) => r.code)).toContain("noTrend");
    expect(s.asOf).toBe(ds[N - 1]);
  });

  it("a healthy up trend → theme_bull; stretched and led by small caps on a calm VIX → euphoria", () => {
    const bull = suggest(frame({ spy: (i) => 500 * (1 + 0.001 * i), rsp: (i) => 170 * (1 + 0.0012 * i), iwm: (i) => 220 * (1 + 0.0013 * i) }))!;
    expect(bull.regime).toBe("theme_bull");
    const eu = suggest(frame({ spy: (i) => 500 * 1.004 ** i, rsp: (i) => 170 * 1.004 ** i, iwm: (i) => 220 * 1.006 ** i }))!;
    expect(eu.regime).toBe("euphoria");
    expect(eu.reasons.map((r) => r.code)).toEqual(["stretched", "smallCaps"]);
  });

  it("VIX above 30 after a sell-off → panic, with the reasons", () => {
    const s = suggest(frame({
      spy: (i) => (i < N - 10 ? 500 * (1 + 0.0005 * i) : 500 * (1 + 0.0005 * (N - 10)) * (1 - 0.015 * (i - (N - 10)))),
      vix: (i) => (i < N - 10 ? 15 + (i % 5) : 35),
    }))!;
    expect(s.regime).toBe("panic");
    expect(s.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["vixPanic", "selloff"]));
    expect(s.reasons.find((r) => r.code === "vixPanic")!.value).toBe(35);
  });

  it("a rates shock on a trendless tape → macro; a narrow market → idiosyncratic", () => {
    const macro = suggest(frame({ tnx: (i) => (i < N - 1 ? 4.2 : 4.45) }))!;
    expect(macro.regime).toBe("macro");
    expect(macro.reasons[0]).toEqual({ code: "rates", value: 25 });
    const idio = suggest(frame({ rsp: (i) => 170 * (1 - 0.001 * i) }))!;
    expect(idio.regime).toBe("idiosyncratic");
    expect(idio.reasons.map((r) => r.code)).toContain("narrow");
  });

  it("needs the engine's history and reads the last final close", () => {
    const rows = frame({});
    expect(suggestRegime(rows.slice(0, 20), 19)).toBeNull();
    expect(suggestionIndex(rows, true)).toBe(N - 2);
    expect(suggestionIndex(rows, false)).toBe(N - 1);
  });
});
