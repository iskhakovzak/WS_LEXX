/**
 * The morning suggestion of the desk regime, from the /indicators engine (./engine regimeAt: trend, volatility and
 * risk appetite + the frame row: VIX level and curve, SPY vs its 50-day, 5-day return, small caps and equal weight vs
 * the index, 10-year yield and dollar moves). Pure — covered by regime-suggest.test.ts. The suggestion is only a
 * proposal: a curator / admin confirms or changes it (routes/market-regime PUT /day/:date stores both).
 *
 * Rules, first match wins (pre-open: the frame row is the last close before the session):
 *   panic          VIX ≥ 30; or the VIX curve inverted (VIX / VIX3M ≥ 1.05) in a down trend or after a ≥ 3 % 5-day
 *                  drop; or VIX ≥ 25 after a ≥ 4 % 5-day drop
 *   euphoria       up trend, SPY ≥ 6 % above its 50-day, small caps ≥ 2 pp ahead of SPY over 20 days, VIX < 20
 *   macro          high volatility (engine), or the 10-year yield moved ≥ 12 bp in a day, or the dollar ≥ 3 % in 20
 *                  days, or a down trend with volatility not low — the index and the news drive everything
 *   theme_bull     up trend with risk appetite not «off»
 *   idiosyncratic  no index trend, volatility not high, a narrow market (equal weight ≥ 1 pp behind SPY over 20 days):
 *                  the money is in single names / one sector
 *   range          everything else (no trend, quiet tape)
 * Without VIX the rules that need it are skipped (the engine still reads trend and the volatility of SPY itself).
 */
import { regimeAt, type Row } from "./engine";
import type { RegimeKey } from "@/lib/market-regime";

export type ReasonCode =
  | "vixPanic" | "vixInverted" | "selloff" | "stretched" | "smallCaps" | "volHigh" | "rates" | "dollar" | "trendDown"
  | "trendUp" | "riskOn" | "narrow" | "noTrend" | "volLow";

export type SuggestReason = { code: ReasonCode; value: number | null };
export type RegimeSuggestion = { regime: RegimeKey; reasons: SuggestReason[]; asOf: string };

export const PANIC_VIX = 30;
export const PANIC_VIX_SELLOFF = 25;
export const INVERTED_CURVE = 1.05;
export const EUPHORIA_DIST50 = 6;
export const EUPHORIA_SMALL_CAPS = 2;
export const EUPHORIA_MAX_VIX = 20;
export const MACRO_TNX_BP = 12;
export const MACRO_DXY_PCT = 3;
export const NARROW_RSP = -1;

const r2 = (v: number) => Math.round(v * 100) / 100;
const reason = (code: ReasonCode, value: number | null = null): SuggestReason => ({ code, value: value == null ? null : r2(value) });

/** The suggested regime as of the close of rows[i]; null when the engine has no regime yet (< ~50 sessions). */
export function suggestRegime(rows: readonly Row[], i: number): RegimeSuggestion | null {
  const reg = regimeAt(rows as Row[], i);
  const r = rows[i];
  if (!reg || !r) return null;
  const out = (regime: RegimeKey, reasons: SuggestReason[]): RegimeSuggestion => ({ regime, reasons, asOf: r.d });
  const vix = r.vix;
  const ret5 = r.ret5 ?? 0;
  const term = r.vixTerm;
  const trend = reg.trend.key;
  const vol = reg.vol.key;

  // Panic: fear priced in the VIX, or a capitulation-style drop with an inverted curve.
  const inverted = term != null && term >= INVERTED_CURVE;
  if ((vix != null && vix >= PANIC_VIX) || (inverted && (trend === "down" || ret5 <= -3)) || (vix != null && vix >= PANIC_VIX_SELLOFF && ret5 <= -4)) {
    const reasons: SuggestReason[] = [];
    if (vix != null && vix >= PANIC_VIX_SELLOFF) reasons.push(reason("vixPanic", vix));
    if (inverted) reasons.push(reason("vixInverted", term));
    if (ret5 <= -3) reasons.push(reason("selloff", ret5));
    return out("panic", reasons.length ? reasons : [reason("vixPanic", vix)]);
  }

  // Euphoria: a stretched up trend led by small caps on a calm VIX.
  if (trend === "up" && (r.dist50 ?? 0) >= EUPHORIA_DIST50 && (r.iwmRel20 ?? -Infinity) >= EUPHORIA_SMALL_CAPS && (vix == null || vix < EUPHORIA_MAX_VIX)) {
    return out("euphoria", [reason("stretched", r.dist50), reason("smallCaps", r.iwmRel20)]);
  }

  // Macro: the index and the news drive the tape (high vol, rates / dollar shocks, a non-quiet down trend).
  const ratesShock = r.tnxChgBp != null && Math.abs(r.tnxChgBp) >= MACRO_TNX_BP;
  const dollarShock = r.dxyChg20 != null && Math.abs(r.dxyChg20) >= MACRO_DXY_PCT;
  if (vol === "high" || ratesShock || dollarShock || (trend === "down" && vol !== "low")) {
    const reasons: SuggestReason[] = [];
    if (vol === "high") reasons.push(reason("volHigh", vix));
    if (ratesShock) reasons.push(reason("rates", r.tnxChgBp));
    if (dollarShock) reasons.push(reason("dollar", r.dxyChg20));
    if (trend === "down") reasons.push(reason("trendDown", r.dist50));
    return out("macro", reasons);
  }

  // Theme bull: a healthy up trend.
  if (trend === "up" && reg.risk.key !== "off") {
    const reasons = [reason("trendUp", r.dist50)];
    if (reg.risk.key === "on") reasons.push(reason("riskOn"));
    return out("theme_bull", reasons);
  }

  // Idiosyncratic: no index trend, but a narrow market — the action is in single names / one sector.
  if (trend !== "up" && r.rspRel20 != null && r.rspRel20 <= NARROW_RSP) {
    return out("idiosyncratic", [reason("noTrend", r.dist50), reason("narrow", r.rspRel20)]);
  }

  // Range: nothing trends, the tape is quiet.
  const reasons = [reason("noTrend", r.dist50)];
  if (vol === "low") reasons.push(reason("volLow", vix));
  return out("range", reasons);
}

/** Frame index of the last close known before today's (or the next) session: the running session's bar is not final. */
export function suggestionIndex(rows: readonly Row[], live: boolean): number {
  return live ? rows.length - 2 : rows.length - 1;
}
