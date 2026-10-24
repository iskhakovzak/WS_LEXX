/**
 * Share card of one trade (a 1080×1350 PNG drawn in the browser) — pure model, unit-tested in model.test.ts.
 *
 *   shareTradeOf        the few trade fields a card may show (never the account, commissions or anyone else's data)
 *   resultModes / pickMode / resultValue   the big number: $ net, R or % of the position; desk rule shareCards.money
 *                       = "r_only" drops $ everywhere (no $ mode, no $ cell)
 *   cardTexts           every string drawn on the card. Card text is English on purpose (trading convention, like the
 *                       reference card): «Entry», «Exit», «Size», «Return», «LONG · OCT 14, 2026»
 *   cardSeries / fallbackSeries / chartPoints / pillBox   the price line and the Entry / Exit pills
 *   fitFontSize         the largest font that keeps a text inside a width (huge P&L, long tickers)
 *   parsePrefs          remembered dialog choices (localStorage), validated
 *
 * Desk switches come from GET /permissions/me → shareCards (api lib/settings/registry.ts shareCards.*).
 */
import type { Trade } from "@workspace/api-client-react";
import type { PermissionsMe } from "@/lib/permissions";
import { fmtNum, fmtPct, fmtPrice, fmtR, fmtUsd } from "@/lib/format";
import { effectiveR, holdSeconds, isRedactedTrade, netPnl, resultKey } from "../trade-utils";
import { RESULT_MODES, sharePolicy, type MoneyPolicy, type ResultMode } from "@/components/shared/share-canvas/policy";

// Shared with the «Итоги» story cards (components/shared/share-canvas): re-exported so the card keeps one import.
export { DEFAULT_PREFS, THEME_KINDS, parsePrefs, sharePolicy } from "@/components/shared/share-canvas/policy";
export type { MoneyPolicy, ResultMode, SharePrefs, ThemeKind } from "@/components/shared/share-canvas/policy";
export { ellipsize, fitFontSize, initials, seededRandom } from "@/components/shared/share-canvas/canvas";
export type { Pt, Rect } from "@/components/shared/share-canvas/canvas";
export { cardSeries, chartPoints, fallbackSeries, pillBox } from "@/components/shared/share-canvas/series";
export type { BarLite, CardSeries } from "@/components/shared/share-canvas/series";

export const CARD_W = 1080;
export const CARD_H = 1350;

export interface ShareTrade {
  id: number;
  ticker: string;
  side: "long" | "short";
  /** Trade day, YYYY-MM-DD. */
  day: string;
  entry: number | null;
  exit: number | null;
  qty: number | null;
  /** Net P&L (gross − fees): the commission breakdown itself never reaches the card. */
  net: number | null;
  r: number | null;
  holdSec: number | null;
  /** Setup (the trader's own label) or the strategy code. */
  setup: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function shareTradeOf(t: Trade): ShareTrade {
  const setup = (t.setup || t.strategy || "").trim();
  return {
    id: t.id,
    ticker: (t.ticker || "").trim().toUpperCase(),
    side: (t.side || "").toLowerCase().includes("short") ? "short" : "long",
    day: (t.date || "").slice(0, 10),
    entry: num(t.entry),
    exit: num(t.exit),
    qty: num(t.qty),
    net: netPnl(t),
    r: effectiveR(t).value,
    holdSec: holdSeconds(t),
    setup: setup || null,
  };
}

/**
 * May the viewer make a card of this trade? Own trades only (a card carries the owner's result out of the desk),
 * closed, not a redacted trade of another trader, and the desk switch on.
 */
export function canShareTrade(t: Trade, viewer: string | null | undefined, perms: Pick<PermissionsMe, "shareCards"> | null | undefined): boolean {
  if (!sharePolicy(perms).enabled || !viewer || t.trader !== viewer) return false;
  if (isRedactedTrade(t) || resultKey(t.result) === "open") return false;
  return netPnl(t) != null || effectiveR(t).value != null;
}

/** % of the position: net P&L / (entry × size). */
export function pctOfPosition(st: Pick<ShareTrade, "net" | "entry" | "qty">): number | null {
  if (st.net == null || st.entry == null || st.qty == null) return null;
  const notional = Math.abs(st.entry * st.qty);
  return notional > 0 ? (st.net / notional) * 100 : null;
}

export function resultValue(st: ShareTrade, mode: ResultMode): number | null {
  if (mode === "usd") return st.net;
  if (mode === "r") return st.r;
  return pctOfPosition(st);
}

/** Modes the card can show for this trade, in switch order; "r_only" never offers $. */
export function resultModes(st: ShareTrade, money: MoneyPolicy): ResultMode[] {
  return RESULT_MODES.filter((m) => (m !== "usd" || money === "usd") && resultValue(st, m) != null);
}

/** The saved mode when it is available, else the first available one (null: nothing to show). */
export function pickMode(preferred: ResultMode | null | undefined, available: readonly ResultMode[]): ResultMode | null {
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] ?? null;
}

