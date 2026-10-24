/**
 * «Путь трейдера» — metric catalog (units), display values and «what to improve» advice of the promotion engine
 * (lib/promotionEngine re-exports them; split out for the size ratchet). Texts: `academyPath` namespace.
 */
import type { Op } from "../scalingEngine";
import type { PromoMetricKey, PromoMetricMeta } from "../promotionEngine";
import { academyPathT } from "../academyI18n";
import { DEFAULT_LANG, formatCountFor, type Lang } from "../../i18n";

export const PROMO_METRIC_DEFS: readonly Omit<PromoMetricMeta, "label" | "hint">[] = [
  { key: "net_pnl", unit: "usd", higherIsBetter: true, source: "trades" },
  { key: "trading_days", unit: "days", higherIsBetter: true, source: "trades" },
  { key: "trades", unit: "count", higherIsBetter: true, source: "trades" },
  { key: "max_dd_usd", unit: "usd", higherIsBetter: false, source: "trades" },
  { key: "max_dd_pct", unit: "pct", higherIsBetter: false, source: "trades" },
  { key: "consistency", unit: "pct", higherIsBetter: false, source: "trades" },
  { key: "win_rate", unit: "pct", higherIsBetter: true, source: "trades" },
  { key: "edge_margin_pp", unit: "pp", higherIsBetter: true, source: "trades" },
  { key: "profit_factor", unit: "x", higherIsBetter: true, source: "trades" },
  { key: "expectancy_lb", unit: "usd", higherIsBetter: true, source: "trades" },
  { key: "fee_share", unit: "pct", higherIsBetter: false, source: "trades" },
  { key: "violations", unit: "count", higherIsBetter: false, source: "rules" },
  { key: "limit_breaches", unit: "count", higherIsBetter: false, source: "trades" },
  { key: "red_streak_max", unit: "days", higherIsBetter: false, source: "trades" },
  { key: "green_days_pct", unit: "pct", higherIsBetter: true, source: "trades" },
  { key: "discipline_index", unit: "score100", higherIsBetter: true, source: "behavior" },
  { key: "rating_discipline", unit: "score10", higherIsBetter: true, source: "ratings" },
  { key: "lessons_pct", unit: "pct", higherIsBetter: true, source: "learning" },
  { key: "quiz_avg", unit: "pct", higherIsBetter: true, source: "learning" },
  { key: "challenges_passed", unit: "count", higherIsBetter: true, source: "challenges" },
];

const UNIT_OF = new Map(PROMO_METRIC_DEFS.map((d) => [d.key, d.unit]));

// ─── formatting & advice ────────────────────────────────────────────────────

/** Display value of a metric. Money: "$1 234" in RU (historical), "$1,234" otherwise; counts follow `lang`. */
export function formatPromo(key: PromoMetricKey, v: number | null, lang: Lang = DEFAULT_LANG): string {
  if (v == null) return "—";
  if (key === "expectancy_lb") return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  switch (UNIT_OF.get(key)) {
    case "pp": return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} ${academyPathT.tFor(lang)("units.pp")}`;
    case "usd": return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 0 })}`;
    case "pct": return `${v.toFixed(0)}%`;
    case "x": return `${v.toFixed(2)}×`;
    case "score100": return `${v.toFixed(0)}/100`;
    case "score10": return `${v.toFixed(1)}/10`;
    default: return formatCountFor(lang, Math.round(v));
  }
}

export const OP_TEXT: Record<Op, string> = { ">=": "≥", ">": ">", "<=": "≤", "<": "<", "=": "=" };

export interface AdviceCtx {
  windowDays: number;
  tradingDaysLeftHint?: number;
  bestDay?: number | null;
  totalNet?: number | null;
  grossLoss?: number | null;
  grossProfit?: number | null;
  wins?: number;
  losses?: number;
  gross?: number | null;
  fees?: number | null;
  /** Average winning / losing trade net (edge margin advice). */
  avgWin?: number | null;
  avgLoss?: number | null;
}

