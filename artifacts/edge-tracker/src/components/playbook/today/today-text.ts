/** Texts of «Сегодня» built from the contract: the edge chip, the unlock condition, window names. */
import type { Tone } from "@/components/ds";
import { tierDisplay } from "@/components/shared/tier-labels";
import type { Params } from "@/i18n/core";
import type { DayWindowKey, MyEdge, TextItem, TodaySetup } from "@/lib/playbook-today/types";
import { fmtDate, fmtR, fmtRate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";

const t = playbookTodayI18n.t; // call time only

export const windowLabel = (k: DayWindowKey | null | undefined) => (k ? t(`window.${k}`) : "");

/** Chip on a setup row / the card: «твой лучший: 23 сделки, +0.42R», «осторожно: −0.10R», «новый». */
export function edgeChip(e: MyEdge | null | undefined): { text: string; tone: Tone } {
  if (!e || e.trades === 0) return { text: t("edge.new"), tone: "neutral" };
  const r = fmtR(e.avgR);
  if (e.verdict === "best") return { text: t("edge.best", { count: e.trades, r }), tone: "up" };
  if (e.verdict === "good") return { text: t("edge.good", { count: e.trades, r }), tone: "up" };
  if (e.verdict === "careful") return { text: t("edge.careful", { r }), tone: "down" };
  return { text: t("edge.newTrades", { count: e.trades }), tone: "neutral" };
}

/** Tooltip with the whole record. */
export function edgeDetail(e: MyEdge | null | undefined): string | undefined {
  if (!e || e.trades === 0) return undefined;
  const line = t("edge.detail", {
    trades: commonI18n.t("units.trades", { count: e.trades }),
    rate: fmtRate(e.winRate),
    r: fmtR(e.avgR),
    total: fmtR(e.totalR),
  });
  return e.lastTradedOn ? `${line} · ${t("edge.last", { date: fmtDate(e.lastTradedOn, "dayMonthNumeric") })}` : line;
}

/** How to unlock: the server's key (params; `tier` = a tier key) in the UI language, else «на уровне X» from minTier. */
export function unlockText(s: Pick<TodaySetup, "unlock" | "minTier">): string {
  const item: TextItem | null = s.unlock;
  if (item?.key) {
    const params: Params = {};
    for (const [k, v] of Object.entries(item.params ?? {})) if (v != null) params[k] = k === "tier" ? tierDisplay(String(v)) : v;
    const key = item.key.startsWith("unlock.") ? item.key : `unlock.${item.key}`;
    const text = playbookTodayI18n.tryT(key, params);
    if (text) return text;
  }
  return s.minTier ? t("lock.tier", { tier: tierDisplay(s.minTier) }) : t("lock.title");
}

/** «9:35–10:30 NY» from the card's time, else the window's. */
export function timeText(s: Pick<TodaySetup, "time">, fallback?: { from: string; to: string } | null): string {
  const r = s.time ?? fallback ?? null;
  return r ? t("card.time", { from: r.from, to: r.to }) : "";
}