/** Profit / loss tint of the card: by the sign of net P&L, else of R; null = flat or unknown. */
export function toneOf(st: Pick<ShareTrade, "net" | "r">): "profit" | "loss" | null {
  const v = st.net ?? st.r;
  if (v == null || v === 0) return null;
  return v > 0 ? "profit" : "loss";
}

export function bigResultText(st: ShareTrade, mode: ResultMode): string {
  const v = resultValue(st, mode);
  if (mode === "usd") return fmtUsd(v, { signed: true });
  if (mode === "r") return fmtR(v);
  return fmtPct(v);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** «OCT 14, 2026» from YYYY-MM-DD (English on the card, like the reference). */
export function cardDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : day;
}

/** Hold time on the card: «45s», «12m 30s», «1h 20m», «2d 4h». */
export function cardHold(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r && m < 10 ? `${m}m ${r}s` : `${m}m`; }
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export type StatCell = { label: string; value: string };

/** A price on the card: grouped from 1,000 («30,556.80», like the reference), otherwise the trading price format. */
export function cardPrice(v: number): string {
  return Math.abs(v) >= 1000 ? fmtNum(v, 2) : fmtPrice(v);
}

export interface CardOptions {
  mode: ResultMode;
  money: MoneyPolicy;
  showPrices: boolean;
  /** The owner's display name, or null when «show name» is off. */
  name: string | null;
}

/**
 * The small table under the big number (at most six cells, three per row): prices (when shown), size, the other
 * return figure, hold, setup. Under "r_only" no cell is in $.
 */
export function cardStats(st: ShareTrade, o: Pick<CardOptions, "mode" | "money" | "showPrices">): StatCell[] {
  const cells: StatCell[] = [];
  if (o.showPrices && st.entry != null) cells.push({ label: "Entry", value: cardPrice(st.entry) });
  if (o.showPrices && st.exit != null) cells.push({ label: "Exit", value: cardPrice(st.exit) });
  if (st.qty != null) cells.push({ label: "Size", value: `${fmtNum(Math.abs(st.qty), 0)} sh` });
  // «Return»: R when the big number is not R, else % of the position; $ only as a last resort and only when allowed.
  const ret = o.mode !== "r" && st.r != null ? fmtR(st.r)
    : o.mode !== "pct" && pctOfPosition(st) != null ? fmtPct(pctOfPosition(st))
    : o.mode !== "usd" && o.money === "usd" && st.net != null ? fmtUsd(st.net, { signed: true })
    : null;
  if (ret) cells.push({ label: "Return", value: ret });
  const hold = cardHold(st.holdSec);
  if (hold) cells.push({ label: "Hold", value: hold });
  if (st.setup) cells.push({ label: "Setup", value: st.setup });
  return cells.slice(0, 6);
}

export interface CardTexts {
  ticker: string;
  /** «LONG · OCT 14, 2026». */
  subtitle: string;
  /** Small caps over the big number: «NET P&L» / «R MULTIPLE» / «RETURN ON POSITION». */
  resultLabel: string;
  big: string;
  stats: StatCell[];
  name: string | null;
  brand: string;
}

const RESULT_LABEL: Record<ResultMode, string> = { usd: "NET P&L", r: "R MULTIPLE", pct: "RETURN ON POSITION" };

export function cardTexts(st: ShareTrade, o: CardOptions): CardTexts {
  // The money rule wins over a stale saved choice: under "r_only" a $ mode falls back to R / %.
  const mode = o.money === "r_only" && o.mode === "usd" ? (pickMode(null, resultModes(st, "r_only")) ?? "r") : o.mode;
  return {
    ticker: st.ticker,
    subtitle: `${st.side === "short" ? "SHORT" : "LONG"} · ${cardDate(st.day)}`,
    resultLabel: RESULT_LABEL[mode],
    big: bigResultText(st, mode),
    stats: cardStats(st, { ...o, mode }),
    name: o.name?.trim() || null,
    brand: "WS_Desk",
  };
}

/** File name of the PNG: «WS_Desk-NVDA-2026-10-14.png» (ticker reduced to safe characters). */
export function cardFileName(st: Pick<ShareTrade, "ticker" | "day">): string {
  const t = st.ticker.replace(/[^A-Z0-9._-]/gi, "") || "trade";
  return `WS_Desk-${t}-${st.day || "card"}.png`;
}
