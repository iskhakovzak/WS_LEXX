/**
 * Where the tiles' action chips go, and how slices / rules are named.
 *
 *   drill     check only the slice in «Разрезы» (the viewer's saved view, shown as chips and cleared by «Сбросить»), then
 *             open /stats (from the dashboard) or the trade list of the same period (from /stats). Never a hidden filter.
 *   ids       the exact trades of a finding (streak, trades eaten by fees) — /trades?ids=…
 *   what-if   /what-if with the rule prefilled, the same trader and the same window (?r=…&p=custom&from&to&trader).
 */
import * as React from "react";
import { useLocation } from "wouter";
import { useFacetView } from "@/components/shared/trade-facets/api";
import { encodeRules, type Rule } from "@/components/shared/what-if-rules";
import { PRICE_BUCKETS, TIME_BUCKETS, type FacetDim } from "@/lib/trade-facets";
import { links } from "@/lib/links";
import { nyDate } from "@/lib/trading-date";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import { onlyFacet } from "./model";
import type { EdgeDim } from "./edge-map";

/** Where the tiles live and where they lead. */
export type InsightScope = {
  /** «stats»: dashboard → /stats with the slice; «trades»: /stats → the trade list of the period with the slice. */
  target: "stats" | "trades";
  from: string | null;
  to: string | null;
  /** One person (staff on a trader / their own book); null = the viewer's own book (server-scoped). */
  trader: string | null;
  /** /stats preset that matches the dashboard window (target «stats»). */
  statsPeriod?: string;
  /** The window in words for verdicts: «последние 90 дней». */
  periodLong: string;
};

export function sliceHref(scope: InsightScope): string {
  if (scope.target === "stats") {
    const p = new URLSearchParams();
    if (scope.statsPeriod) p.set("period", scope.statsPeriod);
    if (scope.trader) p.set("trader", scope.trader);
    const q = p.toString();
    return q ? `/stats?${q}` : "/stats";
  }
  return links.trades({ from: scope.from ?? undefined, to: scope.to ?? undefined, trader: scope.trader ?? undefined });
}

/** The trade list of the scope, with extra /trades params (outcome, sort, view). */
export function tradesHref(scope: InsightScope, extra: Record<string, string> = {}): string {
  const base = links.trades({ from: scope.from ?? undefined, to: scope.to ?? undefined, trader: scope.trader ?? undefined });
  const [path, query = ""] = base.split("?");
  const p = new URLSearchParams(query);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/** Longest id list a link carries (newest first); the rest is a click into the slice away. */
export const MAX_IDS = 150;

/** The exact trades of a finding. */
export function idsHref(ids: readonly number[], scope: InsightScope): string {
  return links.trades({ ids: ids.slice(0, MAX_IDS), trader: scope.trader ?? undefined });
}

/** /what-if with `rules`, the same trader and the same window. */
export function whatIfHref(scope: InsightScope, rules: Rule[]): string {
  const sp = new URLSearchParams();
  const r = encodeRules(rules);
  if (r) sp.set("r", r);
  if (scope.from) {
    sp.set("p", "custom");
    sp.set("from", scope.from);
    sp.set("to", scope.to ?? nyDate());
  }
  if (scope.trader) sp.set("trader", scope.trader);
  const q = sp.toString();
  return `/what-if${q ? `?${q}` : ""}`;
}

/** Check only `keys` of `dim` in «Разрезы», then open the slice page. `known`: seen keys of an open column (strategies). */
export function useDrill(scope: InsightScope) {
  const fv = useFacetView();
  const [, navigate] = useLocation();
  const { update, ready } = fv;
  return React.useCallback(
    (dim: FacetDim, keys: readonly string[], known: readonly string[] = []) => {
      // Before the saved view has loaded, writing would replace it with an empty one: open the page unfiltered.
      if (ready) update((v) => onlyFacet(v, dim, keys, known));
      navigate(sliceHref(scope));
    },
    [ready, update, navigate, scope],
  );
}

/* ─────────────────────────── naming ─────────────────────────── */

const t = insightTilesI18n.t;
const hm = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

type SeqKey = "1" | "2" | "3" | "4-5" | "6+";
export const seqLabel = (key: string) => (["1", "2", "3", "4-5", "6+"].includes(key) ? t(`seqLabel.${key as SeqKey}`) : key);

/** «Входы 9:30–9:50», «Сделки №4–5», «Акции до $5»… — the subject of a leak sentence. */
export function sliceLabel(dim: EdgeDim, key: string): string {
  switch (dim) {
    case "times": {
      const i = TIME_BUCKETS.findIndex((b) => b.key === key);
      if (i < 0) return key;
      if (i === 0) return t("slice.times.before", { time: hm(TIME_BUCKETS[0].before) });
      if (i === TIME_BUCKETS.length - 1) return t("slice.times.after", { time: hm(TIME_BUCKETS[i - 1].before) });
      return t("slice.times.range", { from: hm(TIME_BUCKETS[i - 1].before), to: hm(TIME_BUCKETS[i].before) });
    }
    case "seq":
      return t("slice.seq", { label: seqLabel(key) });
    case "prev":
      return key === "after-loss" || key === "after-win" ? t(`slice.prev.${key}`) : key;
    case "price": {
      const i = PRICE_BUCKETS.findIndex((b) => b.key === key);
      if (i < 0) return key;
      if (i === 0) return t("slice.price.lowest", { to: PRICE_BUCKETS[0].before });
      if (i === PRICE_BUCKETS.length - 1) return t("slice.price.highest", { from: PRICE_BUCKETS[i - 1].before });
      return t("slice.price.range", { from: PRICE_BUCKETS[i - 1].before, to: PRICE_BUCKETS[i].before });
    }
    case "strategies":
      return t("slice.strategy", { name: key });
  }
}

/** A rule in words, for the action chip: «не больше 3 сделок в день». */
export function ruleText(r: Rule): string {
  switch (r.type) {
    case "maxTradesPerDay": return t("rule.maxTrades", { count: r.n });
    case "afterLoss": return t("rule.afterLoss", { minutes: r.minutes });
    case "stopAfterLosses": return t("rule.stopAfterLosses", { count: r.n });
    case "timeWindow": return r.from ? t("rule.timeFrom", { time: r.from }) : t("rule.timeTo", { time: r.to ?? "" });
    case "priceRange": return r.min != null ? t("rule.priceMin", { min: r.min }) : t("rule.priceMax", { max: r.max ?? "" });
    case "excludeImx": return t("rule.excludeImx");
    default: return t("action.whatIf");
  }
}
