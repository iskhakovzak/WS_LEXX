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

export const CARD_W = 1080;
export const CARD_H = 1350;

export type ResultMode = "usd" | "r" | "pct";
export type MoneyPolicy = "usd" | "r_only";
export type ThemeKind = "olymp" | "marble" | "night" | "photo";
export const THEME_KINDS: readonly ThemeKind[] = ["olymp", "marble", "night", "photo"];
const MODES: readonly ResultMode[] = ["usd", "r", "pct"];

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

/** Desk rules from /permissions/me (an older API without the field: on, $ allowed). */
export function sharePolicy(perms: Pick<PermissionsMe, "shareCards"> | null | undefined): { enabled: boolean; money: MoneyPolicy } {
  const s = perms?.shareCards;
  return { enabled: s ? s.enabled !== false : true, money: s?.money === "r_only" ? "r_only" : "usd" };
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
  return MODES.filter((m) => (m !== "usd" || money === "usd") && resultValue(st, m) != null);
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
    brand: "WS_LEXX",
  };
}

/** Initials for the avatar disc: «Zakir Ishakov» → «ZI», «Олег» → «О». */
export function initials(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/**
 * Largest font size in [min, max] (step 2) whose measured width fits `maxWidth`. `measure(text, size)` = width at that
 * size (canvas measureText in the renderer, a fake in tests). Returns `min` when even that is too wide.
 */
export function fitFontSize(text: string, maxWidth: number, max: number, min: number, measure: (text: string, size: number) => number): number {
  for (let size = max; size > min; size -= 2) if (measure(text, size) <= maxWidth) return size;
  return min;
}

/** Cut a text with «…» until it fits (setup names, long tickers at the minimum size). */
export function ellipsize(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}…`) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// ── Price line ──────────────────────────────────────────────────────────────

export type BarLite = { t: number; c: number };

export interface CardSeries {
  closes: number[];
  /** Index into `closes` of the first entry fill / the last exit fill (null = unknown). */
  entryIdx: number | null;
  exitIdx: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  min: number;
  max: number;
  /** True for the plain entry → exit line drawn when the day has no bars. */
  synthetic: boolean;
}

/** Last bar with t ≤ time (−1 when time is before every bar). */
function barAt(bars: readonly BarLite[], time: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.t <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * The price path around the trade: the bars from a little before the entry to a little after the exit (padding grows
 * with the hold, 15…90 bars), downsampled to at most `maxPoints` closes. Entry / exit land on the sampled point
 * nearest to their bar. Null without usable bars or without an entry time inside them.
 */
export function cardSeries(
  bars: readonly BarLite[], entryTime: number | null, exitTime: number | null,
  entryPrice: number | null, exitPrice: number | null, maxPoints = 240,
): CardSeries | null {
  const clean = bars.filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c));
  if (clean.length < 2 || entryTime == null || !Number.isFinite(entryTime)) return null;
  const e = barAt(clean, entryTime);
  if (e < 0 || entryTime > clean[clean.length - 1]!.t + 86_400) return null;
  const x = exitTime != null && Number.isFinite(exitTime) ? Math.max(e, barAt(clean, exitTime)) : null;
  const span = (x ?? e) - e;
  const pad = Math.max(15, Math.min(90, Math.round(span * 0.6)));
  const from = Math.max(0, e - pad);
  const to = Math.min(clean.length - 1, (x ?? e) + pad);
  const count = to - from + 1;
  const n = Math.max(2, Math.min(maxPoints, count));
  const src: number[] = [];
  for (let k = 0; k < n; k++) src.push(Math.min(to, from + Math.round((k * (count - 1)) / (n - 1))));
  const nearest = (idx: number) => {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < src.length; k++) { const d = Math.abs(src[k]! - idx); if (d < bestD) { bestD = d; best = k; } }
    return best;
  };
  const closes = src.map((i) => clean[i]!.c);
  const entryIdx = nearest(e);
  const exitIdx = x != null ? Math.max(entryIdx, nearest(x)) : null;
  return withRange({ closes, entryIdx, exitIdx, entryPrice: entryPrice ?? closes[entryIdx]!, exitPrice: exitPrice ?? (exitIdx != null ? closes[exitIdx]! : null), synthetic: false });
}

/** No bars: a clean line from the entry price to the exit price (null without both prices). */
export function fallbackSeries(entryPrice: number | null, exitPrice: number | null): CardSeries | null {
  if (entryPrice == null || exitPrice == null || !Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) return null;
  const n = 24;
  const closes = Array.from({ length: n }, (_, k) => {
    const f = k <= 3 ? 0 : k >= n - 4 ? 1 : (k - 3) / (n - 7);
    return entryPrice + (exitPrice - entryPrice) * f;
  });
  return withRange({ closes, entryIdx: 3, exitIdx: n - 4, entryPrice, exitPrice, synthetic: true });
}

function withRange(s: Omit<CardSeries, "min" | "max">): CardSeries {
  let min = Infinity, max = -Infinity;
  for (const c of s.closes) { if (c < min) min = c; if (c > max) max = c; }
  for (const p of [s.entryPrice, s.exitPrice]) if (p != null && Number.isFinite(p)) { if (p < min) min = p; if (p > max) max = p; }
  return { ...s, min, max };
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

/** Screen points of the line inside `rect`; a flat series sits in the middle. */
export function chartPoints(s: CardSeries, r: Rect): { line: Pt[]; entry: Pt | null; exit: Pt | null } {
  const n = s.closes.length;
  const span = s.max - s.min;
  const y = (p: number) => (span > 0 ? r.y + (1 - (p - s.min) / span) * r.h : r.y + r.h / 2);
  const x = (i: number) => r.x + (n > 1 ? (i / (n - 1)) * r.w : r.w / 2);
  const line = s.closes.map((c, i) => ({ x: x(i), y: y(c) }));
  const at = (i: number | null, p: number | null): Pt | null => (i == null ? null : { x: x(i), y: y(p != null && Number.isFinite(p) ? p : s.closes[i]!) });
  return { line, entry: at(s.entryIdx, s.entryPrice), exit: at(s.exitIdx, s.exitPrice) };
}

/**
 * Where a pill (w × h) sits for a point: above it by default, below when there is no room above, kept inside `bounds`
 * horizontally; `avoid` (the other pill) pushes it to the other side when the two would overlap.
 */
export function pillBox(p: Pt, w: number, h: number, bounds: Rect, avoid?: Rect | null, gap = 18): Rect {
  const clampX = (x: number) => Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, x));
  const above = { x: clampX(p.x - w / 2), y: p.y - gap - h, w, h };
  const below = { x: clampX(p.x - w / 2), y: p.y + gap, w, h };
  const fitsAbove = above.y >= bounds.y;
  const fitsBelow = below.y + h <= bounds.y + bounds.h;
  const hits = (a: Rect) => !!avoid && a.x < avoid.x + avoid.w && avoid.x < a.x + a.w && a.y < avoid.y + avoid.h && avoid.y < a.y + a.h;
  if (fitsAbove && !hits(above)) return above;
  if (fitsBelow && !hits(below)) return below;
  return fitsAbove ? above : below;
}

// ── Remembered choices ──────────────────────────────────────────────────────

export interface SharePrefs {
  theme: ThemeKind;
  /** Artwork id within «Олимп» (themes.ts OLYMP_ART). */
  art: string;
  mode: ResultMode;
  showName: boolean;
  showPrices: boolean;
}

export const DEFAULT_PREFS: SharePrefs = { theme: "olymp", art: "", mode: "usd", showName: true, showPrices: true };

/**
 * Saved prefs from localStorage, field by field (anything unknown → default). «Своё фото» is never restored: the photo
 * itself is not kept, so the dialog would open on an empty theme.
 */
export function parsePrefs(raw: unknown): SharePrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme = THEME_KINDS.includes(o.theme as ThemeKind) && o.theme !== "photo" ? (o.theme as ThemeKind) : DEFAULT_PREFS.theme;
  return {
    theme,
    art: typeof o.art === "string" ? o.art.slice(0, 60) : DEFAULT_PREFS.art,
    mode: MODES.includes(o.mode as ResultMode) ? (o.mode as ResultMode) : DEFAULT_PREFS.mode,
    showName: typeof o.showName === "boolean" ? o.showName : DEFAULT_PREFS.showName,
    showPrices: typeof o.showPrices === "boolean" ? o.showPrices : DEFAULT_PREFS.showPrices,
  };
}

/** File name of the PNG: «WS_LEXX-NVDA-2026-10-14.png» (ticker reduced to safe characters). */
export function cardFileName(st: Pick<ShareTrade, "ticker" | "day">): string {
  const t = st.ticker.replace(/[^A-Z0-9._-]/gi, "") || "trade";
  return `WS_LEXX-${t}-${st.day || "card"}.png`;
}

/** Small deterministic PRNG (mulberry32) for the procedural themes: the same trade draws the same marble. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
