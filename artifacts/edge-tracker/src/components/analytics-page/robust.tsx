/**
 * Robust edge of the «Эдж» breakdown rows (setup and ticker): net without the three best trades, the median trade
 * and the top-3 share of the net; a row whose edge rests on outliers gets a warning chip next to its number.
 * The per-trade net is the tab's own (metrics pnlValue: P&L after fees), the rule is shared/session-flow robustEdge.
 */
import { Pill, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtRate, fmtUsd } from "@/lib/format";
import type { Trade } from "@workspace/api-client-react";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import { robustEdge, type RobustEdge } from "@/components/shared/session-flow/model";
import { dimensionOf, pnlValue, scopedTrades, type DimensionKey } from "./metrics";

/** Breakdowns that get the robust column. */
export const ROBUST_DIMS: ReadonlySet<DimensionKey> = new Set<DimensionKey>(["setup", "ticker"]);

/** Group key → the robust edge of its closed trades with a P&L. */
export function robustByKey(all: Trade[], dimKey: DimensionKey): Map<string, RobustEdge> {
  const dim = dimensionOf(dimKey);
  const nets = new Map<string, number[]>();
  for (const tr of scopedTrades(all, dimKey)) {
    const v = pnlValue(tr);
    if (v == null) continue;
    for (const k of dim.keys(tr)) {
      const l = nets.get(k);
      if (l) l.push(v); else nets.set(k, [v]);
    }
  }
  return new Map([...nets].map(([k, v]) => [k, robustEdge(v)]));
}

export function RobustCell({ e }: { e: RobustEdge | undefined }) {
  const { t } = sessionFlowI18n.useT();
  if (!e || !e.n) return <span className="text-muted-foreground">—</span>;
  const hint = t("robust.hint", { median: fmtUsd(e.median, { signed: true, decimals: "auto" }), share: e.top3Share == null ? "—" : fmtRate(e.top3Share) });
  return (
    <span className="inline-flex items-center justify-end gap-1.5" title={e.outliers ? `${t("robust.outliersHint", { exTop3: fmtUsd(e.netExTop3, { signed: true, decimals: "auto" }) })} ${hint}` : hint}>
      {e.outliers && <Pill tone="warn">{t("robust.outliers")}</Pill>}
      <span className={cn(toneText(e.netExTop3 > 0 ? "up" : e.netExTop3 < 0 ? "down" : "neutral"))}>{fmtUsd(e.netExTop3, { signed: true, decimals: "auto" })}</span>
    </span>
  );
}
