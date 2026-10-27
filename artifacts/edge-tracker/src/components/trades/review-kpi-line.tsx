/**
 * The numbers of the selection as ONE line of text (design audit wave 3: no KPI tiles on /trades):
 *   «−$594 нетто · 177 сделок за 41 торг. день · винрейт 48% (52/56) · PF 0.92 · payoff 1.10 · комиссии $820 — 34% брутто ·
 *    12 не разобрано → · Итог … из них IMX …»
 * Colour only where it means good / bad: net (sign), PF (< 1 bad, ≥ 1.5 good) and the fee share (> 50% of gross warns).
 * $ by default (most trades carry no stop); PF and payoff switch to R when ≥ 50 % of the closed trades have one.
 * «комиссии» and «не разобрано» open the fees / review presets. Missing → «—»; a real zero stays «$0».
 */
import * as React from "react";
import { toneOf, toneText, type Tone } from "@/components/ds";
import { TermTooltip } from "@/components/ds/term-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ImxLine } from "@/components/shared/trade-facets/FacetSummary";
import { cn } from "@/lib/utils";
import { fmtCount, fmtRate, fmtUsd } from "@/lib/format";
import type { FacetLine } from "@/lib/trade-facets";
import type { TradesPageSummary } from "@/hooks/use-trades-page";
import { commonI18n } from "@/i18n/ns/common";
import { tradesI18n } from "@/i18n/ns/trades";
import { feeShareText } from "./sheet-model";
import { PRESET_META, type Preset } from "./review-presets";

const DASH = "—";
const money = (v: number | null | undefined, signed = true) => fmtUsd(v, { signed, decimals: "auto" });
const ratio = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v.toFixed(2) : DASH);
const LINK = "cursor-pointer rounded underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Sep() {
  return <span aria-hidden="true" className="px-1.5 text-muted-foreground/60">·</span>;
}

export function ReviewKpiLine({
  summary,
  loading,
  days,
  imx,
  onPreset,
  className,
}: {
  summary: TradesPageSummary | null;
  loading: boolean;
  /** Distinct trading days of the selection (summary.days, else the day list's total). */
  days: number | null | undefined;
  /** The facets answer: «Итог $X · из них IMX $Y» at the end (nothing without IMX trades). */
  imx?: { total: number | null | undefined; imx: FacetLine | null | undefined; excluded: boolean };
  onPreset: (p: Preset) => void;
  className?: string;
}) {
  const { t } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  if (loading && !summary) return <Skeleton className={cn("h-5 w-[min(100%,44rem)] rounded-full", className)} />;
  const s = summary;
  if (!s) return null;

  const closed = s.wins + s.losses + s.be;
  const useR = closed > 0 && s.rCount / closed >= 0.5;
  const payoff = useR
    ? s.avgWinR != null && s.avgLossR != null && s.avgLossR !== 0 ? s.avgWinR / Math.abs(s.avgLossR) : null
    : s.avgWinNet != null && s.avgLossNet != null && s.avgLossNet !== 0 ? s.avgWinNet / Math.abs(s.avgLossNet) : null;
  const pf = useR ? s.profitFactor ?? null : s.profitFactorNet ?? null;
  const pfTone: Tone = pf == null ? "neutral" : pf < 1 ? "down" : pf >= 1.5 ? "up" : "neutral";
  const feeShare = feeShareText(s.fees, s.gross);
  const inR = useR ? <span className="text-muted-foreground"> {t("review.line.inR")}</span> : null;
  const trades = tc("units.trades", { count: s.total });
  const untagged = s.untagged;

  const parts: React.ReactNode[] = [
    <span key="net">
      <span className={cn("font-semibold", s.net != null && toneText(toneOf(s.net)))}>{money(s.net)}</span>{" "}
      <TermTooltip term="net">{t("review.line.net")}</TermTooltip>
    </span>,
    <span key="trades">{days ? t("review.line.trades", { trades, days: tc("units.tradingDays", { count: days }) }) : trades}</span>,
    <span key="wr" title={closed ? t("review.line.wlTitle", { wins: fmtCount(s.wins), losses: fmtCount(s.losses), be: fmtCount(s.be) }) : undefined}>
      <TermTooltip term="winrate">{t("review.line.winrate")}</TermTooltip>{" "}
      <span className="font-medium text-foreground">{fmtRate(s.winRate ?? null)}</span>
      {closed > 0 && <span> ({fmtCount(s.wins)}/{fmtCount(s.losses)})</span>}
    </span>,
    <span key="pf">
      <TermTooltip term="pf" /> <span className={cn("font-medium", toneText(pfTone))}>{ratio(pf)}</span>{inR}
    </span>,
    <span key="payoff">
      <TermTooltip term="payoff" /> <span className="font-medium text-foreground">{ratio(payoff)}</span>{inR}
    </span>,
    <span key="fees">
      <button type="button" className={LINK} title={t("review.line.feesTitle", { preset: PRESET_META.fees.label })} onClick={() => onPreset("fees")}>
        {t("review.line.fees")}
      </button>{" "}
      <span className="font-medium text-foreground">{s.fees != null ? money(Math.abs(s.fees), false) : DASH}</span>
      {feeShare && <> — <span className={cn(feeShare.share > 0.5 && "text-warn")}>{t("review.line.feesShare", { share: feeShare.text })}</span></>}
    </span>,
  ];
  if (untagged != null) {
    parts.push(untagged > 0 ? (
      <button key="untagged" type="button" className={LINK} title={t("review.line.unreviewedTitle", { preset: PRESET_META.review.label })} onClick={() => onPreset("review")}>
        {t("review.line.unreviewed", { count: untagged })} →
      </button>
    ) : <span key="untagged">{t("review.line.allTagged")}</span>);
  }
  const imxLine = imx ? <ImxLine total={imx.total} imx={imx.imx} excluded={imx.excluded} className="inline" /> : null;

  return (
    <div
      role="group"
      aria-label={t("review.line.aria")}
      aria-busy={loading || undefined}
      className={cn("px-1 text-sm leading-7 tabular-nums text-muted-foreground transition-opacity", loading && "opacity-70", className)}
    >
      {parts.map((node, i) => <React.Fragment key={i}>{i > 0 && <Sep />}{node}</React.Fragment>)}
      {imxLine && imx?.imx?.count ? <><Sep />{imxLine}</> : null}
    </div>
  );
}
