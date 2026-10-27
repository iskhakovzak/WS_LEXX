/**
 * Simulator API (server: api-server/src/routes/sim.ts, lib/sim/*). The server holds the whole bar series; the client
 * only ever receives bars up to the cursor (fake times) and the reveal after the game.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { OWN_CANDIDATES_KEY } from "@/components/shared/replay-own-day";
import type { TrainerDayContext } from "@/lib/trainer/types";

export type SimMode = "intraday" | "swing";
export type Difficulty = "easy" | "medium" | "hard";
export type SimTf = "1m" | "2m" | "5m" | "1d";
/** Intraday bar sizes the player may pick (server lib/sim/scenario INTRADAY_TFS; 2m is aggregated from 1m). */
export type IntradayTf = "1m" | "2m" | "5m";
export const INTRADAY_TFS: readonly IntradayTf[] = ["1m", "2m", "5m"];
export const isIntradayTf = (v: unknown): v is IntradayTf => v === "1m" || v === "2m" || v === "5m";
export type OrderKind = "buy" | "sell" | "flat";

/** [t (fake epoch s), o, h, l, c, v] */
export type WireBar = [number, number, number, number, number, number];

export type FillReason = "buy" | "sell" | "flat" | "stop" | "target" | "end";
/** `slip`: $ per share the server applied against the player (slippage + half the spread; absent on old games). */
export type SimFill = { idx: number; price: number; qty: number; reason: FillReason; fee: number; slip?: number; intrabar?: true };
export type SimTrade = {
  n: number; side: "long" | "short"; openIdx: number; closeIdx: number | null; entryAvg: number; exitAvg: number | null; maxQty: number;
  gross: number; fees: number; net: number; riskPerShare: number; r: number; mfe: number; mae: number; mfeR: number; maeR: number;
  hadStop: boolean; adds: number; addedToLoser: boolean; exitReason: FillReason | null;
};
export type PublicState = {
  pos: number; avg: number | null; stop: number | null; target: number | null;
  realized: number; fees: number; unrealized: number; net: number;
  fills: SimFill[]; trades: SimTrade[]; canUndo: boolean;
};
export type Levels = { pdh: number | null; pdl: number | null; pdc: number | null; pmh: number | null; pml: number | null };

export type MistakeKind = "heldLoser" | "gaveBack" | "cutWinner" | "addedToLoser" | "noStop" | "overtrading";
export type Mistake = { kind: MistakeKind; trade: number | null; value: number };
export type SimResult = {
  net: number; gross: number; fees: number; pct: number; r: number; trades: number; wins: number;
  bh: { entry: number; exit: number; qty: number; net: number; pct: number };
  vsBh: number; beatBh: boolean; maxDrawdown: number; mistakes: Mistake[]; equity: number[];
};
export type DeskFill = { idx: number; price: number; side: "in" | "out" };
export type DeskTrader = {
  key: string; name: string | null; label: string; own: boolean;
  trades: { side: "long" | "short"; r: number | null; perShare: number | null; net: number | null; fills: DeskFill[] }[];
};
/* Own mode («Мои худшие дни», server lib/sim/own.ts): the player's own losing trade, replayed. */
export type OwnPick = "worst" | "random" | "trade";
export type LegRole = "entry" | "reentry" | "flip" | "add" | "partial_exit" | "exit" | "stop";
export type OwnPublic = { tradeId: number; pick: OwnPick; ticker: string; date: string; decisionIdx: number; riskSource: "trade" | "stop" | "atr" };
export type OwnCompare = { realNet: number; realR: number; simNet: number; simR: number; diff: number; riskUsd: number; verdict: "better" | "same" | "worse" | "skipped" };
export type OwnReveal = OwnPublic & {
  side: "long" | "short"; entryIdx: number; exitIdx: number | null;
  realNet: number; realGross: number; realFees: number; maxQty: number; avgEntry: number | null; avgExit: number | null; stop: number | null;
  riskUsd: number;
  legs: { role: LegRole; price: number; qty: number | null; at: string | null; idx: number | null }[];
  mistakes: string[];
  compare: OwnCompare;
};
export type { OwnCandidate, OwnCandidates } from "@/components/shared/replay-own-day";
export { ownCandidatesQuery } from "@/components/shared/replay-own-day";

export type Reveal = {
  ticker: string; longName: string | null; day: string; dayTo: string | null; realTimes: number[]; result: SimResult;
  desk: { traders: DeskTrader[]; outside: number; intradayCount: number | null };
  own: OwnReveal | null;
};

export type Snapshot = {
  id: number; mode: SimMode; difficulty: Difficulty; tf: SimTf; status: "active" | "finished" | "abandoned" | "skipped";
  startIdx: number; endIdx: number; cursor: number;
  feePerShare: number; riskUnit: number; defaultQty: number; maxNotional: number; levels: Levels;
  bars: WireBar[]; state: PublicState; createdAt: string; reveal: Reveal | null;
  own: OwnPublic | null;
  /** Execution model of this game: typical slippage and spread, $ per share (null / absent on old games). */
  slippage?: { perShare: number; spread: number } | null;
  /** 1R in $ used by «размер по риску» (sizeMode "risk"). */
  oneR?: number;
  /** Set on «Задача дня» games (the trainer). */
  trainer?: { mode: "daily"; date: string } | null;
  /** Timeframe of `bars` on the wire ("1m" when the day has minute bars, else the game tf). Absent on old games = tf. */
  baseTf?: string | null;
  /** Timeframes the player may switch to (aggregated on the client from the base bars). Absent on old servers. */
  displayTfs?: string[] | null;
  /** Set when the game belongs to a series (index 0-based). */
  series?: { id: number; index: number; size: number } | null;
  /** Set on a game finished through «Не торгую». */
  noTrade?: NoTradeVerdict | null;
};

