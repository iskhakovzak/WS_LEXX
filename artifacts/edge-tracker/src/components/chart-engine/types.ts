/**
 * WS Chart — shared types. Pure data shapes, no React / DOM.
 */

/** One OHLCV bar. `t` is a UTC epoch in seconds (as served by /api/candles). */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

/** Aggregated bar: same shape + number of base bars folded in. */
export type Bar = Candle & { n: number };

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "D";

export const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h", "D"];
export const TF_SECONDS: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, D: 86400 };
export const TF_LABEL: Record<Timeframe, string> = { "1m": "1м", "5m": "5м", "15m": "15м", "1h": "1ч", D: "Д" };

/** Interval names the candles API speaks. */
export type ApiInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d";
export const API_INTERVAL_SECONDS: Record<ApiInterval, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "60m": 3600, "1d": 86400 };

export type Session = "pre" | "rth" | "post" | "closed";

export type Side = "long" | "short";

export type ExecutionKind = "entry" | "add" | "trim" | "exit" | "stop";

/** Execution as served by GET /api/trades/:id/executions (numbers arrive as strings). */
export type Execution = {
  id: number;
  tradeId?: number;
  kind: ExecutionKind;
  price: string | number;
  qty: string | number | null;
  executedAt: string | null;
  note?: string | null;
  sortOrder?: number;
};

/** A fill resolved onto a bar series. */
export type Fill = {
  id: number;
  kind: ExecutionKind;
  price: number;
  /** Shares; null when the journal has no quantity for this execution. */
  qty: number | null;
  /** Exact execution instant (epoch seconds) or null when only a price is known. */
  time: number | null;
  /** Index of the bar the fill belongs to. */
  idx: number;
  /** True when the fill was placed by price match (no timestamp). */
  byPrice: boolean;
  label: string;
};

/** The subset of the journal trade the engine needs. Matches `Trade` from @workspace/api-client-react structurally. */
export type TradeLike = {
  id: number;
  ticker: string;
  date: string;
  side?: string | null;
  entry?: number | string | null;
  exit?: number | string | null;
  stop?: number | string | null;
  qty?: number | null;
  pnl?: number | null;
  fees?: number | null;
  riskUsd?: number | null;
  result?: string | null;
  horizon?: string | null;
  exitDate?: string | null;
  contextSnapshot?: unknown;
  /** First entry / last exit fill time (ISO) when the caller already knows them (used when executions are unavailable). */
  entryTime?: string | null;
  exitTime?: string | null;
};

export type PositionPoint = {
  idx: number;
  t: number;
  /** Open quantity after this bar's fills. */
  qty: number;
  /** Average entry price of the open quantity (null when flat). */
  avg: number | null;
  /** Unrealised P&L in $ marked at the bar close. */
  unrealized: number;
  /** Realised P&L in $ so far (partial exits). */
  realized: number;
  /** unrealized + realized. */
  total: number;
};

export type PositionState = {
  qty: number;
  avg: number | null;
  realized: number;
  unrealized: number | null;
  total: number | null;
  fillsSoFar: number;
  /** True when quantities were unknown and $ figures are scaled by the trade qty. */
  qtyAssumed: boolean;
};

export type ExcursionResult = {
  /** Per-share figures (≥ 0). */
  mfe: number;
  mae: number;
  mfeUsd: number | null;
  maeUsd: number | null;
  /** Percent of the average entry. */
  mfePct: number | null;
  maePct: number | null;
  /** In R — only when a risk per share is known. */
  mfeR: number | null;
  maeR: number | null;
  mfeAt: number | null;
  maeAt: number | null;
  mfePrice: number | null;
  maePrice: number | null;
  /** True when the entry/exit bar's range before/after the fill had to be excluded. */
  approximate: boolean;
  barsUsed: number;
};

export type VwapPoint = { t: number; vwap: number; sd: number };

export type DayLevels = {
  pdh: number | null;
  pdl: number | null;
  pdc: number | null;
  pmh: number | null;
  pml: number | null;
  open: number | null;
  orb5: { h: number; l: number } | null;
  orb15: { h: number; l: number } | null;
};

export type ProfileRow = { price: number; vol: number };
export type VolumeProfile = {
  rows: ProfileRow[];
  binSize: number;
  poc: number | null;
  vah: number | null;
  val: number | null;
  maxVol: number;
  totalVol: number;
};

export type MarketEventLite = {
  id: number;
  ticker: string;
  date: string;
  eventType?: string | null;
  headline: string;
  session?: string | null;
};

export type DrawingType = "hline" | "trend" | "rect" | "fib";
export type DrawingPoint = { time: number; price: number };
export type Drawing = {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  color?: string;
  createdAt: number;
};

export type ChartMode = "analysis" | "replay" | "training";

export type TrainingResult = {
  tradeId: number;
  side: Side;
  qty: number | null;
  /** Where the trader said «я бы вышел здесь». */
  userExitPrice: number;
  userExitTime: number;
  /** The real (average) exit of the trade. */
  actualExitPrice: number | null;
  actualExitTime: number | null;
  avgEntry: number | null;
  /** P&L in $ had the trader exited where they said (null when qty unknown). */
  userPnlUsd: number | null;
  /** The real P&L in $ (gross, from fills). */
  actualPnlUsd: number | null;
  /** userPnlUsd − actualPnlUsd. */
  diffUsd: number | null;
  /** Seconds between the user's exit and the actual one (negative = earlier). */
  diffSeconds: number | null;
  /**
   * 0–100: where the chosen exit sits between the worst and the best close available from the entry up to
   * max(chosen exit, real exit). 100 = the best possible exit in that window. Optional, older results lack it.
   */
  score?: number | null;
};

export type SparkPoint = { x: number; y: number };
export type SparkData = {
  closes: number[];
  times: number[];
  entryIdx: number | null;
  exitIdx: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  side: Side;
  min: number;
  max: number;
};
