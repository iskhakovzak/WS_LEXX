/**
 * Phrasing of what-if rules (whatIf namespace, read at call time): the chip label, the «Если бы ты не …» card headline
 * and the exclusion reason names. Split out of ./rules (which re-exports everything here) to keep both files small.
 */
import { fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { type ErrorCode, errorLabel } from "@/components/shared/error-vocab";
import type { Rule } from "@/components/shared/what-if-rules";

/**
 * Mistakes known at the entry (the API grid's GRID_MISTAKES, plus «Завышенный размер»): the builder offers only these,
 * and «ошибки входа» is said only of them. Exit / outcome marks are set because the trade went wrong.
 */
export const ENTRY_MISTAKES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(["fomo", "offPlan", "earlyEntry", "revenge", "offSetup", "overtrading", "noStop", "oversize"]);

export function fmtHold(seconds: number): string {
  if (seconds < 120) return commonI18n.t("time.secondsShort", { count: Math.round(seconds) });
  if (seconds < 7200) return commonI18n.t("time.minutesShort", { count: Math.round(seconds / 60) });
  return commonI18n.t("time.hoursShort", { count: Math.round(seconds / 3600) });
}

const usd = (v: number) => fmtUsd(v, { decimals: "trim" });

/** Short chip label. */
export function chipLabel(r: Rule): string {
  const t = whatIfI18n.t;
  switch (r.type) {
    case "dailyLossLimit": return t("rules.chip.dailyLossLimit", { amount: usd(r.usd) });
    case "maxTradesPerDay": return t("rules.chip.maxTradesPerDay", { count: r.n });
    case "stopAfterLosses": return t("rules.chip.stopAfterLosses", { count: r.n });
    case "timeWindow":
      if (r.from && r.to) return t("rules.chip.windowBoth", { from: r.from, to: r.to });
      if (r.from === "09:30") return t("rules.chip.noPremarket");
      if (r.to === "16:00" && !r.from) return t("rules.chip.noAfterHours");
      return r.from ? t("rules.chip.windowFrom", { from: r.from }) : r.to ? t("rules.chip.windowTo", { to: r.to }) : t("rules.chip.window");
    case "priceRange": return r.min != null && r.max != null ? t("rules.chip.priceBoth", { min: r.min, max: r.max }) : r.min != null ? t("rules.chip.priceMin", { min: r.min }) : r.max != null ? t("rules.chip.priceMax", { max: r.max }) : t("rules.chip.price");
    case "minHold": return t("rules.chip.minHold", { hold: fmtHold(r.seconds) });
    case "excludeTickers": return t("rules.chip.excludeTickers", { tickers: r.tickers.join(", ") });
    case "excludeSide": return r.side === "long" ? t("rules.chip.noLongs") : t("rules.chip.noShorts");
    case "commissionPlan": return t("rules.chip.commissionPlan", { perShare: r.perShare, min: r.minPerOrder });
    case "capLoss": return t("rules.chip.capLoss", { amount: usd(r.usd) });
    case "sizeRange": return r.min != null && r.max != null ? t("rules.chip.sizeBoth", { min: r.min, max: r.max }) : r.min != null ? t("rules.chip.sizeMin", { min: r.min }) : r.max != null ? t("rules.chip.sizeMax", { max: r.max }) : t("rules.chip.size");
    case "afterLoss": return t("rules.chip.afterLoss", { minutes: r.minutes });
    case "excludeSetups": return t("rules.chip.excludeSetups", { setups: r.setups.join(", ") });
    case "minGrade": return r.grade === "A+" ? t("rules.chip.onlyAPlus") : t("rules.chip.minGrade", { grade: r.grade });
    case "excludeImx": return t("rules.chip.excludeImx");
    case "noReentry": return t("rules.chip.noReentry");
    case "requireStop": return t("rules.chip.requireStop");
    case "maxSizeRel": return t("rules.chip.maxSizeRel", { x: r.x });
    case "excludeMistakes":
      if (r.codes.length === 1) return t("rules.chip.excludeMistake", { name: errorLabel(r.codes[0]) });
      if (r.codes.length === 2) return t("rules.chip.excludeMistakes", { names: r.codes.map(errorLabel).join(", ") });
      return r.codes.every((c) => ENTRY_MISTAKES.has(c)) ? t("rules.chip.excludeMistakesMany", { count: r.codes.length }) : t("rules.chip.excludeMistakesAny", { count: r.codes.length });
    case "excludeTags": return r.tags.length === 1 ? t("rules.chip.excludeTag", { tags: r.tags[0] }) : t("rules.chip.excludeTags", { tags: r.tags.join(", ") });
    case "profitGiveback": return t("rules.chip.profitGiveback", { pct: r.pct, amount: usd(r.peak) });
    case "dailyProfitTarget": return t("rules.chip.dailyProfitTarget", { amount: usd(r.usd) });
    case "afterWin": return t("rules.chip.afterWin", { minutes: r.minutes });
    case "redZone": return r.floor != null ? t("rules.chip.redZoneFloor", { amount: usd(r.usd), count: r.k, floor: usd(r.floor) }) : t("rules.chip.redZone", { amount: usd(r.usd), count: r.k });
    case "blockWindow": return t("rules.chip.blockWindow", { from: r.from, to: r.to });
    case "maxTradesPerTicker": return t("rules.chip.maxTradesPerTicker", { count: r.n });
    case "noReentryAfterLoss": return t("rules.chip.noReentryAfterLoss", { minutes: r.minutes });
    case "excludeStrategies": return t("rules.chip.excludeStrategies", { strategies: r.strategies.join(", ") });
    case "excludeEarnings": return t("rules.chip.excludeEarnings");
  }
}

/** «Если бы ты не …» — the suggestion card headline. */
export function ifNotPhrase(r: Rule): string {
  const t = whatIfI18n.t;
  switch (r.type) {
    case "dailyLossLimit": return t("rules.ifNot.dailyLossLimit", { amount: usd(r.usd) });
    case "maxTradesPerDay": return t("rules.ifNot.maxTradesPerDay", { count: r.n });
    case "stopAfterLosses": return t("rules.ifNot.stopAfterLosses", { count: r.n });
    case "timeWindow":
      if (r.from && r.to) return t("rules.ifNot.windowBoth", { from: r.from, to: r.to });
      if (r.from === "09:30") return t("rules.ifNot.noPremarket");
      if (r.to === "16:00" && !r.from) return t("rules.ifNot.noAfterHours");
      if (r.from) return t("rules.ifNot.windowFrom", { from: r.from });
      if (r.to) return t("rules.ifNot.windowTo", { to: r.to });
      return t("rules.ifNot.window");
    case "priceRange":
      if (r.min != null && r.max != null) return t("rules.ifNot.priceBoth", { min: r.min, max: r.max });
      if (r.min != null) return t("rules.ifNot.priceMin", { min: r.min });
      if (r.max != null) return t("rules.ifNot.priceMax", { max: r.max });
      return t("rules.ifNot.price");
    case "minHold": return t("rules.ifNot.minHold", { hold: fmtHold(r.seconds) });
    case "excludeTickers": return t("rules.ifNot.excludeTickers", { tickers: r.tickers.join(", ") });
    case "excludeSide": return r.side === "long" ? t("rules.ifNot.noLongs") : t("rules.ifNot.noShorts");
    case "commissionPlan": return t("rules.ifNot.commissionPlan");
    case "capLoss": return t("rules.ifNot.capLoss", { amount: usd(r.usd) });
    case "sizeRange":
      if (r.max != null && r.min == null) return t("rules.ifNot.sizeMax", { max: r.max });
      if (r.min != null && r.max == null) return t("rules.ifNot.sizeMin", { min: r.min });
      return t("rules.ifNot.sizeBoth", { min: r.min ?? 0, max: r.max ?? "∞" });
    case "afterLoss": return t("rules.ifNot.afterLoss", { minutes: r.minutes });
    case "excludeSetups": return r.setups.length > 1 ? t("rules.ifNot.excludeSetups", { setups: r.setups.join(", ") }) : t("rules.ifNot.excludeSetup", { setups: r.setups.join(", ") });
    case "minGrade": return r.grade === "A+" ? t("rules.ifNot.onlyAPlus") : t("rules.ifNot.minGrade", { grade: r.grade });
    case "excludeImx": return t("rules.ifNot.excludeImx");
    case "noReentry": return t("rules.ifNot.noReentry");
    case "requireStop": return t("rules.ifNot.requireStop");
    case "maxSizeRel": return t("rules.ifNot.maxSizeRel", { x: r.x });
    case "excludeMistakes":
      if (r.codes.length === 1) return t("rules.ifNot.excludeMistake", { name: errorLabel(r.codes[0]) });
      if (r.codes.length === 2) return t("rules.ifNot.excludeMistakes", { names: r.codes.map(errorLabel).join(", ") });
      return r.codes.every((c) => ENTRY_MISTAKES.has(c)) ? t("rules.ifNot.excludeMistakesMany") : t("rules.ifNot.excludeMistakesAny");
    case "excludeTags": return r.tags.length === 1 ? t("rules.ifNot.excludeTag", { tags: r.tags[0] }) : t("rules.ifNot.excludeTags", { tags: r.tags.join(", ") });
    case "profitGiveback": return t("rules.ifNot.profitGiveback", { pct: r.pct, amount: usd(r.peak) });
    case "dailyProfitTarget": return t("rules.ifNot.dailyProfitTarget", { amount: usd(r.usd) });
    case "afterWin": return t("rules.ifNot.afterWin", { minutes: r.minutes });
    case "redZone": return r.floor != null ? t("rules.ifNot.redZoneFloor", { amount: usd(r.usd), count: r.k, floor: usd(r.floor) }) : t("rules.ifNot.redZone", { amount: usd(r.usd), count: r.k });
    case "blockWindow": return t("rules.ifNot.blockWindow", { from: r.from, to: r.to });
    case "maxTradesPerTicker": return t("rules.ifNot.maxTradesPerTicker", { count: r.n });
    case "noReentryAfterLoss": return t("rules.ifNot.noReentryAfterLoss", { minutes: r.minutes });
    case "excludeStrategies": return t("rules.ifNot.excludeStrategies", { strategies: r.strategies.join(", ") });
    case "excludeEarnings": return t("rules.ifNot.excludeEarnings");
  }
}

/** Display name of an exclusion / change reason (rule type code); unknown codes are shown as they are. */
export function reasonLabel(code: string): string {
  return whatIfI18n.tryT(`rules.reason.${code}`) ?? code;
}
