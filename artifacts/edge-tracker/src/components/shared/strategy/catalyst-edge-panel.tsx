/**
 * The catalyst slice of the analytics «Эдж» tab (GET /api/catalysts/edge): P&L, win rate, expectancy and count by
 * catalyst strength × direction — «no catalyst marked» is its own row, never folded away — and per setup × strength,
 * led by ONE insight line («On weak catalysts your Opening Drive is −$X over N trades»). Numbers come from the api's
 * shared $ math; nothing is computed here.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Zap } from "lucide-react";
import { Panel, QueryState, TableScroll, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { strategyI18n } from "@/i18n/ns/strategy";
import { catalystEdgeQuery } from "./api";
import type { CatalystEdge, CellKey, UsdBlock } from "./model";

const tone = (v: number | null | undefined) => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");

export function insightText(i: NonNullable<CatalystEdge["insight"]>): string {
  return strategyI18n.t(`edge.insight.${i.strength}`, {
    setup: i.setupName, net: fmtUsd(i.net, { signed: true, decimals: 0 }), trades: commonI18n.t("units.trades", { count: i.n }),
  });
}

function Cells({ u }: { u: UsdBlock }) {
  return (
    <>
      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{u.n}</td>
      <td className="py-1.5 text-right tabular-nums">{fmtRate(u.winrate)}</td>
      <td className={cn("py-1.5 text-right tabular-nums", toneText(tone(u.expectancy)))}>{fmtUsd(u.expectancy, { signed: true, decimals: 2 })}</td>
      <td className={cn("py-1.5 text-right font-medium tabular-nums", toneText(tone(u.net)))}>{fmtUsd(u.net, { signed: true, decimals: 0 })}</td>
    </>
  );
}

function Head({ first }: { first: string }) {
  const { t } = strategyI18n.useT();
  return (
    <thead>
      <tr className="text-xs text-muted-foreground [&_th]:py-1 [&_th]:font-medium">
        <th className="text-left">{first}</th>
        <th className="text-right">{t("edge.col.trades")}</th>
        <th className="text-right">{t("edge.col.winRate")}</th>
        <th className="text-right">{t("edge.col.perTrade")}</th>
        <th className="text-right">{t("edge.col.net")}</th>
      </tr>
    </thead>
  );
}

/** `trader` null = the viewer's own book; from / to = the analytics window (null = the api's default span). */
export function CatalystEdgePanel({ trader, from, to }: { trader: string | null; from: string | null; to: string | null }) {
  const { t } = strategyI18n.useT();
  const q = useQuery(catalystEdgeQuery(trader, from, to));
  return (
    <Panel title={t("edge.title")} icon={Zap} description={t("edge.hint")}>
      <QueryState query={q} errorCompact errorTitle={t("edge.loadFailed")}>
        {(e) => e.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t("edge.empty")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {e.insight ? (
              <p className={cn("text-sm font-medium", toneText(tone(e.insight.net)))} role="status">{insightText(e.insight)}</p>
            ) : e.marked === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("edge.noMarks")}{" "}
                {!trader && <Link href={links.myPlan()} className="font-medium text-primary hover:underline">{t("edge.toPlan")}</Link>}
              </p>
            ) : null}
            <TableScroll>
              <table className="w-full text-sm">
                <Head first={t("edge.col.bucket")} />
                <tbody>
                  {e.buckets.map((b) => (
                    <tr key={b.key} className={cn("border-t border-border/40", b.key === "none" && "text-muted-foreground")}>
                      <td className="py-1.5 font-medium">{t(`edge.bucket.${b.key}`)}</td>
                      <Cells u={b} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            {e.bySetup.length > 0 && (
              <section className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-muted-foreground">{t("edge.bySetup")}</h3>
                <TableScroll>
                  <table className="w-full text-sm">
                    <Head first={t("edge.col.bucket")} />
                    <tbody>
                      {e.bySetup.map((s) => s.cells.map((c, i) => (
                        <tr key={`${s.setupId}-${c.strength}`} className={cn(i === 0 && "border-t border-border/40")}>
                          <td className="py-1.5">
                            {i === 0 && <span className="mr-2 font-medium text-foreground">{s.setupName}</span>}
                            <span className={cn("text-xs", c.strength === "none" ? "text-muted-foreground" : "text-foreground")}>{t(`edge.cell.${c.strength as CellKey}`)}</span>
                          </td>
                          <Cells u={c} />
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </TableScroll>
              </section>
            )}
            <p className="text-xs tabular-nums text-muted-foreground">{t("edge.coverage", { marked: e.marked, total: e.total })}</p>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
