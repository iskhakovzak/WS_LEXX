/**
 * Which context chips a ticker snapshot shows, in what order and tone (pure; texts in the current UI language).
 * Order = what explains a move first: earnings around the day, short float, relative volume, float, cap, ATR, sector.
 */
import { fmtCompact, fmtDeskDate, fmtNum, fmtPct } from "@/lib/format";
import { finvizI18n } from "@/i18n/ns/finviz";
import { earningsFlagOf, rvolValue, type TickerSnapshot } from "./model";

export type ContextChip = { key: string; text: string; title: string; tone: "neutral" | "warn" | "accent" };

/** Short float from this level reads as «squeeze fuel». */
export const HIGH_SHORT_FLOAT = 20;
/** Relative volume from this level reads as «in play». */
export const HIGH_RVOL = 2;
/** Float below this (shares) reads as «low float». */
export const LOW_FLOAT = 20_000_000;

export function contextChips(s: TickerSnapshot, day: string | null): ContextChip[] {
  const t = finvizI18n.t;
  const out: ContextChip[] = [];
  if (s.earningsDate) {
    const flag = day ? earningsFlagOf(s, day) : null;
    const when = `${fmtDeskDate(s.earningsDate.slice(0, 10), "dayMonth")}${s.earningsTiming ? ` ${s.earningsTiming.toUpperCase()}` : ""}`;
    out.push({
      key: "earnings",
      text: `${t("ctx.earnings")} ${when}`,
      title: flag ? t(`earnings.badgeOn.${flag}`) : `${t("ctx.earnings")} ${when}`,
      tone: flag ? "warn" : "neutral",
    });
  }
  if (s.shortFloatPct != null) {
    out.push({
      key: "short",
      text: `SI ${fmtPct(s.shortFloatPct, { decimals: 1, signed: false })}`,
      title: t("ctx.shortFloat"),
      tone: s.shortFloatPct >= HIGH_SHORT_FLOAT ? "warn" : "neutral",
    });
  }
  const rvol = rvolValue(s.relVolume);
  if (rvol != null) {
    out.push({ key: "rvol", text: `RVOL ${fmtNum(rvol, 1)}`, title: t("ctx.relVolume"), tone: rvol >= HIGH_RVOL ? "accent" : "neutral" });
  }
  if (s.float != null) {
    out.push({ key: "float", text: `Float ${fmtCompact(s.float)}`, title: t("ctx.float"), tone: s.float < LOW_FLOAT ? "accent" : "neutral" });
  }
  if (s.marketCap != null) {
    out.push({ key: "cap", text: t("ctx.mcapShort", { value: `$${fmtCompact(s.marketCap)}` }), title: t("ctx.marketCap"), tone: "neutral" });
  }
  if (s.atr != null) out.push({ key: "atr", text: `ATR ${fmtNum(s.atr)}`, title: t("ctx.atr"), tone: "neutral" });
  if (s.avgVolume != null) out.push({ key: "avgvol", text: `Vol ${fmtCompact(s.avgVolume)}`, title: t("ctx.avgVolume"), tone: "neutral" });
  if (s.sector) out.push({ key: "sector", text: s.sector, title: s.industry ? `${s.sector} · ${s.industry}` : s.sector, tone: "neutral" });
  return out;
}
