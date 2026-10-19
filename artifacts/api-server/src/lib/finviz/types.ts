/**
 * Finviz Elite integration — the API shapes (routes/finviz.ts answers with exactly these; the web mirrors them in
 * components/finviz). Units: money in USD (marketCap is the full number, not millions), sizes in shares, percentages
 * in percent units (4.5 = 4.5 %), ATR in USD, dates "YYYY-MM-DD" (New York), timestamps ISO-8601. A value Finviz left
 * empty is null — never a string.
 */

export const SCREENER_PRESETS = ["gappers", "relvol", "earnings_today"] as const;
export type ScreenerPreset = (typeof SCREENER_PRESETS)[number];

/** Before the open / after the close; null = time not announced. */
export type EarningsTiming = "bmo" | "amc";

/** GET /api/finviz/status */
export type FinvizStatus = {
  /** FINVIZ_AUTH is set and the desk setting finviz.enabled is on. false ⇒ the UI says «Finviz не подключён». */
  enabled: boolean;
  lastScreenAt: string | null;
  lastSnapshotAt: string | null;
  lastEarningsAt: string | null;
};

export type ScreenerRow = {
  ticker: string;
  company: string | null;
  sector: string | null;
  price: number | null;
  changePct: number | null;
  gapPct: number | null;
  relVolume: number | null;
  volume: number | null;
  avgVolume: number | null;
  float: number | null;
  shortFloatPct: number | null;
  atr: number | null;
  marketCap: number | null;
  earningsDate: string | null;
  earningsTiming: EarningsTiming | null;
};

/** GET /api/finviz/screener?preset=… — the latest successful run of the preset (asOf null: never ran). */
export type ScreenerResponse = {
  asOf: string | null;
  preset: ScreenerPreset;
  rows: ScreenerRow[];
};

/** GET /api/finviz/ticker/:symbol — the stored snapshot, or null when the ticker has none yet. */
export type TickerSnapshot = {
  ticker: string;
  company: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  marketCap: number | null;
  float: number | null;
  shortFloatPct: number | null;
  shortRatio: number | null;
  avgVolume: number | null;
  relVolume: number | null;
  atr: number | null;
  beta: number | null;
  earningsDate: string | null;
  earningsTiming: EarningsTiming | null;
  asOf: string;
};

/** GET /api/finviz/earnings?from&to and GET /api/finviz/earnings/today?tickers= (array of these). */
export type EarningsRow = {
  ticker: string;
  date: string;
  timing: EarningsTiming | null;
  company: string | null;
  marketCap: number | null;
};

/** POST /api/finviz/refresh body / answer (staff). */
export const REFRESH_KINDS = ["screener", "snapshot", "earnings"] as const;
export type RefreshKind = (typeof REFRESH_KINDS)[number];
export type RefreshResponse = {
  kind: RefreshKind;
  /** Job run result: ok | error | timeout | skipped (another process held the lock). */
  status: "ok" | "error" | "timeout" | "skipped" | "running";
  /** Next time a refresh of this kind is allowed (ISO). */
  nextAllowedAt: string;
};
