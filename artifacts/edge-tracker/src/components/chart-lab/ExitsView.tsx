import * as React from "react";
import { DoorOpen } from "lucide-react";
import { EmptyState, Panel, Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtUsd } from "@/lib/format";
import { chartLabI18n } from "@/i18n/ns/chartLab";
import { cn } from "@/lib/utils";
import { type LabPick, type SetupExits, type VariantStat, useLabExits, useLabFacets } from "./api";
import { LabPicker } from "./LabPicker";

/** Display name of an exit variant: r1.5 → «+1.5R», t15 → «15 мин», vwap → «VWAP», actual → «Факт». */
export function variantLabel(v: string, t: ReturnType<typeof chartLabI18n.useT>["t"]): string {
  if (v === "actual") return t("exits.actual");
  if (v === "vwap") return "VWAP";
  if (v.startsWith("r")) return `+${v.slice(1)}R`;
  if (v.startsWith("t")) return t("exits.minutes", { m: v.slice(1) });
  return v;
}

const TONE: Record<VariantStat["verdict"], string> = { better: "text-up font-semibold", worse: "text-down", same: "text-foreground", few: "text-muted-foreground" };

/**
 * «Где лучше выходить»: per setup, what the trades would have made exiting at +1…3R (stop at −1R on the recorded stop),
 * after 5–60 minutes or at the first VWAP touch, against the real exits — the mean difference per trade, «лучше» only
 * when its 95% interval is above zero after the BH correction over the variants and with ≥ 20 trades. No look-ahead
 * beyond the bars that existed; trades whose day is missing from the archive are counted, never filled in.
 */
export function ExitsView({ trader }: { trader: string }) {
  const { t } = chartLabI18n.useT();
  const facets = useLabFacets(trader);
  const [pick, setPick] = React.useState<LabPick>(null);
  const q = useLabExits(trader, pick);
  const d = q.data;
  const groups: SetupExits[] = d ? [d.all, ...d.bySetup.filter((g) => g.setup)] : [];
  const variants = d?.all.variants.filter((v) => v.variant !== "actual").map((v) => v.variant) ?? [];
  const usd = (v: number | null) => (v == null ? "—" : fmtUsd(v, { signed: true, decimals: "auto" }));
  return (
    <Panel title={t("exits.title")} icon={DoorOpen} description={t("exits.hint")} actions={<LabPicker facets={facets.data} value={pick} onChange={setPick} allowAll />}>
      {q.isLoading || !d ? (
        <Skeleton className="h-[320px] rounded-2xl" />
      ) : d.total === 0 ? (
        <EmptyState compact icon={DoorOpen} title={t("exits.noneTitle")} description={t("exits.none")} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Pill tone="neutral">{t("exits.trades", { count: d.total })}</Pill>
            {d.all.missing > 0 && <Pill tone="warn" title={t("exits.missingHint")}>{t("exits.missing", { count: d.all.missing })}</Pill>}
            {(d.all.coarse ?? 0) > 0 && <Pill tone="neutral" title={t("exits.coarseHint")}>{t("exits.coarse", { count: d.all.coarse ?? 0 })}</Pill>}
            <Pill tone={d.withRisk ? "neutral" : "warn"} title={t("exits.withRiskHint")}>{t("exits.withRisk", { count: d.withRisk })}</Pill>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm tabular-nums">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 text-left font-medium">{t("exits.setup")}</th>
                  <th className="px-1.5 py-1.5 text-right font-medium">{t("exits.actual")}</th>
                  {variants.map((v) => <th key={v} className="px-1.5 py-1.5 text-right font-medium">{variantLabel(v, t)}</th>)}
                  <th className="py-1.5 pl-2 text-left font-medium">{t("exits.best")}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => {
                  const actual = g.variants.find((v) => v.variant === "actual");
                  return (
                    <tr key={`${gi}-${g.setup}`} className={cn("border-t border-border/50", gi === 0 && "font-medium")}>
                      <td className="max-w-[12rem] truncate whitespace-nowrap py-1.5 pr-2" title={g.setup || t("exits.all")}>{gi === 0 ? t("exits.all") : g.setup} <span className="text-xs text-muted-foreground">· {g.trades}</span></td>
                      <td className="px-1.5 py-1.5 text-right text-muted-foreground" title={t("exits.actualHint")}>{actual?.winRate != null ? `${Math.round(actual.winRate * 100)}%` : "—"}</td>
                      {variants.map((v) => {
                        const s = g.variants.find((x) => x.variant === v);
                        return (
                          <td key={v} className={cn("px-1.5 py-1.5 text-right", s ? TONE[s.verdict] : "")}
                            title={s ? t("exits.cellHint", { n: s.n, lo: usd(s.ci?.lo ?? null), hi: usd(s.ci?.hi ?? null), q: s.q == null ? "—" : s.q.toFixed(2), win: s.winRate == null ? "—" : `${Math.round(s.winRate * 100)}%` }) : undefined}>
                            {s && s.verdict !== "few" ? usd(s.meanDelta) : <span className="text-xs">{s ? t("exits.few") : "—"}</span>}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap py-1.5 pl-2 text-left">{g.best ? <Pill tone="up">{variantLabel(g.best, t)}</Pill> : <span className="text-xs text-muted-foreground">{t("exits.keep")}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-muted-foreground">{t("exits.footnote")}</p>
        </div>
      )}
    </Panel>
  );
}
