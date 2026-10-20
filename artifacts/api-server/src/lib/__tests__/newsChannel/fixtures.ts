/**
 * Fixture data for the WS_NEWS channel tests (lib/newsChannel): Tuesday 2026-10-20, New York. No DB, no network —
 * these feed gatherPost through its injectable readers.
 */
import type { EarningsRow, ScreenerPreset, ScreenerResponse, ScreenerRow } from "../../finviz/types";
import type { MemberQuote, ThemeOut, ThemesResponse } from "../../themes/logic";
import type { MacroItem, NewsDataDeps } from "../../newsChannel/data";

export const DAY = "2026-10-20";
/** hh:mm New York on DAY (EDT = UTC−4). */
export const ny = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 20, hh + 4, mm));

const row = (ticker: string, gapPct: number | null, relVolume: number | null = null, float: number | null = null): ScreenerRow => ({
  ticker, company: null, sector: null, price: 10, changePct: gapPct, gapPct, relVolume, volume: null, avgVolume: null, float,
  shortFloatPct: null, atr: null, marketCap: null, earningsDate: null, earningsTiming: null,
});

export const GAPPERS: ScreenerResponse = {
  asOf: ny(8, 25).toISOString(),
  preset: "gappers",
  rows: [
    row("ABCD", 42.5, 12.3, 8_400_000),
    row("XYZ", 18.123, 4.04, null),
    row("MNO", 9.9, null, 120_000_000),
    row("PQR", 7.1, 2.5, 30_000_000),
    row("STU", 6, 1.9, 5_000_000),
    row("VWX", 5.5, 1.2, 9_000_000),
    row("AAA", 4.4, 1.1, 1_000_000),
    row("BBB", 4.1, 1.0, 2_000_000),
    row("DOWN1", -7.25, 3.3, 15_000_000),
  ],
};

export const RELVOL: ScreenerResponse = {
  asOf: ny(8, 26).toISOString(),
  preset: "relvol",
  rows: [row("DOWN2", -12.5, 6, 40_000_000), row("DOWN1", -7.25, 3.3, 15_000_000), row("FLAT", 0, 2, null)],
};

/** Yesterday's run: never part of today's brief. */
export const STALE_GAPPERS: ScreenerResponse = { ...GAPPERS, asOf: new Date(Date.UTC(2026, 9, 19, 20, 0)).toISOString() };

const q = (ticker: string, v: Partial<MemberQuote>): MemberQuote => ({ ticker, price: 10, today: null, fromOpen: null, premarket: null, afterHours: null, ...v });

const theme = (id: number, name: string, members: MemberQuote[]): ThemeOut => {
  const mean = (k: "today" | "fromOpen" | "premarket" | "afterHours") => {
    const xs = members.map((m) => m[k]).filter((x): x is number => x != null);
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
  };
  return { id, name, today: mean("today"), fromOpen: mean("fromOpen"), premarket: mean("premarket"), afterHours: mean("afterHours"), members, missing: [] };
};

export const THEMES: ThemesResponse = {
  asOf: ny(8, 29).toISOString(),
  session: "pre",
  source: "yahoo",
  stale: false,
  themes: [
    theme(1, "AI <Infra> & Chips", [q("NVDA", { premarket: 3.1, fromOpen: 1.2, today: 2.5, afterHours: 0.4 }), q("AMD", { premarket: 1.5, fromOpen: -0.5, today: 1.0 })]),
    theme(2, "Crypto", [q("COIN", { premarket: -4.2, fromOpen: -2.0, today: -5.5, afterHours: -1.25 }), q("MSTR", { premarket: -2.8, fromOpen: 6.75, today: -3.0 })]),
    theme(3, "Nuclear", [q("OKLO", { premarket: 2.2, fromOpen: 3.3, today: 4.4, afterHours: 7.77 }), q("SMR", { premarket: 0.6, fromOpen: 0.1, today: 1.1 })]),
    theme(4, "Banks", [q("JPM", { premarket: 0.2, fromOpen: 0.1, today: 0.3 }), q("NVDA", { premarket: 3.1, fromOpen: 1.2, today: 2.5, afterHours: 0.4 })]),
    theme(5, "Biotech", [q("MRNA", { premarket: -1.1, fromOpen: -3.9, today: -2.2 })]),
    theme(6, "Solar", [q("FSLR", { premarket: -0.4, fromOpen: 0.5, today: -0.9 })]),
    theme(7, "Quiet", [q("ZZZ", {})]),
  ],
};

export const EARNINGS: EarningsRow[] = [
  { ticker: "SMALL", date: DAY, timing: "bmo", company: null, marketCap: 900_000_000 },
  { ticker: "BIG", date: DAY, timing: "bmo", company: null, marketCap: 3_100_000_000_000 },
  { ticker: "MID", date: DAY, timing: "bmo", company: null, marketCap: 245_000_000_000 },
  { ticker: "NOCAP", date: DAY, timing: "bmo", company: null, marketCap: null },
  { ticker: "LATE", date: DAY, timing: "amc", company: null, marketCap: 50_000_000_000 },
  { ticker: "TBD", date: DAY, timing: null, company: null, marketCap: 1e12 },
  { ticker: "TMRW", date: "2026-10-21", timing: "bmo", company: null, marketCap: 1e12 },
];

export const MACRO: MacroItem[] = [{ name: "Публикация CPI", description: "8:30 ET — индекс потребительских цен" }];

export function fixtureDeps(over: Partial<NewsDataDeps> = {}): NewsDataDeps {
  return {
    screener: async (p: ScreenerPreset) => (p === "gappers" ? GAPPERS : p === "relvol" ? RELVOL : { asOf: null, preset: p, rows: [] }),
    earnings: async () => EARNINGS,
    themes: async () => THEMES,
    macro: async () => MACRO,
    ...over,
  };
}

export const EMPTY_DEPS: NewsDataDeps = {
  screener: async (p) => ({ asOf: null, preset: p, rows: [] }),
  earnings: async () => [],
  themes: async () => ({ asOf: null, session: "closed", source: null, stale: false, themes: [] }),
  macro: async () => [],
};
