/** Regime names, hints, tones, icons and the suggestion's reason lines (read in the current language on call). */
import { ArrowLeftRight, Crosshair, Globe, Sparkles, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ds";
import type { RegimeKey } from "@/lib/market-regime";
import { fmtNum, fmtPct } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { indicatorsI18n } from "@/i18n/ns/indicators";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import type { SuggestReason } from "@/components/shared/market/regime-suggest";

export const regimeName = (k: RegimeKey): string => marketRegimeI18n.t(`regimes.${k}.name`);
export const regimeHint = (k: RegimeKey): string => marketRegimeI18n.t(`regimes.${k}.hint`);

export const REGIME_TONE: Record<RegimeKey, Tone> = {
  theme_bull: "up", macro: "warn", range: "neutral", panic: "down", idiosyncratic: "accent", euphoria: "purple",
};

export const REGIME_ICON: Record<RegimeKey, LucideIcon> = {
  theme_bull: TrendingUp, macro: Globe, range: ArrowLeftRight, panic: TrendingDown, idiosyncratic: Crosshair, euphoria: Sparkles,
};

/** The multiplier without trailing zeros: 1 → «1», 0.5 → «0.5», 0.75 → «0.75». */
export const multText = (m: number): string => fmtNum(m, Number.isInteger(m) ? 0 : Number.isInteger(m * 10) ? 1 : 2);

const pp = (v: number) => commonI18n.t("units.percentPoints", { value: fmtNum(v, { decimals: 1, signed: true }) });

/** One reason of the engine's suggestion, e.g. «VIX 31.2», «SPY −4.8% за 5 дней». */
export function reasonText(r: SuggestReason): string {
  const v = r.value;
  const value = v == null ? "" : (() => {
    switch (r.code) {
      case "vixPanic": case "volHigh": case "volLow": return fmtNum(v, 1);
      case "vixInverted": return fmtNum(v, 2);
      case "smallCaps": case "narrow": return pp(v);
      case "rates": return indicatorsI18n.t("engine.bp", { value: fmtNum(v, { decimals: 0, signed: true }) });
      default: return fmtPct(v, 1);
    }
  })();
  return marketRegimeI18n.t(`suggest.reasons.${r.code}`, { value });
}