/** "What to improve" for a failing criterion — concrete numbers where they can be derived (text in `lang`). */
export function adviceFor(metric: PromoMetricKey, op: Op, actual: number | null, target: number, ctx: AdviceCtx, lang: Lang = DEFAULT_LANG): string {
  const t = academyPathT.tFor(lang);
  const usd = (x: number) => formatPromo("net_pnl", x, lang);
  const opText = OP_TEXT[op];
  switch (metric) {
    case "net_pnl":
      return actual == null ? t("advice.netNoTrades")
        : t("advice.net", { missing: usd(Math.max(0, target - actual)), days: ctx.tradingDaysLeftHint ?? ctx.windowDays, perDay: usd(Math.max(0, target - actual) / Math.max(1, ctx.tradingDaysLeftHint ?? ctx.windowDays)) });
    case "trading_days":
      return t("advice.tradingDays", { n: Math.max(0, Math.ceil(target - (actual ?? 0))), days: ctx.windowDays });
    case "trades":
      return t("advice.trades", { n: Math.max(0, Math.ceil(target - (actual ?? 0))) });
    case "max_dd_usd":
      return actual == null ? t("advice.noMoney") : t("advice.maxDdUsd", { dd: usd(actual), limit: usd(target) });
    case "max_dd_pct":
      return actual == null ? t("advice.maxDdPctNone") : t("advice.maxDdPct", { pct: actual.toFixed(0), op: opText, target });
    case "consistency": {
      if (actual == null) return t("advice.consistencyNoProfit");
      const best = ctx.bestDay ?? null, total = ctx.totalNet ?? null;
      if (best != null && total != null && target > 0) {
        const need = best / (target / 100) - total;
        return t("advice.consistencyNeed", { pct: actual.toFixed(0), target, usd: usd(Math.max(0, need)) });
      }
      return t("advice.consistency", { pct: actual.toFixed(0), target });
    }
    case "win_rate": {
      const w = ctx.wins ?? 0, l = ctx.losses ?? 0;
      if (actual == null) return t("advice.winRateNone");
      const p = target / 100;
      const needWins = p < 1 ? Math.max(0, Math.ceil((p * (w + l) - w) / (1 - p))) : 0;
      return t("advice.winRate", { pct: actual.toFixed(0), w, l, op: opText, target, need: needWins });
    }
    case "profit_factor": {
      if (actual == null) return t("advice.pfNone");
      const gl = Math.abs(ctx.grossLoss ?? 0), gp = ctx.grossProfit ?? 0;
      return gl > 0
        ? t("advice.pf", { pf: actual.toFixed(2), target, needProfit: usd(target * gl), profit: usd(gp), cut: usd(Math.max(0, gl - gp / target)) })
        : t("advice.pfShort", { pf: actual.toFixed(2), target });
    }
    case "fee_share": {
      if (actual == null) return t("advice.feesNone");
      return (ctx.gross ?? 0) <= 0
        ? t("advice.feesAteAll", { fees: usd(ctx.fees ?? 0), gross: usd(ctx.gross ?? 0) })
        : t("advice.fees", { pct: actual.toFixed(0), target });
    }
    case "violations":
      return t("advice.violations", { count: actual ?? 0, target });
    case "limit_breaches":
      return t("advice.limitBreaches", { count: actual ?? 0 });
    case "red_streak_max":
      return actual == null ? t("advice.noMoney") : t("advice.redStreak", { n: actual, target });
    case "green_days_pct":
      return t("advice.greenDays", { pct: actual?.toFixed(0) ?? "—", target });
    case "discipline_index":
      return actual == null ? t("advice.disciplineNone") : t("advice.discipline", { value: actual.toFixed(0), target });
    case "rating_discipline":
      return actual == null ? t("advice.ratingNone") : t("advice.rating", { value: actual.toFixed(1), target });
    case "lessons_pct":
      return t("advice.lessons", { pct: actual?.toFixed(0) ?? 0, target });
    case "quiz_avg":
      return actual == null ? t("advice.quizNone") : t("advice.quiz", { pct: actual.toFixed(0), target });
    case "challenges_passed":
      return t("advice.challenges");
    case "edge_margin_pp": {
      if (actual == null || ctx.avgWin == null || ctx.avgLoss == null) return t("advice.edgeMarginNone");
      const be = 100 / (1 + ctx.avgWin / Math.abs(ctx.avgLoss));
      return t("advice.edgeMargin", { margin: actual.toFixed(1), target, be: be.toFixed(1), avgWin: usd(ctx.avgWin), avgLoss: usd(ctx.avgLoss) });
    }
    case "expectancy_lb":
      return actual == null ? t("advice.expectancyLbNone") : t("advice.expectancyLb", { value: formatPromo("expectancy_lb", actual, lang), days: ctx.windowDays });
  }
}
