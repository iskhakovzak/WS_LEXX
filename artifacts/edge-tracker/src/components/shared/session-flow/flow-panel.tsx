/**
 * The session-flow slice of the analytics «Эдж» tab (GET /api/session-flow/stats): P&L, win rate and count by the
 * entry number in a ticker and side (1 / 2 / 3 / 4+), led by ONE line (the costly re-entry bucket, or «re-entries cost
 * nothing»), then the chase after a stop, the give-back days and the green-to-red days. Ends with the way to the
 * limits («Мой риск»). Every number comes from the api (lib/sessionFlow, the shared $ math); nothing is computed here.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Repeat } from "lucide-react";
import { Panel, QueryState, TableScroll, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { fmtDate, fmtNum, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import { flowStatsQuery } from "./api";
import { reentryInsight, type DayGiveback, type FlowStats } from "./model";

const tone = (v: number | null | undefined) => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");
const usd0 = (v: number | null | undefined, signed = true) => fmtUsd(v, { signed, decimals: 0 });

function unitsOf(d: DayGiveback): string {
  const t = sessionFlowI18n.t;
  if (d.unit === "stops" && d.stops != null) return t("panel.stopsUnit", { value: fmtNum(d.stops, 1) });
  if (d.unit === "r" && d.r != null) return t("panel.rUnit", { value: fmtNum(d.r, 1) });
  return "—";
}

function Insight({ s, max }: { s: FlowStats; max: number }) {
  const { t } = sessionFlowI18n.useT();
  const worst = reentryInsight(s.reentry);
  if (!worst) return <p className="text-sm text-muted-foreground" role="status">{t("panel.allGood", { max })}</p>;
  return (
    <p className={cn("text-sm font-medium", toneText("down"))} role="status">
      {t("panel.insight", { bucket: t(`panel.bucket.${worst.bucket}`), net: usd0(worst.net), trades: commonI18n.t("units.trades", { count: worst.n }) })}
    </p>
  );
}

/** `trader` null = the viewer's own book; from / to = the analytics window (null = the api's default span). */
export function SessionFlowPanel({ trader, from, to, maxReentries = 2 }: { trader: string | null; from: string | null; to: string | null; maxReentries?: number }) {
  const { t } = sessionFlowI18n.useT();
  const q = useQuery(flowStatsQuery(trader, from, to));
  return (
    <Panel title={t("panel.title")} icon={Repeat} description={t("panel.hint")}>
      <QueryState query={q} errorCompact errorTitle={t("panel.loadFailed")}>
        {(s) => !s.reentry.length ? (
          <p className="text-sm text-muted-foreground">{t("panel.empty")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Insight s={s} max={maxReentries} />
            <TableScroll>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground [&_th]:py-1 [&_th]:font-medium">
                    <th className="text-left">{t("panel.col.bucket")}</th>
                    <th className="text-right">{t("panel.col.trades")}</th>
                    <th className="text-right">{t("panel.col.winRate")}</th>
                    <th className="text-right">{t("panel.col.perTrade")}</th>
                    <th className="text-right">{t("panel.col.net")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.reentry.map((r) => (
                    <tr key={r.bucket} className={cn("border-t border-border/40", r.bucket !== "1" && (r.net ?? 0) < 0 && "bg-down/5")}>
                      <td className="py-1.5 font-medium">{t(`panel.bucket.${r.bucket}`)}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{r.n}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtRate(r.winrate)}</td>
                      <td className={cn("py-1.5 text-right tabular-nums", toneText(tone(r.expectancy)))}>{fmtUsd(r.expectancy, { signed: true, decimals: 2 })}</td>
                      <td className={cn("py-1.5 text-right font-medium tabular-nums", toneText(tone(r.net)))}>{usd0(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <ul className="flex flex-col gap-1.5 text-sm">
              <li className={cn(s.chase.n ? toneText(tone(s.chase.net)) : "text-muted-foreground")}>
                {s.chase.n ? t("panel.chase", { trades: commonI18n.t("units.trades", { count: s.chase.n }), net: usd0(s.chase.net) }) : t("panel.noChase")}
              </li>
              <li className="text-foreground">
                {t("panel.giveback", { threshold: fmtNum(s.giveback.threshold, 1), count: s.giveback.flaggedDays })}
                {s.giveback.days.slice(0, 3).map((d) => (
                  <span key={d.day} className="block text-xs tabular-nums text-muted-foreground">
                    {t("panel.givebackDay", { day: fmtDate(d.day, "dayMonth"), peak: usd0(d.peak), close: usd0(d.close), amount: usd0(d.giveback, false), units: unitsOf(d) })}
                  </span>
                ))}
              </li>
              <li className="text-foreground">
                {t("panel.greenToRed", { count: s.greenToRed.materialDays, cross: s.greenToRed.crossDays })}
                {s.greenToRed.days.slice(0, 3).map((d) => (
                  <span key={d.day} className="block text-xs tabular-nums text-muted-foreground">
                    {t("panel.greenToRedDay", { day: fmtDate(d.day, "dayMonth"), size: fmtNum(d.sizeRatio, 2), pace: fmtNum(d.paceRatio, 2) })}
                  </span>
                ))}
              </li>
            </ul>
            {!trader && <Link href={links.risk()} className="text-sm font-medium text-primary hover:underline">{t("panel.toRisk")}</Link>}
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