export type NoTradeVerdict = {
  correct: boolean;
  bestR: number;
  reasonKey: "noTrade.correct" | "noTrade.missedLong" | "noTrade.missedShort";
  decisionIdx: number;
  windowEnd: number;
  missed: { side: "long" | "short"; fromIdx: number; toIdx: number; entry: number; extreme: number; r: number } | null;
};

/**
 * The event that stopped an event jump (server lib/sim/events). `fill`: a stop (dir down) / target (dir up) filled
 * during the jump. `level`: the level broken (null for volume; the fill price for fill).
 */
export type SimEventKind = "pdh" | "pdl" | "pmh" | "pml" | "hod" | "lod" | "vwap" | "volume" | "fill";
export type SimEvent = { kind: SimEventKind | (string & {}); dir?: "up" | "down"; idx: number; level?: number | null };
/** Max base bars of one step (server). */
export const MAX_ADVANCE = 400;

/**
 * Context of an intraday game: up to 250 daily bars before the play day (fake times until the reveal), the key levels
 * (52-week high / low since 2026-10-25) and «Контекст дня» (gap, catalyst masked until the reveal, cap, float,
 * premarket volume; null / absent on older servers).
 */
export type GameContext = {
  daily: WireBar[];
  levels: {
    pdh: number | null; pdl: number | null; pdc: number | null; pmh: number | null; pml: number | null; gapPct: number | null; atr14: number | null;
    hi52?: number | null; lo52?: number | null;
  };
  day?: TrainerDayContext | null;
};

export type StepBody = {
  /** sizeMode "risk": the server sizes the order from 1R and the bracket stop sent with it (no qty). */
  order?: { kind: OrderKind; qty?: number; sizeMode?: "risk" } | null;
  bracket?: { stop: number | null; target: number | null } | null;
  advance: number;
  /** "event": advance until the next market event (at most `advance` bars). */
  until?: "event";
};
export type StepResult = { cursor: number; bars: WireBar[]; state: PublicState; done: boolean; reveal: Reveal | null; event?: SimEvent | null };

export type FinishedGame = {
  id: number; mode: SimMode; difficulty: Difficulty; ticker: string; day: string; dayTo: string | null; tf: SimTf;
  net: number; r: number; pct: number; bhPct: number; beatBh: boolean; trades: number; finishedAt: string;
  own: boolean; ownDiff: number | null;
};
export type MyStats = {
  totals: { games: number; r: number; wins: number; beatBh: number; net: number };
  best: FinishedGame | null;
  streak: { current: number; best: number; days: number };
  byLevel: { mode: SimMode; difficulty: Difficulty; games: number; r: number }[];
  recent: FinishedGame[];
  prefs: { leaderboardVisible: boolean };
  own: { games: number; better: number; diff: number };
};
export type Board = {
  from: string; to: string; hidden: number;
  rows: { userId: number; name: string; games: number; r: number; wins: number; best: number; beatBh: number; me: boolean }[];
};

export const simKeys = {
  all: ["sim"] as const,
  active: () => ["sim", "active"] as const,
  me: () => ["sim", "me"] as const,
  board: () => ["sim", "board"] as const,
  own: () => OWN_CANDIDATES_KEY,
  context: (id: number) => ["sim", "context", id] as const,
};

/** Language-independent data: no refetch on a language switch. */
const meta = { i18n: false } as const;

export const activeGameQuery = () => queryOptions({
  queryKey: simKeys.active(),
  queryFn: () => http.get<{ game: Snapshot | null }>("/api/sim/games/active").then((r) => r.game),
  staleTime: 0,
  meta,
});
/**
 * Daily context of a game. Null when the server has none (old games, swing, a server without the endpoint): the
 * screen then simply shows no daily panel / brief. Refetched after the reveal (real dates).
 */
export const gameContextQuery = (id: number, revealed: boolean) => queryOptions({
  queryKey: [...simKeys.context(id), revealed ? "real" : "fake"] as const,
  queryFn: () => http.get<GameContext>(`/api/sim/games/${id}/context`).catch((err: unknown) => {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404 || status === 400 || status === 405) return null;
    throw err;
  }),
  staleTime: Infinity,
  retry: false,
  meta,
});
export const myStatsQuery = () => queryOptions({ queryKey: simKeys.me(), queryFn: () => http.get<MyStats>("/api/sim/me"), staleTime: STALE.short, meta });
export const boardQuery = () => queryOptions({ queryKey: simKeys.board(), queryFn: () => http.get<Board>("/api/sim/leaderboard"), staleTime: STALE.short, meta });

export const simApi = {
  create: (mode: SimMode, difficulty: Difficulty, tf?: IntradayTf | null) =>
    http.post<Snapshot>("/api/sim/games", mode === "intraday" && tf ? { mode, difficulty, tf } : { mode, difficulty }),
  createOwn: (pick: OwnPick, tradeId?: number, tf?: IntradayTf | null) =>
    http.post<Snapshot>("/api/sim/own", { pick, ...(tradeId != null ? { tradeId } : {}), ...(tf ? { tf } : {}) }),
  game: (id: number) => http.get<Snapshot>(`/api/sim/games/${id}`),
  step: (id: number, body: StepBody) => http.post<StepResult>(`/api/sim/games/${id}/step`, body),
  undo: (id: number) => http.post<StepResult>(`/api/sim/games/${id}/undo`),
  finish: (id: number) => http.post<StepResult>(`/api/sim/games/${id}/finish`),
  prefs: (leaderboardVisible: boolean) => http.put<{ leaderboardVisible: boolean }>("/api/sim/prefs", { leaderboardVisible }),
};
